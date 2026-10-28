/* global window, document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  existsSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
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
      entry: join(root, 'test/ui/artifacts-native.fixture.ts'),
      formats: ['cjs'],
      fileName: () => 'artifacts-native.fixture.js',
    },
    rollupOptions: { external: ['electron'] },
  },
})
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/artifacts-native.fixture.js')],
  env,
})
const preview = (script) =>
  app.evaluate(({ webContents }, code) => {
    const contents = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('threadlight-artifact:'))
    return contents ? contents.executeJavaScript(code) : null
  }, script)
const waitPreview = async (script) => {
  for (let i = 0; i < 100; i++) {
    if (await preview(script).catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const diagnostics = await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .map((c) => ({ id: c.id, url: c.getURL(), title: c.getTitle() })),
  )
  throw new Error(`Preview did not become ready: ${script}; ${JSON.stringify(diagnostics)}`)
}
const pressPreview = (keyCode) =>
  app.evaluate(({ webContents }, keyCode) => {
    const contents = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('threadlight-artifact:'))
    contents.focus()
    contents.sendInputEvent({ type: 'keyDown', keyCode })
    contents.sendInputEvent({ type: 'keyUp', keyCode })
  }, keyCode)
try {
  console.log('Preview runtime Chromium:', await app.evaluate(() => process.versions.chrome))
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const paths = await app.evaluate(() => ({
    directory: globalThis.artifactProof.directory,
    fixturePath: globalThis.artifactProof.fixturePath,
    transcript: globalThis.artifactProof.transcript,
  }))
  const tile = page.getByRole('button', { name: 'Open artifact: Artifact test.html', exact: true })
  await tile.waitFor()
  assert.equal(
    existsSync(join(paths.directory, 'thread-artifacts')),
    false,
    'automatic discovery writes no copies or index files',
  )
  await page.getByRole('button', { name: /Artifact test thread/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Artifacts…', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[data-card]').getBoundingClientRect().width > 450,
  )
  await page.getByRole('button', { name: 'Link file…' }).click()
  await page
    .getByRole('navigation', { name: 'Thread artifact navigation' })
    .getByRole('button', { name: 'Open artifact 1: Artifact test.html', exact: true })
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Back to threads' }).click()
  await tile.click()
  await waitPreview(`document.querySelector('h1')?.textContent === 'Native artifact test'`)
  // A finished reply arrives while the viewer stays open. No Link or Refresh action.
  const livePath = join(paths.directory, 'Live storyboard.html')
  writeFileSync(
    livePath,
    '<main id="adaptive" class="viz-dotted-background" style="background-color:light-dark(#ffffff,#22221f);color:light-dark(#000000,#e1e2dc)"><h1>Live storyboard</h1><button onclick="this.textContent=\'Playing\'">Play</button></main>',
  )
  appendFileSync(
    paths.transcript,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: `Press Play demo.\n\n\uE200visualize\uE202${JSON.stringify({ path: livePath })}\uE201`,
          },
        ],
      },
    }) + '\n',
  )
  const liveChip = page
    .getByRole('navigation', { name: 'Thread artifact navigation' })
    .getByRole('button', { name: /Open artifact \d+: Live storyboard.html/ })
  await liveChip.waitFor({ timeout: 10000 })
  const catalog = await page.evaluate(() =>
    window.threadlight.artifacts('codex:artifact-native-test', 'list'),
  )
  renameSync(paths.transcript, paths.transcript + '.unavailable')
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const retry = await page.evaluate(() =>
        window.threadlight.artifacts('codex:artifact-native-test', 'list'),
      )
      assert.equal(retry.ok, true)
      assert.deepEqual(retry.items, catalog.items, 'transcript outages preserve artifact counts')
      assert.match(retry.notice, /could not be read/)
    }
  } finally {
    renameSync(paths.transcript + '.unavailable', paths.transcript)
  }
  await waitPreview(`document.querySelector('h1')?.textContent === 'Native artifact test'`)
  await preview(`document.querySelector('#size').focus()`)
  await pressPreview('Right')
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(
    await liveChip.getAttribute('aria-pressed'),
    'false',
    'slider arrows do not change artifacts',
  )
  await preview(`document.activeElement.blur()`)
  await pressPreview('Right')
  await waitPreview(`document.querySelector('h1')?.textContent === 'Live storyboard'`)
  assert.equal(await liveChip.getAttribute('aria-pressed'), 'true')
  await pressPreview('Right')
  await waitPreview(`document.querySelector('h1')?.textContent === 'Native artifact test'`)
  await pressPreview('Left')
  await waitPreview(`document.querySelector('h1')?.textContent === 'Live storyboard'`)
  await pressPreview('Left')
  await waitPreview(`document.querySelector('h1')?.textContent === 'Native artifact test'`)
  await liveChip.click()
  await waitPreview(`document.querySelector('h1')?.textContent === 'Live storyboard'`)
  assert.deepEqual(
    await preview(
      `({ scheme: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.querySelector('#adaptive')).backgroundColor, color: getComputedStyle(document.querySelector('#adaptive')).color, dots: getComputedStyle(document.querySelector('#adaptive')).backgroundImage.includes('radial-gradient') })`,
    ),
    { scheme: 'dark only', background: 'rgb(34, 34, 31)', color: 'rgb(225, 226, 220)', dots: true },
    'host-dependent fragments use the dark panel appearance',
  )
  assert.equal(
    await preview(
      `const theme = document.createElement('style'); theme.textContent = 'html { color-scheme: light; }'; document.head.append(theme); getComputedStyle(document.querySelector('#adaptive')).backgroundColor`,
    ),
    'rgb(34, 34, 31)',
    'the viewer remains dark when a document requests a light color scheme',
  )
  assert.equal(
    await preview(
      `document.querySelector('button').click(); document.querySelector('button').textContent`,
    ),
    'Playing',
  )
  assert.equal(
    existsSync(join(paths.directory, 'thread-artifacts')),
    true,
    'earlier manual Link stores metadata only',
  )
  // Restore the isolated transcript for the existing original/copy checks below.
  writeFileSync(
    paths.transcript,
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `[View artifact](<${paths.fixturePath}>)` }],
      },
    }) + '\n',
  )
  await liveChip.waitFor({ state: 'detached', timeout: 10000 })
  await page
    .getByRole('navigation', { name: 'Thread artifact navigation' })
    .getByRole('button', { name: 'Open artifact 1: Artifact test.html', exact: true })
    .click()
  await waitPreview(`document.querySelector('h1')?.textContent === 'Native artifact test'`)
  assert.deepEqual(
    await preview(
      `({ node: typeof process, require: typeof require, bridge: typeof window.threadlight })`,
    ),
    { node: 'undefined', require: 'undefined', bridge: 'undefined' },
  )
  assert.equal(
    await preview(
      `document.querySelector('#counter').click(); document.querySelector('#counter').textContent`,
    ),
    'Count: 1',
  )
  assert.equal(
    await preview(
      `document.querySelector('#size').value = '70'; document.querySelector('#size').dispatchEvent(new Event('input')); document.querySelector('#pulse').style.fontSize`,
    ),
    '70px',
  )
  assert.equal(
    await preview(
      `document.querySelector('#canvas').getContext('2d').getImageData(0,0,1,1).data[3]`,
    ),
    255,
  )
  assert.equal(await preview(`document.getAnimations().length > 0`), true)
  if (process.env.THREADLIGHT_SCREENSHOTS) {
    mkdirSync(process.env.THREADLIGHT_SCREENSHOTS, { recursive: true })
    await app.evaluate(() => globalThis.artifactProof.panel.showInactive())
    await page.waitForTimeout(1200) // Let the native compositor finish the dual-width transition.
    const screenshot = await app.evaluate(async ({ desktopCapturer }) => {
      const panel = globalThis.artifactProof.panel
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 500, height: 600 },
      })
      return sources
        .find((source) => source.id === panel.getMediaSourceId())
        .thumbnail.toPNG()
        .toString('base64')
    })
    writeFileSync(
      join(process.env.THREADLIGHT_SCREENSHOTS, 'interactive-artifact-controls.png'),
      Buffer.from(screenshot, 'base64'),
    )
  }
  assert.equal(
    await preview(`try { localStorage.setItem('test','private'); false } catch { true }`),
    true,
  )
  assert.deepEqual(
    await preview(
      `Promise.all(['https://example.invalid/test', 'http://127.0.0.1:47615/status', 'file:///C:/Windows/win.ini'].map(url => fetch(url).then(() => false, () => true)))`,
    ),
    [true, true, true],
  )
  assert.equal(await preview(`window.open('https://example.invalid') === null`), true)
  assert.equal(
    await preview(
      `new Promise(resolve => { try { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], {type:'text/javascript'}))); w.onmessage = () => { w.terminate(); resolve(false) }; w.onerror = () => { w.terminate(); resolve(true) }; setTimeout(() => { w.terminate(); resolve(false) }, 1500) } catch { resolve(true) } })`,
    ),
    true,
  )
  assert.equal(
    await preview(
      `typeof RTCPeerConnection === 'undefined' && typeof webkitRTCPeerConnection === 'undefined' && !delete window.RTCPeerConnection`,
    ),
    true,
    'WebRTC constructors are unavailable and locked',
  )
  assert.equal(
    await preview(
      `try { Object.defineProperty(window, 'RTCPeerConnection', {value: function(){}}); false } catch { true }`,
    ),
    true,
  )
  assert.equal(
    await preview(
      `const frame = document.createElement('iframe'); document.body.append(frame); try { const constructor = frame.contentWindow.RTCPeerConnection; typeof constructor === 'undefined' } catch { true }`,
    ),
    true,
    'blank child frame cannot supply a constructor',
  )
  assert.equal(
    await preview(
      `document.open(); document.write('<p>Reset document</p>'); document.close(); typeof RTCPeerConnection === 'undefined' && !Object.getOwnPropertyDescriptor(window, 'RTCPeerConnection').configurable`,
    ),
    true,
    'document replacement cannot restore peer connections',
  )
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await waitPreview(`document.querySelector('#counter')?.textContent === 'Count: 0'`)
  await preview(`location.href = 'https://example.invalid/escape'; true`).catch(() => {})
  await page
    .getByRole('alert')
    .filter({ hasText: 'This preview supports a single page.' })
    .waitFor()
  assert.equal(await preview('true'), null)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await waitPreview(`document.querySelector('#counter')?.textContent === 'Count: 0'`)
  // Escape from the guest must return through the host's own controls.
  await app.evaluate(({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('threadlight-artifact:'))
    contents.focus()
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  })
  await tile.waitFor()
  await tile.click()
  await waitPreview(`document.querySelector('#counter')?.textContent === 'Count: 0'`)
  const files = await page.evaluate(() =>
    window.threadlight.artifacts('codex:artifact-native-test', 'list'),
  )
  assert.equal(files.ok, true)
  assert.equal(files.items.length, 1)
  assert.equal(files.items[0].source, 'reference')
  const storeDir = join(paths.directory, 'thread-artifacts')
  const savedDir = join(storeDir, readdirSync(storeDir)[0])
  assert.deepEqual(readdirSync(savedDir), ['index.json'], 'linking stores metadata only')
  writeFileSync(paths.fixturePath, '<h1>Updated original</h1>')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await waitPreview(`document.querySelector('h1')?.textContent === 'Updated original'`)
  await page.getByRole('button', { name: 'Keep a copy', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('nav[aria-label="Thread artifact navigation"] button[aria-pressed]')
        .length === 2,
  )
  const persisted = JSON.parse(readFileSync(join(savedDir, 'index.json'), 'utf8'))
  const copy = persisted.find((item) => item.source === 'copy')
  assert(copy)
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('nav[aria-label="Thread artifact navigation"] button[aria-pressed="true"]')
        ?.getAttribute('data-artifact-id') === id,
    copy.id,
  )
  unlinkSync(paths.fixturePath)
  const missing = await page.evaluate(
    (id) => window.threadlight.artifacts('codex:artifact-native-test', 'read', id),
    files.items[0].id,
  )
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /moved or been deleted/)
  const wrong = await page.evaluate(
    (id) => window.threadlight.artifacts('codex:other-artifact-thread', 'read', id),
    files.items[0].id,
  )
  assert.equal(wrong.ok, false)
  assert.match(wrong.reason, /not found in this thread/)
  await page.reload()
  await tile.first().click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'The original file has moved or been deleted.' })
    .waitFor()
  assert.equal(
    await page.locator('nav[aria-label="Thread artifact navigation"] button[aria-pressed]').count(),
    2,
    'a missing initial reference still leaves other artifacts selectable',
  )
  await page.locator(`[data-artifact-id="${copy.id}"]`).click()
  await waitPreview(`document.querySelector('h1')?.textContent === 'Updated original'`)
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector('[data-card]').getBoundingClientRect().width - 475) < 1 &&
      document.querySelector('[aria-label="Interactive artifact preview"]').getBoundingClientRect()
        .width > 430,
  )
  if (process.env.THREADLIGHT_SCREENSHOTS) {
    mkdirSync(process.env.THREADLIGHT_SCREENSHOTS, { recursive: true })
    await app.evaluate(() => globalThis.artifactProof.panel.showInactive())
    await page.waitForTimeout(300)
    const screenshot = await app.evaluate(async () =>
      (await globalThis.artifactProof.panel.capturePage()).toPNG().toString('base64'),
    )
    writeFileSync(
      join(process.env.THREADLIGHT_SCREENSHOTS, 'native-artifact-viewer.png'),
      Buffer.from(screenshot, 'base64'),
    )
  }
  assert.deepEqual(errors, [])
  await app.evaluate(({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('threadlight-artifact:'))
    void contents.executeJavaScript('while (true) {}').catch(() => {})
  })
  await page.getByRole('button', { name: 'Back to threads' }).click()
  assert.equal(await preview('true'), null, 'closing disposes the guest renderer')
  console.log(
    'PASS: interactive counter/slider/canvas/animation; no Node/app bridge; blocked fetch/file/loopback/worker/WebRTC/popups/storage; navigation fallback; Escape; original Refresh and explicit copies; closing a frozen renderer; real Electron integration.',
  )
} finally {
  await app.close()
}
