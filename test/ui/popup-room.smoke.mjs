// Real Electron window manager, preload, renderer and resize IPC; no provider processes.
/* global document, window */
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
      entry: join(root, 'test/ui/window-hover.fixture.ts'),
      formats: ['cjs'],
      fileName: () => 'window-hover.fixture.js',
    },
    rollupOptions: { external: ['electron'] },
  },
})
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/window-hover.fixture.js')],
  env,
})
try {
  await app.firstWindow({ timeout: 10000 })
  await app.evaluate(async () => {
    while (!globalThis.hoverProof) await new Promise((done) => setTimeout(done, 20))
  })
  const panel = app.windows().find((page) => page.url().includes('view=panel'))
  assert(panel)
  panel.setDefaultTimeout(10000)
  const errors = []
  panel.on('pageerror', (error) => errors.push(error.stack))
  await panel.locator('[data-card]').waitFor({ state: 'attached' })
  await app.evaluate(() => {
    const { windows } = globalThis.hoverProof
    windows.dot.hide()
    windows.panel.hide()
    // Exercise native sizing while keeping the isolated test windows off the desktop.
    windows.dot.showInactive = () => {}
    windows.panel.showInactive = () => {}
    windows.panel.show = () => {}
  })
  await panel.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'], hoverHelp: 'off' }),
  )
  const menu = panel.getByRole('menu')
  for (const upwards of [false, true]) {
    await app.evaluate(({ screen }, upwards) => {
      const { windows, move } = globalThis.hoverProof
      const area = screen.getPrimaryDisplay().workArea
      const dot = windows.dot.getBounds()
      move(area.x, area.y)
      windows.dragDot(
        area.x + area.width - 100 - dot.x,
        (upwards ? area.y + area.height - 80 : area.y + 80) - dot.y,
      )
      windows.endDrag()
      windows.openPanel({ focus: false, fresh: true })
    }, upwards)
    await panel.waitForFunction(() => window.innerHeight < 180)
    for (const kind of ['header', 'providers']) {
      await app.evaluate(() => globalThis.hoverProof.wireGroup(true))
      await panel.waitForFunction(
        () => document.querySelector('[data-card]').getBoundingClientRect().height > 60,
      )
      if (kind === 'header') await panel.locator('header').click({ button: 'right' })
      else
        await panel.getByRole('button', { name: 'Filter applications: Both', exact: true }).click()
      await menu.waitFor()
      // A live snapshot (or a departing hover footer) can shrink the card under an open menu.
      await app.evaluate(() => globalThis.hoverProof.wireGroup(false))
      await panel.waitForFunction(
        () => document.querySelector('[data-card]').getBoundingClientRect().height < 60,
      )
      await panel.waitForFunction((upwards) => {
        const menu = document.querySelector('[role="menu"]')
        const box = menu?.getBoundingClientRect()
        const card = document.querySelector('[data-card]').getBoundingClientRect()
        return (
          box &&
          box.top >= 0 &&
          box.bottom <= window.innerHeight &&
          menu.scrollHeight <= menu.clientHeight &&
          (!upwards || Math.abs(card.bottom - window.innerHeight) <= 1)
        )
      }, upwards)
      const geometry = await panel.evaluate(() => ({
        viewport: window.innerHeight,
        card: document.querySelector('[data-card]').getBoundingClientRect().toJSON(),
        menu: document.querySelector('[role="menu"]').getBoundingClientRect().toJSON(),
      }))
      assert.ok(
        geometry.viewport > geometry.card.height,
        `${kind}: native window makes room after the card shrinks`,
      )
      console.log(JSON.stringify({ upwards, kind, ...geometry }))
      await menu.press('Escape')
      await menu.waitFor({ state: 'detached' })
      await panel.waitForFunction(
        () =>
          Math.abs(
            window.innerHeight -
              document.querySelector('[data-card]').getBoundingClientRect().height,
          ) <= 1,
      )
    }
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS: native popup sizing, header and provider menus, opening up/down and room release.',
  )
} catch (error) {
  const panel = app.windows().find((page) => page.url().includes('view=panel'))
  if (panel)
    console.log(
      await panel.evaluate(() => ({
        height: window.innerHeight,
        card: document.querySelector('[data-card]')?.getBoundingClientRect().toJSON(),
        menu: document.querySelector('[role="menu"]')?.getBoundingClientRect().toJSON(),
      })),
    )
  throw error
} finally {
  await app.close()
}
