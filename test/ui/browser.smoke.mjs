/* global window, document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
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
const env = { ...process.env, THREADLIGHT_BROWSER_GRIP_FIXTURE: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app = await _electron.launch({
  colorScheme: 'dark',
  executablePath: require('electron'),
  args: [join(root, 'out/main/browser.fixture.js')],
  env,
})
const children = []
function bridge(provider, config) {
  const child = spawn(
    process.execPath,
    [
      join(
        root,
        provider === 'codex'
          ? 'codex-plugin/scripts/memory-bridge.mjs'
          : 'scripts/memory-bridge.mjs',
      ),
      '--provider',
      provider,
    ],
    {
      env: {
        ...process.env,
        THREADLIGHT_MEMORY_URL: config.endpoint,
        THREADLIGHT_MEMORY_AUTH_FILE: config.authFile,
      },
      stdio: 'pipe',
      windowsHide: true,
    },
  )
  children.push(child)
  let serial = 0
  const pending = new Map()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = JSON.parse(line)
    pending.get(reply.id)?.(reply)
    pending.delete(reply.id)
  })
  return async (name, args) => {
    const id = ++serial
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Bridge timeout')), 40000)
      pending.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        }) + '\n',
      )
    })
    assert(!response.error, JSON.stringify(response.error))
    return response.result
  }
}
const data = (reply) => JSON.parse(reply.content[0].text)
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => console.error('Renderer error', error.message))
  await page.waitForFunction(() => !!window.threadlight)
  await app.evaluate(async () => {
    while (!globalThis.browserProof) await new Promise((resolve) => setTimeout(resolve, 50))
  })
  const config = await app.evaluate(() => {
    const { endpoint, authFile, spaceId, url, directory } = globalThis.browserProof
    return { endpoint, authFile, spaceId, url, directory }
  })
  const openAccess = async () => {
    await page.getByRole('button', { name: 'Back to threads' }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByText('Browser access', { exact: true }).click()
    const selection = page.getByRole('combobox', { name: 'Browser access selection' })
    await selection.waitFor()
    const access = await page.evaluate(() =>
      window.threadlight.browserRequest({ action: 'access' }),
    )
    await selection.selectOption(
      access.access.find((b) => b.threadId === 'codex:artifact-native-test').id,
    )
    await page.screenshot({ path: join(config.directory, 'browser-access-settings.png') })
  }
  const closeAccess = async () => {
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await page.getByRole('button', { name: /Artifact test thread/ }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search or enter address' }).waitFor()
  }
  const exitFullscreen = async () =>
    app.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents === globalThis.artifactProof.panel.webContents) continue
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      }
    })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('banner', { name: 'Panel header' }).click({ button: 'right' })
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), [
    'Agent',
    'Browser',
    'New',
    'Spaces',
    'Workspace',
  ])
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Search or enter address"]')?.disabled,
  )
  assert.equal(await page.getByRole('button', { name: 'Artifacts', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Back to threads' }).click()
  await page.getByRole('button', { name: /Artifact test thread/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  const address = page.getByRole('textbox', { name: 'Search or enter address' })
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Search or enter address"]')?.disabled,
  )
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Browser page"]')?.getBoundingClientRect().height > 200,
  )
  assert.equal(await page.getByRole('button', { name: 'Full screen', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Sharing', exact: true }).count(), 0)
  await page.getByAltText('Threadlight', { exact: true }).waitFor()
  await page.screenshot({ path: join(config.directory, 'browser-idle.png') })
  await address.fill('http://127.0.0.1:1/')
  await address.press('Enter')
  await page.getByRole('alert').filter({ hasText: 'Couldn’t open this page.' }).waitFor()
  assert.equal(await address.inputValue(), 'http://127.0.0.1:1/')
  assert(await page.getByRole('button', { name: 'Retry', exact: true }).isVisible())
  await page.screenshot({ path: join(config.directory, 'browser-error.png') })
  assert.equal(
    await app.evaluate(() =>
      globalThis.artifactProof.panel.contentView.children.some((view) => view.getVisible()),
    ),
    false,
    'failed native page is hidden',
  )
  const stageHeight = await page
    .getByLabel('Browser page', { exact: true })
    .evaluate((element) => element.getBoundingClientRect().height)
  await address.fill(config.url + 'slow')
  await address.press('Enter')
  await page.getByRole('status', { name: 'Loading page' }).waitFor()
  assert.equal(
    await page
      .getByLabel('Browser page', { exact: true })
      .evaluate((element) => element.getBoundingClientRect().height),
    stageHeight,
    'loading does not shift page layout',
  )
  await page.screenshot({ path: join(config.directory, 'browser-loading.png') })
  await page.getByRole('status', { name: 'Loading page' }).waitFor({ state: 'hidden' })
  if (process.env.THREADLIGHT_BROWSER_GOOGLE === '1') {
    await address.fill('CS50 week four lecture')
    await address.press('Enter')
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="Search or enter address"]')
        ?.value.includes('google.com/'),
    )
    await page
      .getByRole('status', { name: 'Loading page' })
      .waitFor({ state: 'hidden', timeout: 30000 })
    const google = await app.evaluate(async ({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().includes('google.com/'))
      return contents
        ? {
            url: contents.getURL(),
            ...(await contents.executeJavaScript(
              '({title:document.title,text:document.body.innerText.slice(0,1200),dark:matchMedia("(prefers-color-scheme: dark)").matches,background:getComputedStyle(document.body).backgroundColor})',
            )),
          }
        : null
    })
    assert(google?.url.includes('google.com/'), 'search opens Google')
    assert(google.dark, 'Google receives dark preference')
    writeFileSync(join(config.directory, 'google-result.json'), JSON.stringify(google, null, 2))
  }
  await address.fill(config.url)
  await address.press('Enter')
  const guest = async (code) =>
    app.evaluate(({ webContents }, script) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith(globalThis.browserProof.url))
      return contents?.executeJavaScript(script, true)
    }, code)
  const waitGuest = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await guest(code).catch(() => false)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw Error(`Guest did not reach ${code}`)
  }
  await waitGuest('!!document.querySelector("#counter")')
  const darkPixel = await app.evaluate(async ({ webContents }) => {
    const c = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith(globalThis.browserProof.url))
    // A clipped native capture leaves that clip as Chromium's fullscreen viewport.
    const pixel = (await c.capturePage()).crop({ x: 2, y: 2, width: 1, height: 1 }).getBitmap()
    return [...pixel.subarray(0, 3)]
  })
  assert(
    darkPixel.length === 3 && darkPixel.every((channel) => channel < 100),
    'light site background renders dark',
  )

  console.log(
    'Browser rectangle',
    await app.evaluate(() =>
      globalThis.artifactProof.panel.contentView.children.map((v) => v.getBounds()),
    ),
  )
  const agents = []
  for (const provider of ['codex', 'claude']) {
    const call = bridge(provider, config)
    const chatId = randomUUID()
    const requested = data(
      await call('memory_connect', {
        label: `Browser ${provider}`,
        chatId,
        spaceId: config.spaceId,
      }),
    )
    assert(requested.connectionId)
    await app.evaluate(
      (_electron, { id, provider, chatId }) => {
        const proof = globalThis.browserProof
        proof.server.connections.approve(id, {
          action: 'create_grant',
          spaceId: proof.spaceId,
          title: 'Synthetic browser access',
          assignee: provider === 'codex' ? `codex:${chatId}` : chatId,
          readOnly: false,
        })
      },
      { id: requested.connectionId, provider, chatId },
    )
    await call('memory_connect', { connectionId: requested.connectionId })
    const browser = (args) =>
      call('threadlight_browser', { connectionId: requested.connectionId, ...args })
    assert.equal(data(await browser({ action: 'list' })).browsers.length, 0)
    agents.push({ provider, browser, id: requested.connectionId, chatId })
  }
  await openAccess()
  for (const agent of agents)
    await page.getByRole('checkbox', { name: new RegExp(`Browser ${agent.provider}`) }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('input[type=checkbox]')].every((e) => e.checked),
  )
  await closeAccess()
  const [codex, claude] = agents
  const browserId = data(await codex.browser({ action: 'list' })).browsers[0].id
  const inspect = async (agent) => {
    const value = data(await agent.browser({ action: 'inspect', browserId }))
    assert.equal(value.ok, true, JSON.stringify(value))
    return value
  }
  await waitGuest('document.querySelector("#lesson-audio")?.seekable.length > 0')
  await guest(`(() => {
    const audio = document.querySelector('#lesson-audio'); audio.currentTime = 37.5;
    const captions = audio.addTextTrack('captions', 'Lesson captions', 'en'); captions.mode = 'hidden';
    captions.addCue(new VTTCue(30, 42, 'A function can return a value.'));
    captions.addCue(new VTTCue(110, 119, 'Later unrelated material.'));
    const chapters = audio.addTextTrack('chapters', 'Chapters', 'en'); chapters.mode = 'hidden';
    chapters.addCue(new VTTCue(20, 60, 'Return values'));
  })()`)
  await waitGuest(
    '!document.querySelector("#lesson-audio").seeking && document.querySelector("#lesson-audio").currentTime === 37.5',
  )
  for (const agent of agents) {
    const snapshot = await inspect(agent)
    const audio = snapshot.observation[0].media.find((m) => m.kind === 'audio')
    assert.equal(
      snapshot.observation[0].media.find((m) => m.kind === 'video').displayedCaptions,
      'Visible player caption.',
    )
    assert.equal(audio.currentTime, 37.5)
    assert.equal(audio.duration, 120)
    assert(
      snapshot.observation.slice(1).some((frame) => frame.media?.some((m) => m.kind === 'audio')),
      'cross-origin media is inspected',
    )
    assert.equal(audio.paused, true)
    assert.equal(audio.visible, false, 'hidden media remains inspectable')
    assert.equal(audio.chapter.text, 'Return values')
    assert.equal(audio.tracks[0].nearby.length, 1)
    assert.equal(audio.tracks[0].nearby[0].text, 'A function can return a value.')
    assert(Math.abs(Date.now() - audio.observedAt) < 5000)
  }
  const hostedMedia = await app.evaluate(
    async (_electron, id) =>
      globalThis.browserProof.browser.call(
        { id: 'hosted:media-test', label: 'Hosted Agent', hosted: true, valid: () => true },
        { action: 'inspect', browserId: id },
      ),
    browserId,
  )
  assert.equal(hostedMedia.observation[0].media.find((m) => m.kind === 'audio').currentTime, 37.5)
  const mediaAction = async (action, extra = {}) => {
    const snapshot = await inspect(codex)
    const audio = snapshot.observation[0].media.find((m) => m.kind === 'audio')
    const command = {
      action,
      browserId,
      revision: snapshot.state.revision,
      frame: 0,
      element: audio.element,
      operationId: randomUUID(),
      ...extra,
    }
    const reply = data(await codex.browser(command))
    assert.equal(reply.ok, true, JSON.stringify(reply))
    assert.equal(data(await codex.browser(command)).ok, true, 'media action receipt is idempotent')
    return (await inspect(codex)).observation[0].media.find((m) => m.kind === 'audio')
  }
  assert.equal((await mediaAction('seek', { seconds: 50 })).currentTime, 50)
  assert.equal((await mediaAction('skip', { seconds: -10 })).currentTime, 40)
  assert.equal((await mediaAction('rate', { rate: 1.5 })).playbackRate, 1.5)
  assert.equal((await mediaAction('play')).paused, false)
  assert.equal((await mediaAction('pause')).paused, true)
  const oldMedia = await inspect(codex)
  const oldAudio = oldMedia.observation[0].media.find((m) => m.kind === 'audio')
  await guest('document.querySelector("#lesson-audio").src = "/tone.wav#replacement"')
  await waitGuest('document.querySelector("#lesson-audio").currentSrc.endsWith("#replacement")')
  assert.equal(
    data(
      await codex.browser({
        action: 'pause',
        browserId,
        revision: oldMedia.state.revision,
        element: oldAudio.element,
        frame: 0,
        operationId: randomUUID(),
      }),
    ).ok,
    false,
    'changed media invalidates the previous target',
  )
  await codex.browser({ action: 'release', browserId })
  let observed = await inspect(codex)
  const counter = observed.observation[0].elements.find((e) => e.name === 'Count 0').id
  const click = {
    action: 'click',
    browserId,
    revision: observed.state.revision,
    element: counter,
    operationId: randomUUID(),
  }
  assert.equal(data(await codex.browser(click)).ok, true)
  assert.equal(data(await codex.browser(click)).ok, true, 'repeated action returns receipt')
  assert.equal(await guest('window.count'), 1)
  observed = await inspect(claude)
  const denied = data(
    await claude.browser({
      ...click,
      operationId: randomUUID(),
      revision: observed.state.revision,
    }),
  )
  assert.equal(denied.ok, false, 'another agent cannot interleave actions')
  await codex.browser({ action: 'release', browserId })
  observed = await inspect(claude)
  const name = observed.observation[0].elements.find((e) => e.name === 'Name').id
  assert.equal(
    data(
      await claude.browser({
        action: 'type',
        browserId,
        revision: observed.state.revision,
        element: name,
        text: 'Shared input',
        operationId: randomUUID(),
      }),
    ).ok,
    true,
  )
  assert.equal(await guest('document.querySelector("input").value'), 'Shared input')
  await page.getByRole('button', { name: 'Take control' }).click()
  const stale = data(
    await claude.browser({
      ...click,
      operationId: randomUUID(),
      revision: observed.state.revision,
    }),
  )
  assert.equal(stale.ok, false)
  observed = await inspect(codex)
  const embedded = observed.observation.find((frame) =>
    frame.elements?.some((e) => e.name === 'Frame button'),
  )
  assert(embedded, JSON.stringify(observed.observation))
  const embeddedButton = embedded.elements.find((e) => e.name === 'Frame button')
  assert.equal(
    data(
      await codex.browser({
        action: 'click',
        browserId,
        revision: observed.state.revision,
        frame: embedded.frame,
        element: embeddedButton.id,
        operationId: randomUUID(),
      }),
    ).ok,
    true,
  )
  observed = await inspect(codex)
  assert(
    observed.observation.some((frame) => frame.elements?.some((e) => e.name === 'Frame clicked')),
  )
  await codex.browser({ action: 'release', browserId })
  const shot = await claude.browser({ action: 'screenshot', browserId })
  assert(shot.content.some((c) => c.type === 'image'))
  const before = await app.evaluate(() => globalThis.artifactProof.panel.getBounds())
  await guest('document.querySelector("#fullscreen").click()')
  await waitGuest('!!document.fullscreenElement')
  const after = await app.evaluate(() => globalThis.artifactProof.panel.getBounds())
  assert.deepEqual(after, before, 'video fullscreen preserves outer window')
  const stage = page.getByLabel('Browser page', { exact: true })
  const chooseBrowser = async (fromHeader) => {
    const target = fromHeader
      ? page.getByRole('banner', { name: 'Panel header' })
      : page.getByRole('button', { name: /Artifact test thread/ })
    await target.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  }
  const reopenBrowser = async (fromHeader) => {
    await page.getByRole('button', { name: 'Back to threads' }).click()
    await chooseBrowser(fromHeader)
  }
  const dragGrip = async (edge, dx, dy, alt = false) => {
    const grip = page.locator(`[data-video-grips] [data-edge="${edge}"]`)
    await grip.waitFor()
    await grip.click({ trial: true })
    const box = await grip.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height - 2 // In the transparent margin, outside the painted card.
    assert(
      await grip.evaluate((el, { x, y }) => document.elementFromPoint(x, y) === el, { x, y }),
      JSON.stringify({
        box,
        viewport: await page.viewportSize(),
        actual: await page.evaluate(() => [window.innerWidth, window.innerHeight]),
      }),
    )
    if (alt) await page.keyboard.down('Alt')
    try {
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + dx, y + dy)
      await page.mouse.up()
    } finally {
      if (alt) await page.keyboard.up('Alt')
    }
  }
  const original = await stage.boundingBox()
  if (process.platform === 'win32') {
    const card = await page.locator('[data-card]').boundingBox()
    const hits = await app.evaluate(
      async ({ screen }, { card, koffiPath }) => {
        const panel = globalThis.artifactProof.panel
        panel.moveTop()
        await new Promise((resolve) => setTimeout(resolve, 100))
        const bounds = panel.getContentBounds()
        const user32 = process.mainModule.require(koffiPath).load('user32.dll')
        const at = user32.func('uintptr_t __stdcall WindowFromPoint(int64_t)')
        const root = user32.func('uintptr_t __stdcall GetAncestor(uintptr_t,unsigned int)')
        return [card.x - 2, card.x + card.width / 2, card.x + card.width + 2].map((x) => {
          const point = screen.dipToScreenPoint({
            x: Math.round(bounds.x + x),
            y: Math.round(bounds.y + card.y + card.height + 2),
          })
          const packed = BigInt.asIntN(
            64,
            (BigInt(point.y) << 32n) | BigInt.asUintN(32, BigInt(point.x)),
          )
          return (
            String(root(at(packed), 2)) === String(panel.getNativeWindowHandle().readBigUInt64LE())
          )
        })
      },
      { card, koffiPath: require.resolve('koffi') },
    )
    assert.deepEqual(
      hits,
      [true, true, true],
      'Windows delivers outside-corner and bottom-edge hits to Threadlight',
    )
  }
  await dragGrip('crop', 0, -72)
  assert.equal(await page.locator('[data-video-sized]').count(), 0, 'crop requires Alt')
  await dragGrip('crop', 0, -72, true)
  await page.waitForFunction(() => !!document.querySelector('[data-video-sized]'))
  const cropped = await stage.boundingBox()
  assert(Math.abs(original.width - cropped.width) <= 1, JSON.stringify({ original, cropped }))
  assert(
    Math.abs(original.height - cropped.height - 72) <= 2,
    JSON.stringify({ original, cropped }),
  )
  await waitGuest(`Math.abs(innerHeight - ${cropped.height}) <= 1`)
  for (const [edge, dx, dy] of [
    ['right', -48, -36],
    ['left', 46, -33],
  ]) {
    const prior = await stage.boundingBox()
    const nativeBefore = await app.evaluate(() => globalThis.artifactProof.panel.getContentBounds())
    await dragGrip(edge, dx, dy)
    await page.waitForFunction(
      (width) => document.querySelector('[aria-label="Browser page"]').clientWidth < width - 10,
      prior.width,
    )
    const resized = await stage.boundingBox()
    const nativeAfter = await app.evaluate(() => globalThis.artifactProof.panel.getContentBounds())
    assert.equal(nativeBefore.y, nativeAfter.y)
    assert.equal(
      edge === 'right' ? nativeBefore.x : nativeBefore.x + nativeBefore.width,
      edge === 'right' ? nativeAfter.x : nativeAfter.x + nativeAfter.width,
    )
    assert(Math.abs(resized.width / resized.height - cropped.width / cropped.height) < 0.02)
  }
  const small = await stage.boundingBox()
  await dragGrip('crop', 0, 32, true)
  await waitGuest(`Math.abs(innerHeight - ${small.height + 32}) <= 1`)
  const picked = await stage.boundingBox()
  await guest('document.querySelector("video").play()')
  const embeddedAudio = (script) =>
    app.evaluate(async ({ webContents }, script) => {
      const guest = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith(globalThis.browserProof.url))
      const frame = guest.mainFrame.framesInSubtree.find(
        (f) => new URL(f.url).pathname === '/frame',
      )
      return frame.executeJavaScript(script, true)
    }, script)
  await embeddedAudio('document.querySelector("audio").play()')
  await reopenBrowser(true)
  await address.waitFor()
  await waitGuest('document.querySelector("video").paused')
  const stoppedAt = await embeddedAudio(
    '({ paused: document.querySelector("audio").paused, time: document.querySelector("audio").currentTime })',
  )
  assert(stoppedAt.paused, 'embedded player pauses when its browser is hidden')
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(await embeddedAudio('document.querySelector("audio").currentTime'), stoppedAt.time)
  assert.deepEqual(
    await app.evaluate(() => globalThis.artifactProof.panel.getBounds()),
    before,
    'other browser uses ordinary bounds',
  )
  await reopenBrowser(false)
  await waitGuest('!!document.fullscreenElement')
  await page.locator('[data-video-grips]').waitFor()
  assert.equal(
    await page.locator('[data-video-sized]').count(),
    1,
    'reopened fullscreen video restores its chosen size',
  )
  await waitGuest(`innerWidth === ${picked.width} && innerHeight === ${picked.height}`)
  await waitGuest('!document.querySelector("video").paused')
  assert.equal(
    await embeddedAudio('document.querySelector("audio").paused'),
    false,
    'embedded player resumes',
  )
  assert(
    await guest('document.querySelector("#lesson-audio").paused'),
    'manually paused audio stays paused',
  )
  await guest(
    'document.querySelector("video").pause(); document.querySelector("#lesson-audio").play()',
  )
  await app.evaluate(() => globalThis.artifactProof.panel.hide())
  await waitGuest('document.querySelector("#lesson-audio").paused')
  await embeddedAudio('document.querySelector("audio").src = "/tone.wav#new-source"')
  await app.evaluate(() => globalThis.artifactProof.panel.show())
  await waitGuest('!document.querySelector("#lesson-audio").paused')
  assert(
    await guest('document.querySelector("video").paused'),
    'showing the panel preserves manual pause',
  )
  assert(
    await embeddedAudio('document.querySelector("audio").paused'),
    'a replacement source stays paused',
  )
  await page.locator('[data-edge=crop]').focus()
  await page.keyboard.press('Escape')
  await waitGuest('!document.fullscreenElement')
  await page.locator('[data-video-grips]').waitFor({ state: 'detached' })
  assert.deepEqual(await app.evaluate(() => globalThis.artifactProof.panel.getBounds()), before)
  await guest('document.querySelector("#fullscreen").click()')
  await waitGuest('!!document.fullscreenElement')
  await page.locator('[data-video-grips]').waitFor()
  assert.equal(
    await page.locator('[data-video-sized]').count(),
    0,
    'fresh fullscreen starts at the normal size',
  )
  await dragGrip('crop', 0, -40, true)
  await page.locator('[data-video-sized]').waitFor()
  await reopenBrowser(true)
  await guest('document.exitFullscreen()')
  await reopenBrowser(false)
  await address.waitFor()
  assert.deepEqual(
    await app.evaluate(() => globalThis.artifactProof.panel.getBounds()),
    before,
    'fullscreen ended while away',
  )
  assert.equal(await guest('window.count'), 1, 'switching views retains page state')
  await openAccess()
  await page.getByRole('checkbox', { name: /Browser claude/ }).click()
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('label')]
        .find((e) => e.textContent.includes('Browser claude'))
        ?.querySelector('input')?.checked,
  )
  assert.equal(data(await claude.browser({ action: 'list' })).browsers.length, 0)
  await closeAccess()
  const pixels = await app.evaluate(async ({ desktopCapturer }) => {
    const panel = globalThis.artifactProof.panel
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1000, height: 1200 },
    })
    return (
      sources
        .find((s) => s.id === panel.getMediaSourceId())
        ?.thumbnail.toPNG()
        .toString('base64') ?? (await panel.capturePage()).toPNG().toString('base64')
    )
  })
  writeFileSync(join(config.directory, 'shared-browser.png'), Buffer.from(pixels, 'base64'))
  await address.fill(config.url + 'next')
  await address.press('Enter')
  await waitGuest('document.querySelector("h1")?.textContent === "Next page"')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await waitGuest('!!document.querySelector("#counter")')
  await page.getByRole('button', { name: 'Forward', exact: true }).click()
  await waitGuest('document.querySelector("h1")?.textContent === "Next page"')
  await page.getByRole('button', { name: 'Browser options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open HTML…', exact: true }).click()
  await app.evaluate(async ({ webContents }) => {
    for (let i = 0; i < 100; i++) {
      const local = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith('threadlight-browser-file:'))
      if (local && (await local.executeJavaScript('!!document.querySelector("#counter")'))) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw Error('Local HTML did not render')
  })
  const persisted = await app.evaluate(
    (_electron, id) => globalThis.browserProof.revokeAndRead(id),
    codex.id,
  )
  assert.equal(
    (await codex.browser({ action: 'list' })).isError,
    true,
    'revoked enrollment loses browser access',
  )
  assert(JSON.parse(persisted).receipts.length >= 3, 'action receipts persist')
  if (process.env.THREADLIGHT_BROWSER_YOUTUBE === '1') {
    await reopenBrowser(true)
    const panelBrowserId = await page.evaluate(
      async () =>
        (await window.threadlight.browserRequest({ action: 'access' })).access.find(
          (browser) => browser.threadId === '@threadlight-browser',
        ).id,
    )
    await address.fill('https://www.youtube.com/watch?v=JP7ITIXGpHk')
    await address.press('Enter')
    const liveGuest = (script, gesture = false) =>
      app.evaluate(
        ({ webContents }, { script, gesture }) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL().includes('youtube.com/watch'))
            .executeJavaScript(script, gesture),
        { script, gesture },
      )
    const waitLivePlayback = async (paused) => {
      for (let i = 0; i < 50; i++) {
        const state = await liveGuest(
          '({paused:document.querySelector("video").paused,time:document.querySelector("video").currentTime})',
        )
        if (state.paused === paused) return state.time
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw Error('YouTube playback did not reach paused=' + paused)
    }
    const mediaState = () =>
      app.evaluate(async ({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((c) => /^https:\/\/(www\.)?youtube\.com/.test(c.getURL()))
        if (!contents) return { ready: false }
        return contents.executeJavaScript(
          `(() => {
        const reject = [...document.querySelectorAll('button')].find(b => b.offsetWidth && b.innerText.trim().toLowerCase() === 'reject all'); reject?.click();
        const v = document.querySelector('video');
        if (v?.paused) v.play().catch(() => {});
        return { title: document.title, text: document.body.innerText.slice(0,1500), ready: !reject && !!v && v.readyState >= 2 && v.getClientRects().length > 0 && v.clientWidth > 0 && v.clientHeight > 0, time: v?.currentTime, paused: v?.paused, error: v?.error?.message };
      })()`,
          true,
        )
      })
    let video
    for (let i = 0; i < 30; i++) {
      video = await mediaState()
      if (video.ready) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (video.ready) {
      // Consent can arrive after the media is ready and navigate on dismissal.
      await new Promise((resolve) => setTimeout(resolve, 2500))
      for (let i = 0; i < 20; i++) {
        if ((await mediaState().catch(() => null))?.ready) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      const liveInspection = await app.evaluate(async (_electron, id) => {
        let result
        for (let attempt = 0; attempt < 6; attempt++) {
          result = await globalThis.browserProof.browser.call(
            { id: 'hosted:live-media', label: 'Hosted Agent', hosted: true, valid: () => true },
            { action: 'inspect', browserId: id },
          )
          if (result.ok || !result.reason?.includes('Page changed')) return result
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        return result
      }, panelBrowserId)
      assert(liveInspection.ok, JSON.stringify(liveInspection))
      const liveVideo = liveInspection.observation
        .flatMap((frame) => frame.media ?? [])
        .find((media) => media.kind === 'video' && media.visible)
      assert(
        liveVideo.currentTime >= 0 && liveVideo.duration > 0,
        'live YouTube time is exposed through the agent browser tool',
      )

      for (let attempt = 0; attempt < 3; attempt++) {
        await app.evaluate(async ({ webContents }) => {
          const contents = webContents
            .getAllWebContents()
            .find((c) => c.getURL().includes('youtube.com/watch'))
          await contents.executeJavaScript(
            `(() => {
            const fullscreen = document.querySelector('.ytp-fullscreen-button');
            if (!fullscreen?.getClientRects().length) document.querySelector('.ytp-expand-right-bottom-section-button')?.click();
          })()`,
            true,
          )
          await new Promise((resolve) => setTimeout(resolve, 300))
          const buttonState = await contents.executeJavaScript(
            `(() => {
            const button = document.querySelector('.ytp-fullscreen-button');
            const state = { display: getComputedStyle(button).display, rect: button.getBoundingClientRect().toJSON() };
            button.click(); return state;
          })()`,
            true,
          )
          return buttonState
        })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const entered = await app.evaluate(async ({ webContents }) => {
          const c = webContents
            .getAllWebContents()
            .find((c) => c.getURL().includes('youtube.com/watch'))
          return c.executeJavaScript('!!document.fullscreenElement')
        })
        if (entered) break
      }
      const result = await app.evaluate(async ({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((c) => c.getURL().includes('youtube.com/watch'))
        return {
          bounds: globalThis.artifactProof.panel.getBounds(),
          media: await contents.executeJavaScript(
            '({fullscreen:!!document.fullscreenElement,time:document.querySelector("video")?.currentTime})',
          ),
        }
      })
      await page.screenshot({ path: join(config.directory, 'youtube-panel.png') })
      if (!result.media.fullscreen)
        console.log(
          'Video layout',
          await app.evaluate(async ({ webContents }) => {
            const c = webContents
              .getAllWebContents()
              .find((c) => c.getURL().includes('youtube.com/watch'))
            return c.executeJavaScript(
              '({rect:document.querySelector("video")?.getBoundingClientRect().toJSON(),text:document.body.innerText.slice(0,1000)})',
            )
          }),
        )
      assert(result.media.fullscreen, 'live YouTube fullscreen')
      assert(result.media.time > video.time, 'live YouTube playback advances')
      assert.deepEqual(result.bounds, before)
      await dragGrip('crop', 0, -300, true)
      await page.waitForFunction(() => !!document.querySelector('[data-video-sized]'))
      const liveSize = await stage.boundingBox()
      await liveGuest(
        'if (document.querySelector("video").paused) document.querySelector(".ytp-play-button").click()',
        true,
      )
      await waitLivePlayback(false)
      await page.getByRole('button', { name: 'Back to threads' }).click()
      result.autoPausedAt = await waitLivePlayback(true)
      await new Promise((resolve) => setTimeout(resolve, 350))
      assert.equal(
        await waitLivePlayback(true),
        result.autoPausedAt,
        'YouTube time stops while away',
      )
      await chooseBrowser(true)
      await waitLivePlayback(false)
      await page.locator('[data-video-sized]').waitFor()
      await page.waitForFunction(
        ({ width, height }) => {
          const viewport = document
            .querySelector('[aria-label="Browser page"]')
            .getBoundingClientRect()
          return Math.abs(viewport.width - width) < 1 && Math.abs(viewport.height - height) < 1
        },
        liveSize,
        { timeout: 5000 },
      )
      result.cropped = await app.evaluate(async ({ webContents }) => {
        const c = webContents
          .getAllWebContents()
          .find((c) => c.getURL().includes('youtube.com/watch'))
        let layout
        for (let attempt = 0; attempt < 40; attempt++) {
          c.sendInputEvent({ type: 'mouseMove', x: 60, y: 40 + attempt })
          layout = await c.executeJavaScript(`(() => {
            const video = document.querySelector('video')
            const rect = video.getBoundingClientRect()
            const controls = document.querySelector('.ytp-chrome-bottom').getBoundingClientRect()
            const play = document.querySelector('.ytp-play-button').getBoundingClientRect();
            const hit = document.elementFromPoint(play.x + play.width / 2, play.y + play.height / 2);
            return { width: innerWidth, height: innerHeight, video: rect.toJSON(), controls: controls.toJSON(), playReachable: !!hit?.closest('.ytp-play-button'), play:play.toJSON(), hit:hit?.className?.toString(), aspect: video.videoWidth / video.videoHeight, time: video.currentTime, fullscreen: !!document.fullscreenElement }
          })()`)
          if (
            layout.fullscreen &&
            layout.playReachable &&
            Math.abs(layout.height - layout.width / layout.aspect) <= 2 &&
            layout.controls.width > 0 &&
            layout.controls.y >= 0 &&
            layout.controls.bottom <= layout.height + 1 &&
            Math.abs(layout.video.x + layout.video.width / 2 - layout.width / 2) <= 2
          )
            return layout
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw Error(
          'YouTube did not fit the cropped viewport and controls: ' + JSON.stringify(layout),
        )
      })
      assert.deepEqual(
        [result.cropped.width, result.cropped.height],
        [Math.round(liveSize.width), Math.round(liveSize.height)],
        'header Browser restores the live video viewport',
      )
      await liveGuest('document.querySelector(".ytp-play-button").click()', true)
      result.manuallyPausedAt = await waitLivePlayback(true)
      await reopenBrowser(true)
      await page.locator('[data-video-sized]').waitFor()
      await new Promise((resolve) => setTimeout(resolve, 400))
      assert.equal(
        await waitLivePlayback(true),
        result.manuallyPausedAt,
        'manual YouTube pause survives return',
      )
      await exitFullscreen()
      await page.locator('[data-video-grips]').waitFor({ state: 'detached' })
      console.log('Live CS50 YouTube playback and bordered fullscreen passed.')
      writeFileSync(
        join(config.directory, 'youtube-result.json'),
        JSON.stringify({ passed: true, reopenedViewport: liveSize, result }, null, 2),
      )
    } else {
      console.log('Live YouTube unavailable:', JSON.stringify(video))
      writeFileSync(
        join(config.directory, 'youtube-result.json'),
        JSON.stringify({ passed: false, video }, null, 2),
      )
    }
    await reopenBrowser(false)
  }
  await exitFullscreen()
  await address.fill(config.url)
  await address.press('Enter')
  await waitGuest('!!document.querySelector("#counter")')
  await openAccess()
  await page.getByRole('checkbox', { name: /Browser claude/ }).click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('label')]
        .find((e) => e.textContent.includes('Browser claude'))
        ?.querySelector('input')?.checked,
  )
  await closeAccess()
  observed = await inspect(claude)
  const resumeClick = {
    action: 'click',
    browserId,
    revision: observed.state.revision,
    element: observed.observation[0].elements.find((e) => e.name === 'Count 0').id,
    operationId: randomUUID(),
  }
  assert.equal(data(await claude.browser(resumeClick)).ok, true)
  for (const child of children) child.kill()
  await app.close()
  app = await _electron.launch({
    colorScheme: 'dark',
    executablePath: require('electron'),
    args: [join(root, 'out/main/browser.fixture.js')],
    env: {
      ...env,
      THREADLIGHT_ARTIFACT_TEST_DIRECTORY: config.directory,
      THREADLIGHT_BROWSER_TEST_PORT: new URL(config.url).port,
    },
  })
  const resumedPage = await app.firstWindow()
  await app.evaluate(async () => {
    while (!globalThis.browserProof) await new Promise((resolve) => setTimeout(resolve, 50))
  })
  const resumedConfig = await app.evaluate(() => ({
    endpoint: globalThis.browserProof.endpoint,
    authFile: globalThis.browserProof.authFile,
  }))
  const resumedCall = bridge('claude', resumedConfig)
  const reconnection = await resumedCall('memory_connect', {
    connectionId: claude.id,
    chatId: claude.chatId,
    spaceId: config.spaceId,
  })
  assert.equal(reconnection.isError, false, JSON.stringify(reconnection))
  const restoredAccess = await resumedPage.evaluate(() =>
    window.threadlight.browserRequest({ action: 'access' }),
  )
  const savedAccess = restoredAccess.access.find((b) => b.id === browserId)
  assert(savedAccess, 'unopened saved browsers appear in access settings')
  const updatedAccess = await resumedPage.evaluate(
    (entry) =>
      window.threadlight.browserRequest({
        action: 'share',
        browserId: entry.id,
        connections: entry.sharedWith,
        hosted: false,
      }),
    savedAccess,
  )
  assert(updatedAccess.ok, 'access changes work before a saved browser is opened')
  await resumedPage.getByRole('button', { name: /Artifact test thread/ }).click({ button: 'right' })
  await resumedPage.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  await waitGuest('!!document.querySelector("#counter")')
  const restoredBrowser = data(
    await resumedCall('threadlight_browser', { connectionId: claude.id, action: 'list' }),
  ).browsers[0]
  assert.equal(restoredBrowser.id, browserId, 'browser identity and sharing survive restart')
  assert.equal(
    data(await resumedCall('threadlight_browser', { connectionId: claude.id, ...resumeClick })).ok,
    true,
    'completed receipt survives restart',
  )
  assert.equal(await guest('window.count'), 0, 'old click is not replayed after process restart')
  assert.deepEqual(errors, [])
  writeFileSync(
    join(config.directory, 'browser-result.json'),
    JSON.stringify(
      {
        passed: true,
        verified: [
          'address navigation and correction after failure',
          'branded dark idle and error states',
          'loading indicator without layout shift',
          'access settings for open and restored browsers',
          'both packaged bridges',
          'sharing and revocation',
          'same page click and typing',
          'duplicate receipts',
          'agent exclusion',
          'human takeover',
          'stale actions',
          'screenshot images',
          'video fullscreen without outer resize',
          'player fullscreen',
          'Alt-only letterbox crop and restoration, both anchored corner drags after cropping, and Escape restores the original window',
          'reopening the same fullscreen browser restores the chosen video viewport; other browsers and fresh fullscreen sessions use the default',
          'leaving Browser pauses playing media, returning resumes only the same media, and hiding the panel preserves manual pauses',
          'retained page',
          'cross-origin frame interaction',
          'back and forward',
          'local HTML',
          'enrollment revocation',
          'persisted receipts',
          'full process restart, restored URL, sharing and duplicate receipt recovery',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`Browser integration passed. Evidence: ${config.directory}`)
} catch (error) {
  const page = await app.firstWindow()
  console.error('Fixture page', await page.locator('body').innerText())
  console.error('Fixture URL', page.url())
  console.error(
    'Browser video state',
    await app
      .evaluate(async () =>
        Promise.all(
          [...globalThis.browserProof.browser.pages.values()].map(async (p) => ({
            fullscreen: p.state.fullscreen,
            aspect: p.state.videoAspect,
            sized: p.state.videoSized,
            visible: p.state.visible,
            media: await p.view.webContents
              .executeJavaScript(
                '[document.fullscreenElement?.tagName,document.querySelector("video")?.videoWidth]',
              )
              .catch(() => null),
          })),
        ),
      )
      .catch(() => null),
  )
  console.error(
    'Guests',
    await app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((c) => ({ url: c.getURL(), title: c.getTitle() })),
    ),
  )
  await page.screenshot({ path: join(root, 'out/browser-failure.png') }).catch(() => {})
  throw error
} finally {
  for (const child of children) child.kill()
  await app.close()
}
