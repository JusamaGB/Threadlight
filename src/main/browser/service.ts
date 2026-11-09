import { isYouTubePage, youtubeLayoutScript } from './youtube'
import {
  fullscreenVideoAspect,
  mediaInspection,
  mediaAction,
  pauseBrowserPlayback,
  resumeBrowserPlayback,
} from './media'
import { VideoPanelSizing, type VideoPanelLayout } from './videoSizing'
import { BrowserCaption } from './caption'
import { browserUrl } from '../../shared/browserNavigation'
import {
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  dialog,
  shell,
  net,
  protocol,
} from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  browserCommand,
  videoGripGesture,
  PANEL_BROWSER_THREAD,
  type BrowserCommand,
  type BrowserState,
  type BrowserReply,
} from '../../shared/browser'
import type { MemoryPluginConnection } from '../../shared/memoryPlugins'
import { setBrowserAccess, type BrowserCaller } from './registry'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'threadlight-browser-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const READ_ACTIONS = new Set(['list', 'inspect', 'screenshot', 'receipt'])
const savedSchema = z.object({
  pages: z.array(
    z.object({
      id: z.string().uuid(),
      threadId: z.string(),
      url: z.string(),
      sharedWith: z.array(z.string()),
      hosted: z.boolean(),
    }),
  ),
  receipts: z.array(
    z.tuple([z.string(), z.object({ fingerprint: z.string(), reply: z.custom<BrowserReply>() })]),
  ),
})
type Page = {
  state: BrowserState
  view: WebContentsView
  hosted: boolean
  token?: string
  covered?: boolean
  bounds?: Electron.Rectangle
  videoLayout?: VideoPanelLayout
  playbackVisible: boolean
  playbackTransition?: Promise<void>
  epoch: number
  lease?: { caller: BrowserCaller; until: number }
  busy: boolean
  injecting: boolean
  worlds: Map<string, { contextId: number; sessionId?: string }>
  sessions: Set<string>
  debugReady?: Promise<void>
  localRoot?: string
}

// The isolated world keeps element references out of page JavaScript's reach.
const inspectScript = `(() => {
  const nodes = [];
  const visit = root => { for (const e of root.querySelectorAll('*')) {
    if (e.matches('a,button,input,textarea,select,video,audio,[role="button"],[contenteditable="true"]') && (e.matches('video,audio') || e.getClientRects().length)) nodes.push(e);
    if (e.shadowRoot) visit(e.shadowRoot);
    if (nodes.length >= 400) break;
  }};
  visit(document);
  globalThis.__threadlightElements = nodes.slice(0,400);
  globalThis.__threadlightSignature = e => JSON.stringify([e.tagName,e.getAttribute('role'),e.getAttribute('aria-label'),e.getAttribute('href'),e.getAttribute('type'),e.matches('video,audio') ? [e.currentSrc,e.srcObject?.id] : '',e.innerText?.slice(0,250)]);
  globalThis.__threadlightSignatures = globalThis.__threadlightElements.map(globalThis.__threadlightSignature);
  return { title:document.title, observedAt:Date.now(), media: ${mediaInspection}, text: (document.body?.innerText || '').slice(0,24000), elements: globalThis.__threadlightElements.map((e,i) => ({
    id:i+1, tag:e.tagName.toLowerCase(), role:e.getAttribute('role'),
    name:(e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText || e.getAttribute('title') || '').slice(0,250),
    type:e.getAttribute('type'), value:e.type === 'password' ? undefined : String(e.value ?? '').slice(0,4000), disabled:!!e.disabled,
  })) };
})()`

export class SharedBrowserService {
  private caption: BrowserCaption
  private captionTarget: { threadId: string | null; text: string } = { threadId: null, text: '' }
  private pages = new Map<string, Page>()
  private receipts = new Map<string, { fingerprint: string; reply: BrowserReply }>()
  private restored: z.infer<typeof savedSchema>['pages'] = []
  private persistenceError = ''
  private timer: ReturnType<typeof setInterval>
  constructor(
    private panel: BrowserWindow,
    private file: string,
    private hasThread: (id: string) => boolean,
    private connections: () => MemoryPluginConnection[],
    private videoSizing = new VideoPanelSizing(panel),
  ) {
    this.caption = new BrowserCaption(panel)
    try {
      const saved = savedSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
      this.restored = saved.pages
      this.receipts = new Map(
        saved.receipts.map(([id, receipt]) => [
          id,
          {
            ...receipt,
            reply:
              receipt.reply.outcome === 'pending'
                ? {
                    ok: false,
                    outcome: 'uncertain',
                    reason: 'Threadlight restarted during this action. Inspect before continuing.',
                  }
                : receipt.reply,
          },
        ]),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.persistenceError = 'Browser state could not be read.'
    }
    setBrowserAccess(this)
    ipcMain.handle('browser:request', async (event, input: unknown) => {
      if (event.sender !== panel.webContents || event.senderFrame !== panel.webContents.mainFrame)
        return { ok: false, reason: 'Browser unavailable.' }
      try {
        return await this.ui(input)
      } catch (error) {
        return { ok: false, reason: (error as Error).message }
      }
    })
    panel.on('resize', () => {
      for (const page of this.pages.values()) this.position(page)
    })
    panel.on('move', () => this.positionCaption())
    panel.webContents.on('did-start-loading', () => {
      this.captionTarget = { threadId: null, text: '' }
      this.hideAll()
    })
    panel.on('hide', () => {
      this.resetVideoSizing()
      for (const page of this.pages.values()) this.interrupt(page)
    })
    panel.on('show', () => {
      for (const page of this.pages.values()) if (page.state.visible) this.publish(page)
    })
    this.timer = setInterval(() => {
      for (const page of this.pages.values()) {
        if (page.lease && (!page.lease.caller.valid() || page.lease.until < Date.now()))
          this.interrupt(page)
      }
    }, 1000)
    this.timer.unref()
    panel.once('closed', () => {
      this.caption.dispose()
      clearInterval(this.timer)
      setBrowserAccess(undefined)
      ipcMain.removeHandler('browser:request')
      for (const page of this.pages.values())
        page.view.webContents.close({ waitForBeforeUnload: false })
    })
  }
  private save() {
    if (this.persistenceError) throw Error(this.persistenceError)
    const pages = [
      ...this.restored.filter((s) => !this.pages.has(s.id)),
      ...[...this.pages.values()].map((p) => ({
        id: p.state.id,
        threadId: p.state.threadId,
        url: /^https?:/.test(p.state.url) ? p.state.url : 'about:blank',
        sharedWith: p.state.sharedWith,
        hosted: p.hosted,
      })),
    ]
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify({ pages, receipts: [...this.receipts] }))
    renameSync(temporary, this.file)
  }
  private publish(page: Page) {
    this.syncPlayback(page)
    const fullscreenVideo = page.state.fullscreen && !!page.state.videoAspect && !page.state.error
    if (!fullscreenVideo) page.videoLayout = undefined
    if (page.state.visible) {
      if (fullscreenVideo && this.panel.isVisible()) {
        this.videoSizing.active = true
        if (page.videoLayout) this.videoSizing.resume(page.videoLayout)
      } else if (this.videoSizing.active) this.resetVideoSizing()
      page.state.videoSized = this.videoSizing.sized
    }
    this.position(page)
    if (!this.panel.isDestroyed()) this.panel.webContents.send('browser:changed', page.state)
  }
  private interrupt(page: Page) {
    page.epoch++
    page.state.revision++
    page.lease = undefined
    page.state.controller = undefined
    this.publish(page)
  }
  private position(page: Page) {
    if (!page.bounds || this.panel.isDestroyed()) return
    const [width = 0, height = 0] = this.panel.getContentSize()
    const x = Math.max(0, Math.min(width, Math.round(page.bounds.x)))
    const y = Math.max(0, Math.min(height, Math.round(page.bounds.y)))
    page.view.setBounds({
      x,
      y,
      width: Math.max(0, Math.min(width - x, Math.round(page.bounds.width))),
      height: Math.max(0, Math.min(height - y, Math.round(page.bounds.height))),
    })
    const bounds = page.view.getBounds()
    page.view.setVisible(
      page.state.visible &&
        !page.covered &&
        !page.state.error &&
        page.state.url !== 'about:blank' &&
        bounds.width > 0 &&
        bounds.height > 0,
    )
    if (page.state.visible) this.positionCaption()
  }
  private positionCaption() {
    const page = [...this.pages.values()].find(
      (p) => p.state.visible && p.state.threadId === this.captionTarget.threadId,
    )
    if (page?.bounds && !page.covered && !page.state.error && this.panel.isVisible())
      this.caption.update(this.captionTarget.text, page.view.getBounds())
    else this.caption.update('')
  }
  private hideAll() {
    this.caption.update('')
    this.resetVideoSizing()
    for (const page of this.pages.values()) {
      page.view.setVisible(false)
      page.state.visible = false
      page.token = undefined
      this.interrupt(page)
    }
  }
  private syncPlayback(page: Page) {
    const visible = page.state.visible && this.panel.isVisible()
    if (visible === page.playbackVisible) return
    page.playbackVisible = visible
    const contents = page.view.webContents
    if (contents.isDestroyed()) return
    const previous = page.playbackTransition
    if (visible && !previous) {
      contents.setAudioMuted(false)
      return
    }
    if (!visible) contents.setAudioMuted(true)
    // A quick return must run after the outgoing pause has captured its players.
    page.playbackTransition = (previous ?? Promise.resolve())
      .then(async () => {
        const frames = await this.frames(page, Infinity)
        if (visible && !page.playbackVisible) return
        const script = visible ? resumeBrowserPlayback : pauseBrowserPlayback
        await Promise.all(
          frames.map((frame) => this.evaluate(page, script, 0, false, frame).catch(() => {})),
        )
      })
      .catch(() => {})
      .finally(() => {
        if (visible && page.playbackVisible && !contents.isDestroyed())
          contents.setAudioMuted(false)
      })
  }
  private resetVideoSizing() {
    this.videoSizing.reset()
    for (const page of this.pages.values()) page.state.videoSized = false
  }
  private create(threadId: string) {
    const existing = [...this.pages.values()].find((p) => p.state.threadId === threadId)
    if (existing) return existing
    if (threadId !== PANEL_BROWSER_THREAD && !this.hasThread(threadId))
      throw Error('Chat unavailable.')
    const saved = this.restored.find((p) => p.threadId === threadId)
    const id = saved?.id ?? randomUUID()
    const isolated = session.fromPartition(`persist:threadlight-browser-${id}`)
    isolated.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'fullscreen'),
    )
    isolated.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen')
    isolated.setDevicePermissionHandler(() => false)
    isolated.on('will-download', (event) => event.preventDefault())
    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        disableHtmlFullscreenWindowResize: true,
        safeDialogs: true,
      },
    })
    view.setBackgroundColor('#111111')
    const page: Page = {
      view,
      playbackVisible: false,
      hosted: saved?.hosted ?? true,
      epoch: 0,
      busy: false,
      injecting: false,
      worlds: new Map(),
      sessions: new Set(),
      state: {
        id,
        threadId,
        url: 'about:blank',
        title: 'Browser',
        revision: Date.now(),
        loading: false,
        back: false,
        forward: false,
        fullscreen: false,
        visible: false,
        sharedWith: saved?.sharedWith ?? [],
      },
    }
    this.pages.set(id, page)
    this.panel.contentView.addChildView(view)
    view.setVisible(false)
    const contents = view.webContents
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
        page.sessions.add(params.sessionId)
        page.state.revision++
        void contents.debugger
          .sendCommand(
            'Target.setAutoAttach',
            { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
            params.sessionId,
          )
          .then(() =>
            contents.debugger.sendCommand(
              'Emulation.setAutoDarkModeOverride',
              { enabled: true },
              params.sessionId,
            ),
          )
          .catch(() => {})
      }
      if (method === 'Target.detachedFromTarget') {
        page.sessions.delete(params.sessionId)
        page.worlds.clear()
        page.state.revision++
      }
    })

    contents.setAudioMuted(true)
    const allowed = (url: string) =>
      /^https?:\/\//i.test(url) ||
      url === 'about:blank' ||
      (!!page.localRoot && url.startsWith('threadlight-browser-file://local/'))
    contents.on('will-navigate', (event, url) => {
      if (!allowed(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!allowed(url)) event.preventDefault()
    })
    contents.on('will-frame-navigate', (event) => {
      if (!allowed(event.url)) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url))
        void contents.loadURL(url).catch((error) => {
          if (error.code === 'ERR_ABORTED' || error.errno === -3) return
          page.state.error = error.message
          this.publish(page)
        })
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    const update = () => {
      page.state.url = contents.getURL() || 'about:blank'
      page.state.title = contents.getTitle() || 'Browser'
      page.state.loading = contents.isLoading()
      page.state.back = contents.navigationHistory.canGoBack()
      page.state.forward = contents.navigationHistory.canGoForward()
      this.publish(page)
    }
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      page.state.revision++
      page.worlds.clear()
      if (mainFrame) {
        page.state.error = undefined
      }
      update()
    })
    contents.on('dom-ready', () => {
      if (isYouTubePage(contents.getURL()))
        void this.evaluate(page, youtubeLayoutScript).catch(() => {})
    })
    contents.on('did-start-loading', update)
    contents.on('did-stop-loading', () => {
      update()
      try {
        this.save()
      } catch (error) {
        page.state.error = (error as Error).message
        this.publish(page)
      }
    })
    contents.on('page-title-updated', update)
    contents.on('did-navigate-in-page', () => {
      page.state.revision++
      update()
    })
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) {
        page.state.error = description
        update()
      }
    })
    contents.on('render-process-gone', () => {
      page.state.fullscreen = false
      page.state.videoAspect = undefined
      this.interrupt(page)
      page.state.error = 'The browser stopped. Reload to recover.'
      this.publish(page)
    })
    let fullscreenGeneration = 0
    contents.on('enter-html-full-screen', () => {
      const generation = ++fullscreenGeneration
      page.state.fullscreen = true
      page.state.videoAspect = undefined
      this.publish(page)
      void this.frames(page)
        .then((frames) =>
          Promise.all(
            frames.map(async (frame) => {
              const aspect = await this.evaluate(
                page,
                fullscreenVideoAspect,
                0,
                false,
                frame,
              ).catch(() => null)
              if (
                typeof aspect === 'number' &&
                aspect > 0 &&
                generation === fullscreenGeneration &&
                page.state.fullscreen &&
                !contents.isDestroyed()
              ) {
                page.state.videoAspect = aspect
                this.publish(page)
              }
            }),
          ),
        )
        .catch(() => {})
    })
    contents.on('leave-html-full-screen', () => {
      fullscreenGeneration++
      page.state.fullscreen = false
      page.state.videoAspect = undefined
      this.publish(page)
    })
    contents.on('before-input-event', (_event, input) => {
      if (!page.injecting && input.type === 'keyDown') {
        this.interrupt(page)
        if (input.key === 'Escape' && page.state.fullscreen) void this.fullscreen(page, false)
      }
    })
    contents.on('before-mouse-event', (_event, input) => {
      if (!page.injecting && ['mouseDown', 'mouseWheel'].includes(input.type)) this.interrupt(page)
    })
    isolated.protocol.handle('threadlight-browser-file', async (request) => {
      try {
        if (!page.localRoot || request.method !== 'GET')
          return new Response('Unavailable', { status: 404 })
        const url = new URL(request.url)
        if (url.hostname !== 'local') return new Response('Unavailable', { status: 404 })
        const file = await realpath(resolve(page.localRoot, '.' + decodeURIComponent(url.pathname)))
        const rel = relative(page.localRoot, file)
        if (rel.startsWith('..') || isAbsolute(rel))
          return new Response('Forbidden', { status: 403 })
        return net.fetch(pathToFileURL(file).href)
      } catch {
        return new Response('Unavailable', { status: 404 })
      }
    })
    void this.prepareDebugger(page).catch(() => {})
    void contents
      .loadURL(saved?.url && /^https?:/.test(saved.url) ? saved.url : 'about:blank')
      .catch(() => {})
    return page
  }
  private prepareDebugger(page: Page) {
    const debug = page.view.webContents.debugger
    if (!debug.isAttached()) {
      debug.attach('1.3')
      page.debugReady = debug
        .sendCommand('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        })
        .then(() => debug.sendCommand('Emulation.setAutoDarkModeOverride', { enabled: true }))
        .then(() => {})
    }
    return page.debugReady ?? Promise.resolve()
  }
  private async frames(
    page: Page,
    limit = 20,
  ): Promise<{ id: string; url: string; sessionId?: string }[]> {
    await this.prepareDebugger(page)
    const debug = page.view.webContents.debugger
    const frames = new Map<string, { id: string; url: string; sessionId?: string }>()
    const visit = (
      tree: { frame: { id: string; url: string }; childFrames?: (typeof tree)[] },
      sessionId?: string,
    ) => {
      frames.set(tree.frame.id, { ...tree.frame, sessionId })
      tree.childFrames?.forEach((child) => visit(child, sessionId))
    }
    const root = await debug.sendCommand('Page.getFrameTree')
    visit(root.frameTree)
    for (const sessionId of page.sessions) {
      try {
        const result = await debug.sendCommand('Page.getFrameTree', {}, sessionId)
        visit(result.frameTree, sessionId)
      } catch {
        /* A detached frame will be absent from the next observation. */
      }
    }
    return [...frames.values()].slice(0, limit)
  }
  private async evaluate(
    page: Page,
    script: string,
    frame = 0,
    gesture = false,
    target?: { id: string; url: string; sessionId?: string },
  ) {
    const debug = page.view.webContents.debugger
    target ??= (await this.frames(page))[frame]
    if (!target) throw Error('Frame changed. Inspect again.')
    let world = page.worlds.get(target.id)
    if (!world) {
      const created = await debug.sendCommand(
        'Page.createIsolatedWorld',
        { frameId: target.id, worldName: 'Threadlight browser' },
        target.sessionId,
      )
      world = { contextId: created.executionContextId as number, sessionId: target.sessionId }
      page.worlds.set(target.id, world)
    }
    const result = await debug.sendCommand(
      'Runtime.evaluate',
      {
        expression: script,
        contextId: world.contextId,
        returnByValue: true,
        awaitPromise: true,
        userGesture: gesture,
        timeout: 4000,
      },
      world.sessionId,
    )
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ?? 'Page interaction failed. Inspect again.',
      )
    return result.result?.value
  }
  private async fullscreen(page: Page, enabled: boolean) {
    // Fullscreen is a human gesture in the page, including cross-origin video frames.
    // Keep agent inspection in its separate isolated execution worlds.
    for (const frame of page.view.webContents.mainFrame.framesInSubtree) {
      if (!enabled) {
        await frame
          .executeJavaScript('document.fullscreenElement ? document.exitFullscreen() : undefined')
          .catch(() => {})
      } else {
        const entered = await frame
          .executeJavaScript(
            `(async () => {
          const video = [...document.querySelectorAll('video')].filter(v => v.getClientRects().length).sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
          if (!video) return false;
          await video.requestFullscreen();
          return true;
        })()`,
            true,
          )
          .catch(() => false)
        if (entered) break
      }
    }
    // The native enter/leave events own this state, including a new request
    // that arrives while the previous exit is finishing in another frame.
  }
  private permitted(page: Page, caller: BrowserCaller) {
    return (
      (page.state.threadId === PANEL_BROWSER_THREAD || this.hasThread(page.state.threadId)) &&
      caller.valid() &&
      (caller.hosted ? page.hosted : page.state.sharedWith.includes(caller.id))
    )
  }
  async call(caller: BrowserCaller, raw: BrowserCommand): Promise<BrowserReply> {
    try {
      const command = browserCommand.parse(raw)
      if (command.action === 'list')
        return {
          ok: true,
          browsers: [...this.pages.values()]
            .filter((p) => this.permitted(p, caller))
            .map((p) => ({ ...p.state, sharedWith: [] })),
        }
      const page = this.pages.get(command.browserId ?? '')
      if (!page || !this.permitted(page, caller))
        throw Error(
          'Browser access unavailable. Ask the human to share this browser with your connection.',
        )
      if (command.action === 'receipt')
        return (
          this.receipts.get(`${caller.id}:${page.state.id}:${command.operationId}`)?.reply ?? {
            ok: false,
            reason: 'Receipt unavailable. Do not replay an uncertain action.',
          }
        )
      if (command.action === 'release') {
        if (page.lease?.caller.id === caller.id) this.interrupt(page)
        return { ok: true, state: { ...page.state, sharedWith: [] } }
      }
      if (!page.state.visible || !this.panel.isVisible())
        throw Error('Open this browser in Threadlight before agent interaction.')
      if (command.action === 'inspect' || command.action === 'screenshot') {
        if (page.busy) throw Error('Browser action in progress. Try again when it finishes.')
        const frames = command.action === 'inspect' ? await this.frames(page) : []
        const revision = ++page.state.revision
        const observation = []
        if (command.action === 'inspect') {
          for (const [index, frame] of frames.entries()) {
            try {
              observation.push({
                frame: index,
                url: frame.url,
                ...(await this.evaluate(page, inspectScript, index, false, frame)),
              })
            } catch {
              observation.push({ frame: index, unavailable: true })
            }
          }
        }
        const jpeg =
          command.action === 'screenshot'
            ? (await page.view.webContents.capturePage())
                .resize({ width: Math.min(1400, page.view.getBounds().width || 1400) })
                .toJPEG(75)
                .toString('base64')
            : undefined
        if (!this.permitted(page, caller) || revision !== page.state.revision)
          throw Error('Page changed during observation. Inspect again.')
        this.publish(page)
        return { ok: true, state: { ...page.state, sharedWith: [] }, observation, jpeg }
      }
      if (!command.operationId) throw Error('An operationId is required for browser actions.')
      const key = `${caller.id}:${page.state.id}:${command.operationId}`
      const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex')
      const previous = this.receipts.get(key)
      if (previous)
        return previous.fingerprint === fingerprint
          ? previous.reply
          : { ok: false, reason: 'This operationId belongs to different arguments.' }
      if (command.revision !== page.state.revision)
        throw Error('Page changed. Inspect again before acting.')
      if (
        page.busy ||
        (page.lease && page.lease.until > Date.now() && page.lease.caller.id !== caller.id)
      )
        throw Error('Another agent controls this browser.')
      const receipt = {
        fingerprint,
        reply: { ok: false, outcome: 'pending' as BrowserReply['outcome'] } as BrowserReply,
      }
      this.receipts.set(key, receipt)
      this.save()
      page.lease = { caller, until: Date.now() + 30000 }
      page.state.controller = caller.label
      page.busy = true
      const epoch = page.epoch
      this.publish(page)
      try {
        await this.perform(page, command, () => {
          if (epoch !== page.epoch || !this.permitted(page, caller))
            throw Error('Control interrupted.')
        })
        if (epoch !== page.epoch || !this.permitted(page, caller))
          receipt.reply = {
            ok: false,
            outcome: 'interrupted',
            reason: 'Control was interrupted. Inspect before continuing.',
          }
        else receipt.reply = { ok: true, outcome: 'done', state: { ...page.state, sharedWith: [] } }
      } catch (error) {
        receipt.reply = { ok: false, outcome: 'uncertain', reason: (error as Error).message }
      } finally {
        page.busy = false
        page.state.revision++
        this.publish(page)
        this.save()
      }
      if (receipt.reply.state) receipt.reply.state = { ...page.state, sharedWith: [] }
      this.save()
      return receipt.reply
    } catch (error) {
      return { ok: false, reason: (error as Error).message }
    }
  }
  private async perform(page: Page, command: BrowserCommand, verify = () => {}) {
    verify()
    const contents = page.view.webContents
    switch (command.action) {
      case 'navigate': {
        const url = browserUrl(command.url ?? '')
        void contents.loadURL(url).catch((error) => {
          if (error.code === 'ERR_ABORTED' || error.errno === -3) return
          page.state.error = error.message
          this.publish(page)
        })
        break
      }
      case 'back':
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
        break
      case 'forward':
        if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
        break
      case 'reload':
        contents.reload()
        break
      case 'click':
      case 'type': {
        if (!command.element) throw Error('Inspect and supply an element number.')
        if (command.action === 'type' && command.text === undefined)
          throw Error('Text is required.')
        await this.evaluate(
          page,
          `(() => {
          const e = globalThis.__threadlightElements?.[${command.element - 1}];
          if (!e?.isConnected || !e.getClientRects().length || e.disabled) throw Error('Element changed. Inspect again.');
          if (globalThis.__threadlightSignature(e) !== globalThis.__threadlightSignatures[${command.element - 1}]) throw Error('Element changed. Inspect again.');
          e.scrollIntoView({block:'center'});
          ${command.action === 'click' ? 'e.click();' : `if (!e.matches('input,textarea,[contenteditable="true"]')) throw Error('Element is not editable.'); e.focus();`}
        })()`,
          command.frame,
          true,
        )
        if (command.action === 'type') {
          verify()
          contents.focus()
          await contents.insertText(command.text!)
        }
        break
      }
      case 'play':
      case 'pause':
      case 'seek':
      case 'skip':
      case 'rate': {
        if (!command.element) throw Error('Inspect and select a media element.')
        if (['seek', 'skip'].includes(command.action) && command.seconds === undefined)
          throw Error('Seconds are required.')
        if (command.action === 'rate' && command.rate === undefined)
          throw Error('Playback rate is required.')
        await this.evaluate(
          page,
          mediaAction(command.action, command.element, command.seconds, command.rate),
          command.frame,
          true,
        )
        break
      }
      case 'key': {
        if (!command.key) throw Error('A key is required.')
        contents.focus()
        page.injecting = true
        try {
          contents.sendInputEvent({ type: 'keyDown', keyCode: command.key })
          contents.sendInputEvent({ type: 'keyUp', keyCode: command.key })
        } finally {
          page.injecting = false
        }
        break
      }
      case 'scroll':
        await this.evaluate(page, `window.scrollBy(0, ${command.deltaY ?? 500})`, command.frame)
        break
      default:
        throw Error('Unsupported browser action.')
    }
  }
  private async ui(raw: unknown): Promise<
    BrowserReply & {
      connections?: { id: string; label: string }[]
      hosted?: boolean
      access?: import('../../shared/browser').BrowserAccess[]
    }
  > {
    const input = z
      .object({ action: z.string(), browserId: z.string().optional() })
      .passthrough()
      .parse(raw)
    if (input.action === 'caption') {
      const { threadId, text } = z
        .object({ threadId: z.string().max(300).nullable(), text: z.string().max(2000) })
        .parse(input)
      this.captionTarget = { threadId, text }
      this.positionCaption()
      return { ok: true }
    }
    if (input.action === 'access')
      return {
        ok: true,
        access: [
          ...this.restored
            .filter((saved) => !this.pages.has(saved.id))
            .map((saved) => ({
              ...saved,
              title: saved.threadId === PANEL_BROWSER_THREAD ? 'Browser' : saved.url,
            })),
          ...[...this.pages.values()].map((page) => ({ ...page.state, hosted: page.hosted })),
        ],
      }
    if (input.action === 'connections')
      return {
        ok: true,
        connections: this.connections()
          .filter((c) => ['approved', 'connected'].includes(c.state))
          .map((c) => ({
            id: c.id,
            label: `${c.provider} · ${c.label}${c.projectName ? ' · ' + c.projectName : ''}`,
          })),
      }
    if (input.action === 'attach') {
      const value = z
        .object({ threadId: z.string().max(300), token: z.string().uuid() })
        .parse(input)
      const page = this.create(value.threadId)
      this.hideAll()
      page.token = value.token
      page.state.visible = true
      page.view.setVisible(false)
      this.publish(page)
      return { ok: true, state: page.state, hosted: page.hosted }
    }
    const page = this.pages.get(input.browserId ?? '')
    if (!page && input.action === 'share') {
      const saved = this.restored.find((entry) => entry.id === input.browserId)
      if (!saved) throw Error('Browser unavailable.')
      const value = z
        .object({ connections: z.array(z.string().uuid()).max(100), hosted: z.boolean() })
        .parse(input)
      const available = new Set(
        this.connections()
          .filter((c) => ['approved', 'connected'].includes(c.state))
          .map((c) => c.id),
      )
      if (value.connections.some((id) => !available.has(id) && !saved.sharedWith.includes(id)))
        throw Error('Connection unavailable. Refresh browser access settings.')
      const previous = { ...saved }
      saved.sharedWith = value.connections.filter((id) => available.has(id))
      saved.hosted = value.hosted
      try {
        this.save()
      } catch (error) {
        Object.assign(saved, previous)
        throw error
      }
      return { ok: true }
    }
    if (!page) throw Error('Browser unavailable.')
    if (input.action === 'video-grip') {
      if (
        !page.state.visible ||
        !page.state.fullscreen ||
        !page.state.videoAspect ||
        !this.videoSizing.active
      )
        throw Error('Expand a video to resize it.')
      const gesture = videoGripGesture.parse(input.gesture)
      if (gesture.phase === 'begin') this.interrupt(page)
      const layout = this.videoSizing.gesture(
        gesture,
        page.view.getBounds(),
        page.state.videoAspect,
      )
      if (layout) page.videoLayout = layout
      if (page.state.videoSized !== this.videoSizing.sized) this.publish(page)
      return { ok: true }
    } else if (input.action === 'bounds') {
      const value = z
        .object({
          token: z.string().uuid(),
          covered: z.boolean().optional(),
          videoInsets: z
            .object({
              width: z.number().finite().nonnegative(),
              height: z.number().finite().nonnegative(),
            })
            .optional(),
          bounds: z.object({
            x: z.number().finite(),
            y: z.number().finite(),
            width: z.number().finite(),
            height: z.number().finite(),
          }),
        })
        .parse(input)
      if (value.token === page.token) {
        page.covered = value.covered ?? false
        page.bounds = value.bounds
        if (value.videoInsets && page.videoLayout && !page.covered)
          this.videoSizing.fitViewport(page.videoLayout.viewport, value.videoInsets)
        this.position(page)
      }
    } else if (input.action === 'detach') {
      if (input.token === page.token) this.hideAll()
    } else if (input.action === 'share') {
      const value = z
        .object({ connections: z.array(z.string().uuid()).max(100), hosted: z.boolean() })
        .parse(input)
      const available = new Set(
        this.connections()
          .filter((c) => ['approved', 'connected'].includes(c.state))
          .map((c) => c.id),
      )
      if (value.connections.some((id) => !available.has(id) && !page.state.sharedWith.includes(id)))
        throw Error('Connection unavailable. Refresh sharing controls.')
      const previous = { sharedWith: page.state.sharedWith, hosted: page.hosted }
      page.state.sharedWith = value.connections.filter((id) => available.has(id))
      page.hosted = value.hosted
      try {
        this.save()
      } catch (error) {
        page.state.sharedWith = previous.sharedWith
        page.hosted = previous.hosted
        throw error
      }
      this.interrupt(page)
    } else if (input.action === 'fullscreen') {
      this.interrupt(page)
      await this.fullscreen(page, !page.state.fullscreen)
    } else if (input.action === 'close') {
      const restored = this.restored
      this.pages.delete(page.state.id)
      this.restored = this.restored.filter((p) => p.id !== page.state.id)
      try {
        this.save()
      } catch (error) {
        this.pages.set(page.state.id, page)
        this.restored = restored
        throw error
      }
      this.interrupt(page)
      if (page.state.visible) this.resetVideoSizing()
      this.panel.contentView.removeChildView(page.view)
      page.view.webContents.session.protocol.unhandle('threadlight-browser-file')
      page.view.webContents.close({ waitForBeforeUnload: false })
      return { ok: true }
    } else if (input.action === 'external') {
      await shell.openExternal(browserUrl(page.state.url))
    } else if (input.action === 'local') {
      const selected = await dialog.showOpenDialog(this.panel, {
        properties: ['openFile'],
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
      })
      if (!selected.canceled && selected.filePaths[0]) {
        this.interrupt(page)
        const file = await realpath(selected.filePaths[0])
        page.localRoot = dirname(file)
        await page.view.webContents.loadURL(
          `threadlight-browser-file://local/${encodeURIComponent(relative(page.localRoot, file))}`,
        )
      }
    } else if (input.action === 'takeover') this.interrupt(page)
    else {
      const command = browserCommand.parse(input)
      if (READ_ACTIONS.has(command.action)) throw Error('Unsupported human browser request.')
      this.interrupt(page)
      await this.perform(page, command)
    }
    this.publish(page)
    return { ok: true, state: page.state, hosted: page.hosted }
  }
}
