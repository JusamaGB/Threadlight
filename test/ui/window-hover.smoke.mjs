import { openHeaderPage, selectThreadView } from './header-navigation.mjs'
// Playwright/Electron native-window test with isolated, deterministic screen coordinates.
/* global window, document, requestAnimationFrame, getComputedStyle */
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
checks: try {
  await app.firstWindow()
  await app.evaluate(async () => {
    while (!globalThis.hoverProof) await new Promise((done) => setTimeout(done, 20))
    await globalThis.hoverProof.windows.loadRenderers()
  })
  if (process.env.THREADLIGHT_UI_FOCUS === 'restart-teardown') {
    await app.evaluate(async () => {
      const { windows, move } = globalThis.hoverProof
      move(0, 0)
      for (const first of ['dot', 'panel']) {
        const pair = new windows.constructor()
        pair.setClaudeRunning(true)
        pair.openPanel({ focus: false })
        pair[first].destroy()
        pair.closeOnPointerLeave()
        pair.closePanel()
        await new Promise((done) => setTimeout(done, 50))
        pair[first === 'dot' ? 'panel' : 'dot'].destroy()
      }
    })
    console.log(
      'PASS: late pointer-leave, pointer polling and panel close after either real Electron window is destroyed.',
    )
    break checks
  }
  const pages = app.windows()
  const panel = pages.find((page) => page.url().includes('view=panel'))
  const dot = pages.find((page) => page.url().includes('view=dot'))
  assert(panel && dot, 'real panel and dot renderers loaded')
  await panel.locator('[data-card]').waitFor({ state: 'attached' })
  for (const page of pages) page.on('pageerror', (error) => failures.push(error.message))
  const pause = (ms) => new Promise((done) => setTimeout(done, ms))
  if (process.env.THREADLIGHT_UI_FOCUS === 'agent-height') {
    await app.evaluate(() => {
      const h = globalThis.hoverProof,
        pos = h.windows.dot.getBounds()
      h.move(pos.x + 16, pos.y + 16)
      h.windows.openPanel()
    })
    await openHeaderPage(panel, 'Agent')
    const grip = panel.getByRole('separator', { name: 'Resize Agent reading area' })
    await grip.press('Home')
    await panel.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Resize Agent reading area"]')
          .getAttribute('aria-valuenow') === '72',
    )
    const native = () => app.evaluate(() => globalThis.hoverProof.windows.panel.getBounds())
    await pause(180)
    const initial = await native()
    const firstCard = await panel.locator('[data-card]').boundingBox()
    const start = await grip.boundingBox()
    const direction = (await grip.getAttribute('data-upward')) ? -1 : 1
    await panel.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await panel.mouse.down()
    await panel.locator('[data-agent-resizing]').waitFor()
    await app.evaluate(() => globalThis.hoverProof.move(-200, -200))
    await pause(200)
    assert.ok(
      await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()),
      'pointer watch retains a captured drag',
    )
    await app.evaluate(() => {
      const h = globalThis.hoverProof,
        p = h.windows.panel.getBounds()
      h.move(p.x + 80, p.y + 25)
    })
    await panel.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + direction * 36)
    await panel.mouse.up()
    await panel.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[aria-label="Resize Agent reading area"]')
            .getAttribute('aria-valuenow'),
        ) >= 105,
    )
    await pause(180)
    const final = await native()
    assert.equal(final.width, initial.width)
    const resizedCard = await panel.locator('[data-card]').boundingBox()
    assert.ok(resizedCard.height > firstCard.height + 20)
    assert.ok(
      Math.abs(final.height - resizedCard.height) <= 1,
      'native window fits the resized card',
    )
    assert.equal(
      direction === 1 ? final.y : final.y + final.height,
      direction === 1 ? initial.y : initial.y + initial.height,
    )
    assert.deepEqual(failures, [])
    console.log(
      'PASS native Agent footer drag, pointer-leave hold, stable anchor and width, and measured window height.',
    )
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'pinned-reference') {
    await app.evaluate(() => {
      const h = globalThis.hoverProof
      h.move(80, 60)
      h.windows.openPanel()
      h.windows.setStayOpen(true)
    })
    const code = Array.from(
      { length: 60 },
      (_, i) => 'print(' + i + ')  # ' + 'long line '.repeat(100),
    ).join('\n')
    await panel.evaluate(async (code) => {
      await window.threadlight.pinnedCode({
        action: 'add',
        file: {
          id: 'fixture',
          code,
          language: 'python',
          title: 'Practice',
          file: { name: 'practice.py', path: 'C:/fixture/practice.py', kind: 'reference' },
        },
      })
    }, code)
    const dock = panel.getByRole('region', { name: 'Pinned code' })
    await dock.waitFor()
    const dimensions = await dock.evaluate((el) => ({
      width: el.clientWidth,
      file: el.querySelector('[data-pinned-code]').getBoundingClientRect().width,
      radius: getComputedStyle(el.querySelector('[data-pinned-code]')).borderRadius,
      header: el.querySelector('header').getBoundingClientRect().height,
    }))
    assert.ok(
      dimensions.width - dimensions.file < 2 &&
        dimensions.radius === '0px' &&
        dimensions.header <= 20,
    )
    const initial = (await dock.boundingBox()).height
    assert.ok(initial > 180, 'substantial code height')
    async function resizeBy(page, scope, delta) {
      const grip = scope.getByRole('separator', { name: 'Resize pinned reference' })
      if (await scope.getAttribute('data-detached'))
        await page.waitForFunction(
          () =>
            window.innerHeight ===
            Number(
              document
                .querySelector('[aria-label="Resize pinned reference"]')
                .getAttribute('aria-valuenow'),
            ),
        )
      const start = Number(await grip.getAttribute('aria-valuenow')),
        b = await grip.boundingBox()
      const sign = (await grip.getAttribute('data-upward')) ? -1 : 1
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.locator('[data-pin-resizing]').waitFor()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + delta * sign)
      await page.mouse.up()
      await page.waitForFunction(
        (expected) =>
          document
            .querySelector('[aria-label="Resize pinned reference"]')
            .getAttribute('aria-valuenow') === String(expected),
        start + delta,
      )
    }
    const handle = dock.getByRole('separator', { name: 'Resize pinned reference' })
    for (const event of ['blur', 'pointercancel']) {
      const b = await handle.boundingBox()
      await panel.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await panel.mouse.down()
      if (event === 'blur') await panel.evaluate(() => window.dispatchEvent(new Event('blur')))
      else await handle.dispatchEvent('pointercancel', { pointerId: 1 })
      await panel.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 12)
      await panel.mouse.up()
      assert.equal(await handle.getAttribute('aria-valuenow'), '300')
    }
    await resizeBy(panel, dock, 30)
    await dock.getByRole('separator', { name: 'Resize pinned reference' }).press('ArrowUp')
    await pause(100)
    assert.ok((await dock.boundingBox()).height >= initial)
    await app.evaluate(() => {
      const h = globalThis.hoverProof
      h.move(-200, -200)
      h.windows.closeOnPointerLeave()
    })
    assert.ok(
      await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()),
      'main pin keeps its panel',
    )
    await app.evaluate(() => {
      const w = globalThis.hoverProof.windows
      w.setStayOpen(false)
      w.closeOnPointerLeave()
    })
    let reference
    for (let i = 0; i < 80 && !reference; i++) {
      reference = app.windows().find((p) => p.url().includes('view=reference'))
      await pause(80)
    }
    assert.ok(reference)
    const ref = reference.getByRole('region', { name: 'Pinned code' })
    await ref.waitFor()
    const windowState = () =>
      app.evaluate(({ BrowserWindow }) => ({
        panel: globalThis.hoverProof.windows.panel.isVisible(),
        reference: BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('view=reference'))
          ?.isVisible(),
      }))
    assert.deepEqual(await windowState(), { panel: false, reference: true })
    assert.equal(await ref.locator('code').textContent(), code)
    assert.equal(await ref.evaluate((el) => getComputedStyle(el).borderTopWidth), '1px')
    assert.notEqual(await ref.evaluate((el) => getComputedStyle(el).animationName), 'none')
    await reference.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await ref.evaluate((el) => getComputedStyle(el).animationName), 'none')
    for (const right of [false, true])
      for (const bottom of [false, true]) {
        const expected = await app.evaluate(
          ({ screen }, { right, bottom }) => {
            const { windows: w } = globalThis.hoverProof
            const area = screen.getPrimaryDisplay().workArea,
              from = w.dot.getBounds()
            const x = area.x + (right ? area.width - 32 - 8 : 8),
              y = area.y + (bottom ? area.height - 32 - 8 : 8)
            w.dragDot(x - from.x, y - from.y)
            w.endDrag()
            return { x, y }
          },
          { right, bottom },
        )
        for (const view of ['active', 'recent']) {
          await app.evaluate(() => {
            const h = globalThis.hoverProof,
              b = h.windows.dot.getBounds()
            h.move(b.x + 16, b.y + 16)
            h.windows.openFromDot(true)
            h.windows.setStayOpen(true)
          })
          await selectThreadView(panel, view)
          await app.evaluate((_electron, view) => {
            const h = globalThis.hoverProof
            h.windows.resizePanel(view === 'recent' ? 480 : 200)
            h.move(-200, -200)
            h.windows.setStayOpen(false)
            h.windows.closeOnPointerLeave()
          }, view)
          const actual = await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows().find((w) =>
              w.webContents.getURL().includes('view=reference'),
            )
            return {
              bounds: w.getBounds(),
              reference: w.isVisible(),
              dot: globalThis.hoverProof.windows.dot.isVisible(),
            }
          })
          assert.ok(actual.reference && actual.dot)
          assert.deepEqual(actual.bounds, {
            x: expected.x + (right ? 32 - 238 : 0),
            y: expected.y + (bottom ? 32 - 340 : 0),
            width: 238,
            height: 340,
          })
          const detachedGrip = ref.getByRole('separator', { name: 'Resize pinned reference' })
          assert.ok((await ref.locator('header').boundingBox()).height <= 29)
          await detachedGrip.press('ArrowDown')
          await panel.waitForFunction(
            () =>
              document
                .querySelector('[aria-label="Resize pinned reference"]')
                .getAttribute('aria-valuenow') === '330',
          )
          await detachedGrip.press('ArrowUp')
          await resizeBy(reference, ref, -12)
          await resizeBy(reference, ref, 12)
          assert.equal(await ref.getAttribute('data-anchor-right'), right ? 'true' : null)
          assert.equal(await ref.getAttribute('data-anchor-bottom'), bottom ? 'true' : null)
          if (process.platform === 'win32') {
            const hit = await app.evaluate(async ({ BrowserWindow, screen }, koffiPath) => {
              const dot = globalThis.hoverProof.windows.dot
              const w = BrowserWindow.getAllWindows().find((w) =>
                w.webContents.getURL().includes('view=reference'),
              )
              w.focus()
              await new Promise((done) => setTimeout(done, 100))
              const bounds = w.getBounds(),
                d = dot.getBounds()
              const koffi = process.mainModule.require(koffiPath),
                user = koffi.load('user32.dll')
              const windowAt = user.func('uintptr_t __stdcall WindowFromPoint(int64_t)')
              const ancestor = user.func('uintptr_t __stdcall GetAncestor(uintptr_t,unsigned int)')
              const rootAt = (x, y) => {
                const p = screen.dipToScreenPoint({ x, y })
                const bits =
                  (BigInt.asUintN(32, BigInt(p.y)) << 32n) | BigInt.asUintN(32, BigInt(p.x))
                return String(ancestor(windowAt(BigInt.asIntN(64, bits)), 2))
              }
              const logo = String(dot.getNativeWindowHandle().readBigUInt64LE()),
                reference = String(w.getNativeWindowHandle().readBigUInt64LE())
              const pixels = await w.capturePage({
                x: d.x - bounds.x + 4,
                y: d.y - bounds.y + 4,
                width: 1,
                height: 1,
              })
              const logoHit = [8, 12, 16, 20, 24].some((dx) =>
                [8, 12, 16, 20, 24].some((dy) => rootAt(d.x + dx, d.y + dy) === logo),
              )
              const atCode = rootAt(bounds.x + 100, bounds.y + 100)
              // Reveal the native window directly beneath the logo without moving either window.
              dot.hide()
              await new Promise((done) => setTimeout(done, 80))
              const underneath = rootAt(d.x + 16, d.y + 16)
              const dc = user.func('uintptr_t __stdcall GetDC(uintptr_t)')(0)
              const point = screen.dipToScreenPoint({ x: d.x + 16, y: d.y + 16 })
              let pixel
              try {
                pixel = koffi
                  .load('gdi32.dll')
                  .func('unsigned int __stdcall GetPixel(uintptr_t,int,int)')(dc, point.x, point.y)
              } finally {
                user.func('int __stdcall ReleaseDC(uintptr_t,uintptr_t)')(0, dc)
                dot.showInactive()
                dot.moveTop()
              }
              // Desktop colour management can shift the rendered grey by a level.
              const background = [0, 8, 16].every(
                (shift) => Math.abs(((pixel >>> shift) & 255) - 23) <= 2,
              )
              return {
                logoHit,
                codeHit: atCode === reference,
                backing: [...pixels.toBitmap().subarray(0, 4)],
                backgroundVisible: underneath === reference && background,
                debug: { bounds, d, logo, reference, atCode, underneath, pixel },
              }
            }, require.resolve('koffi'))
            const { debug, ...observed } = hit
            assert.deepEqual(
              observed,
              { logoHit: true, codeHit: true, backing: [23, 23, 23, 255], backgroundVisible: true },
              JSON.stringify(debug),
            )
          }
        }
      }
    const replaced = await app.evaluate(() =>
      globalThis.hoverProof.pins.replace(
        'fixture',
        1,
        '# updated snapshot\n' + globalThis.hoverProof.pins.current.files[0].code,
      ),
    )
    assert.equal(replaced.outcome, 'ok')
    for (const surface of [dock, ref]) {
      await surface
        .locator('code')
        .filter({ hasText: '# updated snapshot' })
        .waitFor({ state: 'attached' })
    }
    await ref.locator('summary').first().press('Shift+F10')
    await reference.getByRole('menuitem', { name: /Previous version/ }).click()
    for (const surface of [dock, ref])
      assert.equal(await surface.locator('code').textContent(), code)
    await ref.getByRole('button', { name: 'Copy code' }).click()
    const copied = await app.evaluate(
      () => globalThis.hoverProof.events.filter((e) => e.event === 'clipboard:copy').at(-1)?.value,
    )
    assert.equal(copied, code)
    await ref.locator('pre').click({ button: 'right' })
    await reference.getByRole('menuitem', { name: /Next version/ }).click()
    await ref.getByText(/Version 2.*Latest/).waitFor()
    await ref.locator('summary').focus()
    await ref
      .locator('[data-hover-message] [role="tooltip"]')
      .filter({ hasText: 'C:/fixture/practice.py' })
      .waitFor()
    await ref.locator('summary').press('Enter')
    await ref.locator('details:not([open])').waitFor()
    await ref.locator('summary').press('Enter')
    await ref.locator('details[open]').waitFor()
    const body = ref.locator('pre'),
      box = await body.boundingBox()
    await body.hover()
    await reference.keyboard.down('Shift')
    await reference.mouse.wheel(0, 75)
    await reference.keyboard.up('Shift')
    await reference.waitForFunction(
      () => document.querySelector('[data-reply-code]').scrollLeft > 0,
    )
    await body.evaluate((el) => (el.scrollLeft = 0))
    await app.evaluate(({ screen }) => {
      const h = globalThis.hoverProof,
        b = screen.getPrimaryDisplay().bounds
      h.move(b.x + 140, b.y + 200)
      h.modifiers(true, false)
      h.holdLeft(true)
    })
    await reference.keyboard.down('Control')
    await reference.mouse.move(box.x + 60, box.y + 55)
    await reference.mouse.down()
    await body.locator('xpath=self::*[@data-code-panning]').waitFor()
    await pause(60)
    await app.evaluate(({ screen }) => {
      const h = globalThis.hoverProof,
        b = screen.getPrimaryDisplay().bounds
      h.move(b.x, b.y + 200)
    })
    await pause(160)
    const first = await body.evaluate((el) => el.scrollLeft)
    await pause(100)
    assert.ok(
      (await body.evaluate((el) => el.scrollLeft)) > first && first > 0,
      'continues beyond window at stationary display edge',
    )
    await app.evaluate(() => {
      globalThis.hoverProof.holdLeft(false)
      globalThis.hoverProof.modifiers(false, false)
    })
    await pause(80)
    const end = await body.evaluate((el) => el.scrollLeft)
    await pause(100)
    assert.equal(await body.evaluate((el) => el.scrollLeft), end)
    await reference.mouse.up()
    await reference.keyboard.up('Control')
    assert.deepEqual(await windowState(), { panel: false, reference: true })
    await app.evaluate(() => {
      const h = globalThis.hoverProof
      h.windows.openPanel({ focus: false, fresh: false })
      const b = h.windows.panel.getBounds()
      h.move(b.x + 35, b.y + 15)
      h.windows.setStayOpen(true)
    })
    await pause(150)
    assert.deepEqual(await windowState(), { panel: true, reference: false })
    await app.evaluate(() => {
      const h = globalThis.hoverProof
      h.windows.setStayOpen(false)
      h.move(-200, -200)
      h.windows.closeOnPointerLeave()
    })
    await ref.getByRole('button', { name: 'Unpin code' }).click()
    await pause(150)
    assert.deepEqual(await windowState(), { panel: false, reference: false })
    assert.equal(
      await panel.evaluate(
        async () => (await window.threadlight.pinnedCode({ action: 'open' })).files.length,
      ),
      0,
    )
    assert.deepEqual(failures, [])
    console.log(
      'PASS native detached reference, four logo corners across Active and Recent, main-panel independence, resizing, stripe and reduced motion, panning past the window with simulated screen edge, release and unpin.',
    )
    break checks
  }
  // The panel owns capture. Replace only the microphone, keeping both real IPC hops.
  await panel.evaluate(() => {
    const off = window.threadlight.onStopOpenMic(() => {
      off()
      window.threadlight.setOpenMicLive(false)
    })
    window.threadlight.setOpenMicLive(true)
  })
  const mic = dot.getByRole('group', { name: 'Microphone is open' })
  await mic.waitFor()
  await app.evaluate(() => {
    const proof = globalThis.hoverProof,
      bounds = proof.windows.dot.getBounds()
    proof.move(bounds.x + 12, bounds.y + 12)
  })
  await mic.getByRole('button', { name: /open voice panel/i }).hover()
  await panel.waitForFunction(() => !document.hidden)
  await app.evaluate(() => globalThis.hoverProof.windows.closeOnPointerLeave())
  assert.ok(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()))
  assert.ok(await panel.evaluate(async () => (await window.threadlight.getOpenMicIndicator()).live))
  await app.evaluate(() => globalThis.hoverProof.windows.closePanel())
  await mic.getByRole('button', { name: /open voice panel/i }).click({ button: 'right' })
  await dot.getByRole('menuitem', { name: 'Hang up' }).click()
  await mic.waitFor({ state: 'detached' })
  assert.equal(
    await panel.evaluate(async () => (await window.threadlight.getOpenMicIndicator()).live),
    false,
  )
  if (process.env.THREADLIGHT_UI_FOCUS === 'mic-indicator') {
    assert.deepEqual(failures, [])
    console.log('PASS: floating waveform opens the panel and Stop reaches its microphone owner.')
    break checks
  }
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
        await dot.mouse.move(16, 16)
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
    await dot.mouse.move(16, 16)
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
  // Exercise real native bounds and click-through on both sides of the production dual card.
  await app.evaluate(() => {
    const { windows } = globalThis.hoverProof
    windows.openPanel()
    windows.setStayOpen(true)
  })
  await panel.evaluate(() =>
    window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      listMode: 'recent',
      workspaceWires: true,
    }),
  )
  await selectThreadView(panel, 'recent')
  await panel.waitForFunction(
    () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 475,
  )
  await pause(1100)
  const dual = await app.evaluate(() => globalThis.hoverProof.windows.panel.getBounds())
  assert.equal(dual.width, 491, 'empty lists reserve no right gutter')
  const card = await panel.locator('[data-card]').boundingBox()
  assert.equal(card.x, 16)
  assert.equal(dual.width - card.x - card.width, 0)
  await app.evaluate(() => globalThis.hoverProof.wireGroup(true))
  await panel.locator('[data-wire-zone="right"]').waitFor()
  await pause(100)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.getBounds().width), 497)
  const wiredCard = await panel.locator('[data-card]').boundingBox()
  assert.equal(497 - wiredCard.x - wiredCard.width, 6, 'right gutter fits one rail and its backing')
  for (const [x, y, ignored] of [
    [8, 50, true],
    [494, 50, true],
    [30, 50, false],
  ]) {
    await app.evaluate(
      (_electron, { x, y }) => {
        const { windows, move } = globalThis.hoverProof
        const bounds = windows.panel.getBounds()
        move(bounds.x + x, bounds.y + y)
      },
      { x, y },
    )
    await pause(50)
    assert.equal(await app.evaluate(() => globalThis.hoverProof.mouseIgnored), ignored)
  }
  await app.evaluate(() => globalThis.hoverProof.wireGroup(false))
  await panel.locator('[data-wire-zone="right"]').waitFor({ state: 'detached' })
  await pause(100)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.getBounds().width), 491)
  await panel.locator('[data-thread-view]').click({ button: 'right' })
  await panel.getByRole('menuitem', { name: 'Workspace', exact: true }).click()
  await pause(100)
  const workAreaTop = await app.evaluate(({ screen }) => {
    const { windows } = globalThis.hoverProof
    windows.dragDot(0, -5000)
    windows.endDrag()
    return screen.getDisplayMatching(windows.panel.getBounds()).workArea.y
  })
  await pause(100)
  assert.equal(
    await app.evaluate(() => globalThis.hoverProof.windows.panel.getBounds().y),
    workAreaTop,
  )
  assert.equal(
    (await panel.locator('[data-card]').boundingBox()).y,
    0,
    'Workspace card reaches the native top edge',
  )
  await panel.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'single' }))
  await panel.waitForFunction(
    () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
  )
  await pause(1100)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.getBounds().width), 254)
  await app.evaluate(() => {
    const { windows, move } = globalThis.hoverProof
    windows.setStayOpen(false)
    windows.closePanel()
    move(50, 50)
    globalThis.hoverProof.modifiers(true, false)
  })
  await pause(80)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.dot.isVisible()), false)
  await app.evaluate(() => globalThis.hoverProof.windows.keepOnTop())
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.dot.isVisible()), false)
  await app.evaluate(() => globalThis.hoverProof.modifiers(true, true))
  await panel.getByRole('region', { name: 'Temporary Active threads' }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.hoverProof.mouseIgnored), true)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.isFocused()), false)
  await app.evaluate(() => globalThis.hoverProof.modifiers(true, false))
  await pause(80)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()), false)
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.dot.isVisible()), false)
  await app.evaluate(() => globalThis.hoverProof.modifiers(false, false))
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await app.evaluate(() => globalThis.hoverProof.windows.dot.isVisible())) break
    await pause(20)
  }
  assert.equal(
    await app.evaluate(() => globalThis.hoverProof.windows.dot.isVisible()),
    true,
    JSON.stringify(
      await app.evaluate(() => {
        const windows = globalThis.hoverProof.windows
        return {
          stage: windows.modifierStage,
          panel: windows.panel.isVisible(),
          running: windows.claudeRunning,
        }
      }),
    ),
  )
  await app.evaluate(() => {
    const { windows } = globalThis.hoverProof
    windows.openPanel()
    windows.setStayOpen(true)
  })
  await panel.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.evaluate(() => globalThis.hoverProof.modifiers(true, true))
  await panel.getByRole('region', { name: 'Temporary Active threads' }).waitFor()
  await app.evaluate(() => globalThis.hoverProof.modifiers(false, true))
  await panel.getByRole('button', { name: 'Back to sessions', exact: true }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.hoverProof.windows.panel.isVisible()), true)
  await app.evaluate(() => globalThis.hoverProof.modifiers(false, false))
  await app.evaluate(() =>
    globalThis.hoverProof.windows.panel.emit('app-command', {}, 'browser-backward'),
  )
  await panel.locator('[data-thread-view]').waitFor()
  await app.evaluate(() =>
    globalThis.hoverProof.windows.panel.emit('app-command', {}, 'browser-forward'),
  )
  await panel.getByRole('button', { name: 'Back to sessions', exact: true }).waitFor()
  console.log(
    'PASS: real modifier polling hides the native dot, keeps it hidden through keep-on-top, opens an unfocused click-through Active peek, handles both releases, restores Settings, and accepts native mouse app commands.',
  )
  console.log(
    'PASS: real Electron fits/removes the right wire gutter, preserves click-through and card input, lets Workspace reach the screen top, and restores single width.',
  )
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
