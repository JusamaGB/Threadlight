/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
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
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/browser.fixture.js'), '--mute-audio'],
  env,
  colorScheme: 'dark',
})
try {
  const page = await app.firstWindow()
  await app.evaluate(async () => {
    while (!globalThis.browserProof) await new Promise((r) => setTimeout(r, 50))
  })
  const config = await app.evaluate(() => ({
    url: globalThis.browserProof.url,
    directory: globalThis.browserProof.directory,
  }))
  await page.getByRole('banner', { name: 'Panel header' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
  const address = page.getByRole('textbox', { name: 'Search or enter address' })
  await address.fill(config.url + 'youtube-layout')
  await address.press('Enter')
  let guest
  for (let i = 0; i < 100; i++) {
    guest = app
      .context()
      .pages()
      .find((p) => p.url() === config.url + 'youtube-layout')
    if (guest) break
    await new Promise((r) => setTimeout(r, 50))
  }
  assert(guest, 'browser guest appears')
  await guest.locator('video').waitFor()
  await guest.waitForFunction(() => !document.querySelector('video').paused)
  assert.equal(
    await guest.locator('#threadlight-youtube-layout').count(),
    0,
    'other websites are unaffected',
  )
  const before = await guest.locator('video').evaluate((v) => v.currentTime)
  await app.evaluate(async ({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('/youtube-layout'))
    await contents.executeJavaScriptInIsolatedWorld(999, [
      { code: globalThis.browserProof.youtubeLayoutScript },
    ])
    await contents.executeJavaScriptInIsolatedWorld(999, [
      { code: globalThis.browserProof.youtubeLayoutScript },
    ])
  })
  await guest.getByRole('button', { name: 'Expand video preview', exact: true }).waitFor()
  assert.equal(
    await guest.locator('[data-threadlight-video-strip]').count(),
    1,
    'installation is idempotent',
  )
  assert.equal(
    await guest.locator('ytd-miniplayer').evaluate((e) => e.getBoundingClientRect().height),
    28,
  )
  assert.equal(
    await guest.locator('ytd-masthead').evaluate((e) => e.getBoundingClientRect().height),
    42,
  )
  assert.equal(
    await guest
      .locator('.ytSearchboxComponentInputBox')
      .evaluate((e) => e.getBoundingClientRect().height),
    30,
  )
  await new Promise((r) => setTimeout(r, 400))
  assert(
    (await guest.locator('video').evaluate((v) => v.currentTime)) > before,
    'collapsed video keeps playing',
  )
  assert.equal(
    await guest.evaluate(() => !!document.elementFromPoint(100, 200)?.closest('ytd-miniplayer')),
    false,
    'results receive input above strip',
  )
  await guest.evaluate(() => window.scrollBy(0, 300))
  assert((await guest.evaluate(() => window.scrollY)) > 0, 'results remain scrollable')
  await guest.getByRole('button', { name: 'Pause video', exact: true }).click()
  await guest.waitForFunction(() => document.querySelector('video').paused)
  assert.equal(
    await guest
      .getByRole('button', { name: 'Play video', exact: true })
      .locator('path')
      .getAttribute('d'),
    'M6 3L21 12L6 21Z',
  )
  await guest.getByRole('button', { name: 'Play video', exact: true }).click()
  await guest.waitForFunction(() => !document.querySelector('video').paused)
  assert.equal(
    await guest
      .getByRole('button', { name: 'Pause video', exact: true })
      .locator('path')
      .getAttribute('d'),
    'M6 4H10V20H6ZM14 4H18V20H14Z',
  )
  assert.equal(
    await guest.locator('ytd-miniplayer').evaluate((e) => getComputedStyle(e).borderTopWidth),
    '0px',
  )
  assert.equal(
    await guest
      .getByRole('button', { name: 'Pause video', exact: true })
      .evaluate((e) => getComputedStyle(e).borderTopWidth),
    '0px',
  )
  await guest.screenshot({ path: join(config.directory, 'youtube-collapsed.png') })
  await guest.getByRole('button', { name: 'Expand video preview', exact: true }).click()
  assert.equal(
    await guest.locator('ytd-miniplayer').evaluate((e) => e.getBoundingClientRect().height),
    301,
  )
  await guest.getByRole('button', { name: 'Collapse video preview', exact: true }).focus()
  await guest.keyboard.press('Enter')
  assert.equal(
    await guest.locator('ytd-miniplayer').evaluate((e) => e.getBoundingClientRect().height),
    28,
  )
  assert.equal(
    await guest.evaluate(() => window.playlistClicks),
    0,
    'expand does not open playlist',
  )
  await guest.evaluate(() => {
    const player = document.querySelector('ytd-miniplayer')
    player.querySelector('.ytdMiniplayerInfoBarTitle').textContent = 'Next video'
    document.dispatchEvent(new Event('yt-navigate-finish'))
  })
  await guest.getByText('Next video', { exact: true }).last().waitFor()
  assert.equal(await guest.locator('[data-threadlight-video-title]').textContent(), 'Next video')
  const inspection = await app.evaluate(async () => {
    const caller = {
      id: 'hosted:youtube-layout',
      label: 'Hosted Agent',
      hosted: true,
      valid: () => true,
    }
    const pages = await globalThis.browserProof.browser.call(caller, { action: 'list' })
    return globalThis.browserProof.browser.call(caller, {
      action: 'inspect',
      browserId: pages.browsers[0].id,
    })
  })
  assert.equal(
    inspection.observation[0].media[0].visible,
    false,
    'collapsed media remains inspectable and reports hidden',
  )
  if (process.env.THREADLIGHT_BROWSER_YOUTUBE === '1') {
    await address.fill('https://www.youtube.com/watch?v=JP7ITIXGpHk')
    await address.press('Enter')
    for (let attempt = 0; attempt < 30; attempt++) {
      for (const frame of guest.frames()) {
        try {
          for (const reject of await frame.getByText('Reject all', { exact: true }).all()) {
            if (await reject.isVisible()) await reject.click({ timeout: 2000 })
          }
        } catch {
          /* Consent frames may detach after a successful decision. */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await guest.locator('#movie_player').hover()
    if (await guest.locator('video').evaluate((v) => v.paused))
      await guest.locator('.ytp-play-button').click()
    await guest.locator('#movie_player').press('i')
    await guest.getByRole('button', { name: 'Expand video preview', exact: true }).waitFor()
    if (!(await guest.locator('input[name="search_query"]').isVisible()))
      await guest.getByRole('button', { name: 'Search', exact: true }).first().click()
    await guest.locator('input[name="search_query"]').fill('CS50 python week 4')
    await guest.locator('input[name="search_query"]').press('Enter')
    await guest.waitForURL('**/results?**')
    await guest.getByRole('button', { name: 'Expand video preview', exact: true }).waitFor()
    assert.equal(
      await guest.locator('ytd-miniplayer').evaluate((e) => e.getBoundingClientRect().height),
      28,
    )
    if (await guest.getByRole('button', { name: 'Play video', exact: true }).count())
      await guest.getByRole('button', { name: 'Play video', exact: true }).click()
    await guest.waitForFunction(() => !document.querySelector('video').paused)
    const liveTime = await guest.locator('video').evaluate((v) => v.currentTime)
    await new Promise((resolve) => setTimeout(resolve, 700))
    assert((await guest.locator('video').evaluate((v) => v.currentTime)) > liveTime)
    await guest.getByRole('button', { name: 'Pause video', exact: true }).click()
    await guest.waitForFunction(() => document.querySelector('video').paused)
    await guest.getByRole('button', { name: 'Expand video preview', exact: true }).click()
    assert(
      (await guest.locator('ytd-miniplayer').evaluate((e) => e.getBoundingClientRect().height)) >
        200,
    )
    await guest.getByRole('button', { name: 'Collapse video preview', exact: true }).click()
    await guest.mouse.move(120, 200)
    await guest.mouse.wheel(0, 400)
    await guest.waitForFunction(() => window.scrollY > 0)
    await guest.screenshot({ path: join(config.directory, 'youtube-live-collapsed.png') })
    const layout = await guest.evaluate(() => {
      let node = document.querySelector('yt-chip-cloud-chip-renderer')
      const chips = []
      for (let i = 0; node && i < 7; i++, node = node.parentElement)
        chips.push({
          tag: node.tagName,
          id: node.id,
          cls: node.className,
          top: node.getBoundingClientRect().top,
          height: node.getBoundingClientRect().height,
        })
      return {
        chips,
        url: window.location.href,
        mini: document.querySelector('ytd-miniplayer').getBoundingClientRect().toJSON(),
      }
    })
    writeFileSync(
      join(config.directory, 'youtube-live-result.json'),
      JSON.stringify({ passed: true, ...layout }, null, 2),
    )
    console.log('Live YouTube collapsed playback, controls and results scrolling passed.')
  }
  writeFileSync(
    join(config.directory, 'youtube-layout-result.json'),
    JSON.stringify(
      {
        passed: true,
        verified: [
          'compact search',
          'default collapse',
          'audio continuity',
          'play and pause',
          'expand and keyboard collapse',
          'results scrolling',
          'playlist unaffected',
          'SPA title updates',
          'idempotent installation',
          'domain isolation',
        ],
      },
      null,
      2,
    ),
  )
  console.log('YouTube layout passed. Evidence:', config.directory)
} finally {
  await app.close()
}
