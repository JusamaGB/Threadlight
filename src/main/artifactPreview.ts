import { randomUUID } from 'node:crypto'
import { ipcMain, session, WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import { IPC } from '../shared/ipc'
import { ARTIFACT_THEME_CSS } from '../shared/artifacts'
import { isObject } from './sessions/json'

// Response headers apply even to a complete HTML document with its own head/CSP.
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox allow-scripts',
].join('; ')

// CSP does not cover WebRTC. Run before any artifact code, and lock both aliases.
// The opaque sandbox plus frame/worker restrictions prevent another script realm
// from lending the artifact an unmodified constructor. No app API is exposed.
const BOOTSTRAP = `<!doctype html><script>
for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}
</script><style>${ARTIFACT_THEME_CSS}</style>`

/** One memory-only browser session, no preload or access to the app's session. */
export function registerArtifactPreview(
  panel: BrowserWindow,
  readHtml: (threadId: string, id: string) => Promise<string>,
) {
  const isolated = session.fromPartition(`artifact-preview-${randomUUID()}`, { cache: false })
  let current:
    | { token: string; url: string; html: string; view?: WebContentsView; bounds?: Rectangle }
    | undefined
  const close = () => {
    const old = current
    current = undefined
    if (old?.view) {
      if (!panel.isDestroyed()) panel.contentView.removeChildView(old.view)
      if (!old.view.webContents.isDestroyed())
        old.view.webContents.close({ waitForBeforeUnload: false })
    }
    void isolated.clearStorageData().catch(() => {})
  }
  // No filesystem mapping and no server: serve only one exact in-memory document.
  isolated.protocol.handle('threadlight-artifact', (request) => {
    if (!current || request.url !== current.url || request.method !== 'GET')
      return new Response('Unavailable', { status: 404 })
    return new Response(BOOTSTRAP + current.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': PREVIEW_CSP,
        'Connection-Allowlist': '()',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-DNS-Prefetch-Control': 'off',
        'Permissions-Policy':
          'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=()',
      },
    })
  })
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel:
        !(current && details.url === current.url && details.resourceType === 'mainFrame') &&
        !(
          (details.url.startsWith('data:') || details.url.startsWith('blob:')) &&
          ['image', 'font', 'media'].includes(details.resourceType)
        ),
    }),
  )
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.setDevicePermissionHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  const position = () => {
    if (!current?.view || !current.bounds || panel.isDestroyed()) return
    const [width = 0, height = 0] = panel.getContentSize()
    const b = current.bounds
    const x = Math.max(0, Math.min(width, Math.round(b.x)))
    const y = Math.max(0, Math.min(height, Math.round(b.y)))
    const w = Math.max(0, Math.min(width - x, Math.round(b.width)))
    const h = Math.max(0, Math.min(height - y, Math.round(b.height)))
    current.view.setBounds({ x, y, width: w, height: h })
    current.view.setVisible(w > 0 && h > 0)
  }
  panel.on('resize', position)
  panel.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) close()
  })
  panel.on('closed', () => {
    close()
    isolated.protocol.unhandle('threadlight-artifact')
    isolated.webRequest.onBeforeRequest(null)
  })
  ipcMain.handle(IPC.artifactPreview, async (event, input: unknown) => {
    if (event.sender !== panel.webContents || event.senderFrame !== panel.webContents.mainFrame)
      return { ok: false, reason: 'Preview unavailable.' }
    if (!isObject(input) || typeof input.token !== 'string' || input.token.length > 100)
      return { ok: false, reason: 'Invalid preview request.' }
    if (input.action === 'close') {
      if (current?.token === input.token) close()
      return { ok: true }
    }
    if (input.action === 'bounds') {
      const b = input.bounds
      if (
        !isObject(b) ||
        !['x', 'y', 'width', 'height'].every(
          (key) => typeof b[key] === 'number' && Number.isFinite(b[key]),
        )
      )
        return { ok: false, reason: 'Invalid preview bounds.' }
      if (current?.token === input.token) {
        current.bounds = b as unknown as Rectangle
        position()
      }
      return { ok: true }
    }
    if (
      input.action !== 'open' ||
      typeof input.threadId !== 'string' ||
      typeof input.id !== 'string'
    )
      return { ok: false, reason: 'Invalid preview request.' }
    close()
    const opened = {
      token: input.token,
      url: `threadlight-artifact://preview/${randomUUID()}`,
      html: '',
    } as NonNullable<typeof current>
    current = opened
    try {
      opened.html = await readHtml(input.threadId, input.id)
      if (current !== opened || panel.isDestroyed()) return { ok: false, reason: 'Preview closed.' }
      const view = new WebContentsView({
        webPreferences: {
          session: isolated,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          webviewTag: false,
          navigateOnDragDrop: false,
          safeDialogs: true,
          disableDialogs: true,
          spellcheck: false,
        },
      })
      opened.view = view
      view.setVisible(false)
      panel.contentView.addChildView(view)
      const contents = view.webContents
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-navigate', (event) => event.preventDefault())
      contents.on('will-frame-navigate', (event) => event.preventDefault())
      contents.on('will-redirect', (event) => event.preventDefault())
      contents.on('will-attach-webview', (event) => event.preventDefault())
      contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
        if (!mainFrame || inPlace || url === opened.url || current !== opened) return
        close()
        if (!panel.isDestroyed())
          panel.webContents.send(IPC.artifactPreviewEvent, {
            token: opened.token,
            type: 'failed',
            reason:
              'This preview supports a single page. Refresh to reopen the interactive artifact.',
          })
      })
      contents.on('before-input-event', (event, key) => {
        if (key.type === 'keyDown' && key.key === 'Escape') {
          event.preventDefault()
          panel.webContents.send(IPC.artifactPreviewEvent, { token: opened.token, type: 'escape' })
          panel.webContents.focus()
        }
        if (
          key.type === 'keyDown' &&
          (key.key === 'ArrowLeft' || key.key === 'ArrowRight') &&
          !key.control &&
          !key.alt &&
          !key.meta &&
          !key.shift
        ) {
          // The guest has no app bridge. Read only its focus classification; keep editing
          // and slider arrows inside the artifact, and forward ordinary viewer navigation.
          void contents
            .executeJavaScript(
              `(() => {
            let element = document.activeElement;
            while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
            return !!(element?.isContentEditable || element?.closest('input, textarea, select, [role="textbox"], [role="slider"], [role="spinbutton"]'));
          })()`,
            )
            .then((editing: boolean) => {
              if (editing || current !== opened || panel.isDestroyed()) return
              panel.webContents.send(IPC.artifactPreviewEvent, {
                token: opened.token,
                type: key.key === 'ArrowLeft' ? 'previous' : 'next',
              })
            })
            .catch(() => {})
        }
      })
      contents.on('render-process-gone', () => {
        if (current !== opened || panel.isDestroyed()) return
        close()
        panel.webContents.send(IPC.artifactPreviewEvent, {
          token: opened.token,
          type: 'failed',
          reason: 'The interactive preview stopped. Refresh to try again.',
        })
      })
      await contents.loadURL(opened.url)
      if (current === opened) position()
      return { ok: current === opened }
    } catch (error) {
      if (current === opened) close()
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Could not open preview.',
      }
    }
  })
}
