/* global window, document */
import assert from 'node:assert/strict'
import { readMotionFrame } from './motion-pixels.mjs'

export async function checkMicPill(page, capture) {
  await page.evaluate(() => window.proof.emit('onOpenMicLive', true))
  const pill = page.getByRole('group', { name: 'Microphone is open', exact: true })
  await pill.waitFor()
  const bounds = await pill.boundingBox()
  assert.equal(bounds.width, 92)
  assert.equal(bounds.height, 24)
  const opens = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'dotClick').length)
  const before = await opens()
  const hovers = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'dotHover').length)
  const priorHovers = await hovers()
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 1000).toISOString()))
  await pill.hover()
  await page.clock.runFor(499)
  assert.equal(
    await hovers(),
    priorHovers,
    'the full half second is available to grab the waveform',
  )
  await page.clock.runFor(1)
  await page.clock.resume()
  await page.waitForFunction(
    (n) => window.proof.calls.filter((c) => c[0] === 'dotHover').length > n,
    priorHovers,
  )
  assert.equal(await opens(), before)
  const afterHover = await hovers()
  await page.evaluate(() => window.proof.emit('onOpenMicLevel', 0.7))
  assert.ok((await readMotionFrame(pill.getByRole('img'))).count > 0)
  await capture('open-mic-pill')
  await page.evaluate(() =>
    window.proof.emit('onMotion', {
      mode: 'listening',
      inputMuted: true,
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: { level: 0, low: 0, mid: 0, high: 0 },
    }),
  )
  const mutedWave = pill.getByRole('button', { name: /Live microphone muted/ })
  await mutedWave.waitFor()
  await page.waitForTimeout(450)
  const surface = mutedWave.getByRole('img')
  // Compare painted pixels as well as boxes; a full-size canvas can draw an inset wave.
  for (const width of [72, 116, bounds.width]) {
    await pill.evaluate((el, w) => {
      el.style.width = w + 'px'
    }, width)
    await page.waitForFunction(
      (w) =>
        document.querySelector('[data-waveform-only] canvas')?.width ===
        Math.round(w * Math.min(2, window.devicePixelRatio)),
      width,
    )
    const frame = await readMotionFrame(surface)
    const box = await surface.boundingBox()
    assert.equal(box.x, bounds.x)
    assert.equal(box.width, width)
    assert.ok(
      frame.left < 1 && frame.right >= width - 1,
      JSON.stringify({ width, left: frame.left, right: frame.right }),
    )
  }
  await pill.evaluate((el) => el.style.removeProperty('width'))
  const mutedPixels = await readMotionFrame(mutedWave.getByRole('img'))
  assert.ok(
    mutedPixels.orange > mutedPixels.blue && mutedPixels.orange > 0,
    `quiet muted waveform is red ${JSON.stringify(mutedPixels)}`,
  )
  for (const provider of ['codex', 'claude']) {
    for (const level of [0.08, 0.25, 0]) {
      await page.evaluate(
        ({ provider, level }) =>
          window.proof.emit('onMotion', {
            mode: 'thinking',
            agentWorking: true,
            inputMuted: true,
            provider,
            input: { level: 0, low: 0, mid: 0, high: 0 },
            output: { level, low: level, mid: level, high: level },
          }),
        { provider, level },
      )
      await pill.locator('[data-waveform-only]').waitFor()
      await page.waitForTimeout(350)
      const edge = await pill.evaluate((el) => {
        const style = window.getComputedStyle(el, '::before')
        return { strength: Number(style.opacity), colour: style.boxShadow }
      })
      assert.equal(edge.strength, level * 3)
      assert.ok(edge.colour.includes(provider === 'claude' ? '218, 138, 98' : '104, 170, 255'))
      if (level) {
        const pixels = await readMotionFrame(pill.getByRole('img'))
        assert.ok(provider === 'claude' ? pixels.orange > pixels.blue : pixels.blue > pixels.orange)
        assert.equal(await pill.getAttribute('data-agent-working'), 'true')
        assert.match(
          await mutedWave.getAttribute('aria-description'),
          /Agent speaking.*Agent working/,
        )
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert.equal(
          await pill.evaluate((el) => window.getComputedStyle(el, '::before').opacity),
          '0.7',
        )
        assert.equal(
          await pill.evaluate((el) => window.getComputedStyle(el, '::after').animationName),
          'none',
        )
        await page.emulateMedia({ reducedMotion: 'no-preference' })
      }
    }
  }
  const level = (value) =>
    page.evaluate(
      (value) =>
        window.proof.emit('onMotion', {
          mode: 'listening',
          provider: 'codex',
          input: { level: 0, low: 0, mid: 0, high: 0 },
          output: { level: value, low: value, mid: value, high: value },
        }),
      value,
    )
  const glow = () => pill.evaluate((el) => Number(window.getComputedStyle(el, '::before').opacity))
  for (const speech of [0.25, 0.18]) {
    await level(speech)
    await page.waitForFunction((target) => {
      const opacity = Number(
        window.getComputedStyle(document.querySelector('[data-speaking]'), '::before').opacity,
      )
      return opacity > 0 && opacity < target
    }, speech * 3)
    await page.waitForTimeout(190)
    assert.ok(Math.abs((await glow()) - speech * 3) < 0.01)
    await level(0)
    await page.waitForFunction((target) => {
      const opacity = Number(
        window.getComputedStyle(document.querySelector('[data-provider="codex"]'), '::before')
          .opacity,
      )
      return opacity > 0 && opacity < target
    }, speech * 3)
    await page.waitForTimeout(290)
    assert.equal(await glow(), 0)
  }
  for (const working of [true, false]) {
    await page.evaluate(
      (working) =>
        window.proof.emit('onMotion', {
          mode: working ? 'thinking' : 'waiting',
          agentWorking: working,
          input: { level: 0, low: 0, mid: 0, high: 0 },
          output: { level: 0, low: 0, mid: 0, high: 0 },
        }),
      working,
    )
    assert.equal(await pill.getAttribute('data-agent-working'), working ? 'true' : null)
    if (working) {
      const anim = () => pill.evaluate((el) => window.getComputedStyle(el, '::after').animationName)
      assert.notEqual(await anim(), 'none')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await anim(), 'none')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  }
  const wave = pill.getByRole('button')
  await wave.focus()
  await wave.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'Voice call actions' })
  assert.equal(await menu.getByRole('menuitem', { name: 'Stop speaking' }).count(), 0)
  await menu.getByRole('menuitem', { name: 'Pause listening' }).click()
  await page.evaluate(() =>
    window.proof.emit('onMotion', {
      mode: 'listening',
      listeningPaused: true,
      inputMuted: true,
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: { level: 0.2, low: 0.2, mid: 0.2, high: 0.2 },
    }),
  )
  await wave.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Stop speaking' }).click()
  await wave.press('Shift+F10')
  await menu.getByRole('menuitem', { name: 'Resume listening' }).click()
  assert.deepEqual(
    await page.evaluate(() =>
      window.proof.calls.filter((c) => c[0] === 'micAction').map((c) => c[1]),
    ),
    ['pause', 'stopSpeaking', 'resume'],
  )
  await wave.press('Shift+F10')
  await page.keyboard.press('Escape')
  assert.equal(await menu.count(), 0)
  await page.mouse.move(bounds.x + bounds.width + 10, bounds.y + 10)
  await page.mouse.move(bounds.x + 14, bounds.y + 10)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 15, bounds.y + 10)
  await page.clock.fastForward(350)
  assert.equal(await hovers(), afterHover, 'a press cancels pending hover')
  assert.equal(await page.evaluate(() => window.proof.calls.some((c) => c[0] === 'dotDrag')), false)
  await page.mouse.move(bounds.x + 40, bounds.y + 10)
  await page.mouse.move(bounds.x + 42, bounds.y + 16)
  await page.mouse.up()
  await page.clock.fastForward(350)
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0].startsWith('dotDrag'))),
    [['dotDrag', 26, 0], ['dotDrag', 28, 6], ['dotDragEnd']],
  )
  assert.equal(await hovers(), afterHover, 'release over the waveform does not open it')
  assert.equal(await opens(), before)
  await wave.click()
  assert.equal(await opens(), before, 'plain left click is reserved for dragging')
  await wave.press('Enter')
  assert.equal(await opens(), before + 1)
  await page.mouse.move(bounds.x + bounds.width + 10, bounds.y + 10)
  await wave.hover()
  await page.waitForFunction(
    (n) => window.proof.calls.filter((c) => c[0] === 'dotHover').length > n,
    afterHover,
  )
  await wave.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Hang up' }).click()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'stopOpenMic').length),
    1,
  )
  await page.evaluate(() => {
    window.proof.emit('onMotion', {
      mode: 'waiting',
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: { level: 0, low: 0, mid: 0, high: 0 },
    })
    window.proof.emit('onOpenMicLive', false)
  })
  await pill.waitFor({ state: 'detached' })
  await page.getByRole('status', { name: 'Agent waiting for you' }).waitFor()
  assert.equal(await page.locator('[data-agent-working]').count(), 0)
}
