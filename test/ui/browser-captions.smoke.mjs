/* global window, document, AudioContext */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { build } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const { _electron } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    ssr: true,
    target: 'node22',
    outDir: join(root, 'out/main'),
    emptyOutDir: false,
    lib: {
      entry: join(root, 'test/ui/browser.fixture.ts'),
      formats: ['cjs'],
      fileName: () => 'browser.fixture.js',
    },
    rollupOptions: { external: ['electron'] },
  },
})
const env = {
  ...process.env,
  THREADLIGHT_BROWSER_CAPTION_FIXTURE: '1',
  THREADLIGHT_BROWSER_GRIP_FIXTURE: '1',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/browser.fixture.js'), '--mute-audio'],
  env,
})
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.error(e.message))
  page.setDefaultTimeout(8000)
  await page.getByRole('button', { name: /Artifact test thread/ }).waitFor()
  await app.evaluate(async () => {
    while (!globalThis.browserProof) await new Promise((r) => setTimeout(r, 25))
  })
  const idle = await page.evaluate(() => window.threadlight.getAgent())
  const recent = {
    id: 'caption-chat',
    provider: 'codex',
    summary: 'Previous conversation',
    waiting: false,
    at: Date.now(),
  }
  let revision = 0
  const history = {
    kind: 'agent',
    id: 'live:old',
    text: 'Words from the previous call',
    liveComplete: true,
  }
  const agent = (live, items) =>
    app.evaluate(
      (_e, state) => globalThis.artifactProof.panel.webContents.send('agent:changed', state),
      {
        ...idle,
        provider: 'codex',
        conversationId: recent.id,
        recent,
        revision: ++revision,
        live: live ? 'active' : null,
        items,
      },
    )
  const openBrowser = async () => {
    await page.getByRole('banner', { name: 'Panel header' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
    await page.getByLabel('Shared browser', { exact: true }).waitFor()
  }
  const back = () => page.getByRole('button', { name: 'Back to threads' }).click()
  await agent(false, [history])
  await page.getByRole('button', { name: 'Open recent Agent conversation' }).waitFor()
  await openBrowser()
  assert.equal(
    await page
      .getByRole('button', { name: /Agent conversation|live conversation|Agent voice/ })
      .count(),
    0,
  )
  const url = await app.evaluate(() => globalThis.browserProof.url)
  const address = page.getByRole('textbox', { name: 'Search or enter address' })
  await address.fill(url)
  await address.press('Enter')
  const guest = (code) =>
    app.evaluate(
      ({ webContents }, code) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL() === globalThis.browserProof.url)
          ?.executeJavaScript(code, true),
      code,
    )
  for (let i = 0; i < 100 && !(await guest('!!document.querySelector("#fullscreen")')); i++)
    await new Promise((r) => setTimeout(r, 50))
  await guest('document.querySelector("#fullscreen").click()')
  await page.locator('[data-video-grips]').waitFor()
  await back()
  await page.getByRole('button', { name: /Artifact test thread/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: /Agent conversation|live conversation|Agent voice/ })
      .count(),
    0,
  )
  await back()
  // Send a real authorized panel command from the fixture's control transport.
  const navigate = () =>
    app.evaluate(() =>
      globalThis.artifactProof.panel.webContents.send('control:command', {
        instanceId: 'captions',
        generation: 1,
        commandId: 'browser-' + Date.now(),
        expiresAt: Date.now() + 10000,
        route: { page: 'browser' },
      }),
    )
  await navigate()
  await page.getByRole('button', { name: 'Return to Agent conversation' }).click()
  await page.getByRole('button', { name: 'Agent settings' }).waitFor()
  await page.evaluate(() => {
    const context = new AudioContext()
    window.navigator.mediaDevices.getUserMedia = async () =>
      context.createMediaStreamDestination().stream
    const NativeAudio = window.Audio
    window.Audio = class extends NativeAudio {
      constructor() {
        super()
        window.captionAudio = this
      }
    }
    window.RTCPeerConnection = class {
      connectionState = 'new'
      channel = { readyState: 'connecting' }
      addTrack() {}
      createDataChannel() {
        return this.channel
      }
      async createOffer() {
        return { type: 'offer', sdp: 'synthetic' }
      }
      async setLocalDescription(value) {
        this.localDescription = value
      }
      async setRemoteDescription() {
        this.connectionState = 'connected'
        this.channel.readyState = 'open'
        this.channel.onmessage({ data: '{"type":"session.started"}' })
      }
      close() {}
    }
  })
  const talk = () =>
    app.evaluate(() =>
      globalThis.artifactProof.panel.webContents.send('talk:toggle', {
        liveSessionId: 'synthetic-browser-live',
      }),
    )
  await talk()
  await page.waitForFunction(() => window.captionAudio && !window.captionAudio.muted)
  await agent(true, [history])
  await navigate()
  await page.getByRole('button', { name: 'Return to live conversation' }).waitFor()
  await back()
  await openBrowser()
  await page.getByRole('button', { name: 'Return to live conversation' }).waitFor()
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter(
          (w) => w.getTitle() === 'Agent captions' && w.isVisible(),
        ).length,
    ),
    0,
  )
  const update = (text, complete = false) =>
    agent(true, [history, { id: 'live:current', kind: 'agent', text, liveComplete: complete }])
  const caption = async (text) => {
    const state = await app.evaluate(async ({ BrowserWindow }, text) => {
      for (let i = 0; i < 100; i++) {
        const win = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === 'Agent captions' && w.isVisible(),
        )
        if (
          win &&
          (await win.webContents.executeJavaScript(
            'document.querySelector("#words").textContent',
          )) === text
        )
          return {
            bounds: win.getBounds(),
            width: await win.webContents.executeJavaScript(
              'document.querySelector("#pill").offsetWidth',
            ),
            focusable: win.isFocusable(),
          }
        await new Promise((r) => setTimeout(r, 40))
      }
      return null
    }, text)
    assert(state, 'caption window shows ' + text)
    return state
  }
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Browser page"]')?.clientWidth === 473,
  )
  for (let i = 0; i < 60 && (await guest('innerWidth')) !== 473; i++)
    await new Promise((r) => setTimeout(r, 25))
  const videoSize = await guest('[innerWidth,innerHeight]')
  assert.equal(videoSize[0], 473)
  await guest('const video = document.querySelector("video"); video.muted = false; video.play()')
  await update('The import')
  const short = await caption('The import')
  assert.equal(short.focusable, false)
  const settledSize = await guest('[innerWidth,innerHeight]')
  assert(
    Math.abs(short.bounds.width - (settledSize[0] * 2) / 3) <= 1,
    JSON.stringify({ short, videoSize, settledSize }),
  )
  await page.getByRole('button', { name: 'Mute Agent voice' }).click()
  assert(await page.evaluate(() => window.captionAudio.muted))
  const line = 'The import brings choice into this program so the video can keep playing.'
  await update(line, true)
  const wide = await caption(line)
  assert(wide.width > short.width && wide.width <= wide.bounds.width)
  const stage = await page.getByLabel('Browser page', { exact: true }).boundingBox()
  const origin = await app.evaluate(() => globalThis.artifactProof.panel.getContentBounds())
  assert(
    Math.abs(wide.bounds.x + wide.bounds.width / 2 - (origin.x + stage.x + stage.width / 2)) <= 1,
    'caption is centered over the video',
  )
  assert(
    Math.abs(wide.bounds.y - (origin.y + stage.y)) <= 1,
    'caption touches the top of the viewport',
  )
  if (process.platform === 'win32') {
    const receivesClick = await app.evaluate(
      ({ screen, BrowserWindow }, { koffiPath, bounds }) => {
        const win = globalThis.artifactProof.panel
        const user32 = process.mainModule.require(koffiPath).load('user32.dll')
        const at = user32.func('uintptr_t __stdcall WindowFromPoint(int64_t)')
        const rootHandle = user32.func('uintptr_t __stdcall GetAncestor(uintptr_t,unsigned int)')
        const p = screen.dipToScreenPoint({
          x: Math.round(bounds.x + bounds.width / 2),
          y: bounds.y + 8,
        })
        const packed = BigInt.asIntN(64, (BigInt(p.y) << 32n) | BigInt.asUintN(32, BigInt(p.x)))
        return {
          hit: String(rootHandle(at(packed), 2)),
          panel: String(win.getNativeWindowHandle().readBigUInt64LE()),
          caption: String(
            BrowserWindow.getAllWindows()
              .find((w) => w.getTitle() === 'Agent captions')
              .getNativeWindowHandle()
              .readBigUInt64LE(),
          ),
          bounds,
          point: p,
          panelBounds: win.getBounds(),
        }
      },
      { koffiPath: require.resolve('koffi'), bounds: wide.bounds },
    )
    assert.equal(receivesClick.hit, receivesClick.panel, JSON.stringify(receivesClick))
  }
  assert(
    await guest('!document.documentElement.textContent.includes(' + JSON.stringify(line) + ')'),
  )
  assert.deepEqual(await guest('[innerWidth,innerHeight]'), videoSize)
  assert(
    await guest(
      '!!document.fullscreenElement && !document.querySelector("video").muted && !document.querySelector("video").paused',
    ),
  )
  await page.getByRole('button', { name: 'Unmute Agent voice' }).click()
  assert.equal(await page.evaluate(() => window.captionAudio.muted), false)
  const grip = page.locator('[data-edge="right"]')
  await grip.click({ trial: true })
  const box = await grip.boundingBox()
  const x = box.x + box.width / 2,
    y = box.y + box.height - 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 220, y - 220)
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Browser page"]').clientWidth < 300,
  )
  await update('Shorter lines at a smaller player width.', true)
  const compact = await caption('Shorter lines at a smaller player width.')
  assert(Math.abs(compact.bounds.width - ((await guest('innerWidth')) * 2) / 3) <= 1)
  await agent(true, [history, { id: 'live:question', kind: 'you', text: 'Next question' }])
  const hidden = () =>
    app.evaluate(async ({ BrowserWindow }) => {
      for (let i = 0; i < 100; i++) {
        if (
          !BrowserWindow.getAllWindows().some(
            (w) => w.getTitle() === 'Agent captions' && w.isVisible(),
          )
        )
          return true
        await new Promise((r) => setTimeout(r, 30))
      }
      return false
    })
  assert(await hidden())
  await update('A finished reply.', true)
  await caption('A finished reply.')
  await new Promise((r) => setTimeout(r, 5600))
  assert(await hidden(), 'completed caption clears after reading time')
  await update('A new reply', true)
  await caption('A new reply')
  await talk()
  await page.getByRole('button', { name: 'Mute Agent voice' }).waitFor({ state: 'detached' })
  assert(await hidden())
  console.log(
    'Native Browser headers, streaming private captions, speaker mute, fullscreen bounds, and call cleanup passed.',
  )
} catch (error) {
  const page = await app.firstWindow()
  console.error(await page.getByRole('banner', { name: 'Panel header' }).ariaSnapshot())
  throw error
} finally {
  await app.close()
}
