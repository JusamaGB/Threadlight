// Playwright/Electron native-window test with isolated, deterministic screen coordinates.
/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
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
const failures = []
const reports = []
app.on('window', (page) => page.on('pageerror', (error) => failures.push(error.message)))
try {
  await app.firstWindow()
  await app.evaluate(async () => {
    while (!globalThis.hoverProof) await new Promise((done) => setTimeout(done, 20))
  })
  const pages = app.windows()
  const panel = pages.find((page) => page.url().includes('view=panel'))
  const dot = pages.find((page) => page.url().includes('view=dot'))
  assert(panel && dot, 'real panel and dot renderers loaded')
  await panel.locator('[data-card]').waitFor({ state: 'attached' })
  for (const page of pages) page.on('pageerror', (error) => failures.push(error.message))
  const pause = (ms) => new Promise((done) => setTimeout(done, ms))
  for (const attention of [false, true]) {
    for (const y of [140, 700]) {
      await app.evaluate(
        (_electron, { attention, y }) => {
          const { windows, move, events } = globalThis.hoverProof
          move(50, 50)
          windows.closePanel()
          const bounds = windows.dot.getBounds()
          windows.dragDot(900 - bounds.x, y - bounds.y)
          windows.endDrag()
          windows.setAttention(
            attention
              ? [{ id: 'codex:waiting', state: 'waiting', attention: null, lastActiveAt: 10 }]
              : [],
          )
          events.length = 0
        },
        { attention, y },
      )
      await pause(350)
      const attentionPage = attention
        ? app.windows().find((page) => page.url().includes('view=attention'))
        : null
      if (attentionPage) {
        await attentionPage.locator('[data-attention-provider]').waitFor({ state: 'attached' })
        await attentionPage.evaluate(() => {
          window.hoverFrames = []
          const sample = () => {
            const canvas = document.querySelector('canvas')
            const pixels = canvas
              ?.getContext('2d')
              .getImageData(0, 0, canvas.width, canvas.height).data
            let painted = 0
            for (let i = 3; pixels && i < pixels.length; i += 4) if (pixels[i] > 20) painted++
            window.hoverFrames.push({ at: performance.now(), painted, hidden: document.hidden })
          }
          window.sampleHoverReturn = () => {
            sample()
            let frames = 0
            const next = () => {
              sample()
              if (++frames < 8) requestAnimationFrame(next)
            }
            requestAnimationFrame(next)
          }
        })
      }
      for (let cycle = 0; cycle < 3; cycle++) {
        await app.evaluate(() => {
          const { windows, move, events } = globalThis.hoverProof
          events.length = 0
          const b = windows.dot.getBounds()
          move(b.x + 11, b.y + 11)
        })
        await dot.mouse.move(11, 11)
        await pause(1000)
        const opened = await app.evaluate(() => {
          const { windows, events } = globalThis.hoverProof
          return { visible: windows.panel.isVisible(), events: [...events] }
        })
        await app.evaluate(() => globalThis.hoverProof.windows.panel.emit('blur'))
        const afterBlur = await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible())
        if (!afterBlur)
          failures.push(`handoff blur closed panel: attention=${attention}, y=${y}, cycle=${cycle}`)
        if (attentionPage) await attentionPage.evaluate(() => window.sampleHoverReturn())
        await app.evaluate(() => globalThis.hoverProof.move(50, 50))
        await pause(600)
        const closed = await app.evaluate(() => {
          const { windows, events } = globalThis.hoverProof
          return {
            visible: windows.panel.isVisible(),
            dot: windows.dot.isVisible(),
            events: [...events],
          }
        })
        const frames = attentionPage
          ? await attentionPage.evaluate(() => window.hoverFrames.splice(0))
          : []
        reports.push({ attention, y, cycle, opened, closed, frames })
        if (
          attention &&
          (!frames.length || frames.some((frame) => !frame.hidden && frame.painted < 10))
        )
          failures.push(`blank attention return frame: y=${y}, cycle=${cycle}`)
        if (!opened.visible || opened.events.filter((e) => e.event === 'panel:show').length !== 1)
          failures.push(`hover flicker: attention=${attention}, y=${y}, cycle=${cycle}`)
        if (closed.visible || !closed.dot)
          failures.push(`close failed: attention=${attention}, y=${y}, cycle=${cycle}`)
      }
    }
  }
  // Exercise the other exits and a rapid reversal through the production IPC bridge.
  const enter = async () => {
    await app.evaluate(() => {
      const { windows, move } = globalThis.hoverProof
      const b = windows.dot.getBounds()
      move(b.x + 11, b.y + 11)
    })
    await dot.mouse.move(11, 11)
    await pause(80)
    assert(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()))
  }
  await enter()
  await app.evaluate(() => globalThis.hoverProof.move(50, 50))
  await pause(80)
  await enter()
  await panel.keyboard.press('Escape')
  await pause(80)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()), false)
  await enter()
  await app.evaluate(() => {
    const { windows, move } = globalThis.hoverProof
    windows.setStayOpen(true)
    move(50, 50)
    windows.panel.emit('blur')
  })
  await pause(80)
  assert(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()))
  await app.evaluate(() => globalThis.hoverProof.windows.setStayOpen(false))
  await pause(80)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()), false)
  console.log(
    JSON.stringify({
      failures,
      cycles: reports.length,
      returnFrames: reports.flatMap((r) => r.frames).length,
    }),
  )
  assert.deepEqual(failures, [])
  console.log(
    'PASS: 12 Electron hover cycles, delayed blur, cached/return pixels, both directions, rapid re-entry, Escape and pinning.',
  )
} finally {
  const directory = process.env.THREADLIGHT_SCREENSHOTS
  if (directory) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'window-hover.json'),
      JSON.stringify({ failures, reports }, null, 2),
    )
  }
  await app.close()
}
