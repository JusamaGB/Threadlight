/* global document, window */
import assert from 'node:assert/strict'

export async function checkLastActive(page, row, capture) {
  const initial = await page.evaluate(async () => ({
    snapshot: await window.threadlight.getSnapshot(),
    settings: await window.threadlight.getSettings(),
  }))
  try {
    await page.evaluate(async () => {
      await window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] })
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onSnapshot', {
        ...snapshot,
        sessions: snapshot.sessions.map((session) => ({
          ...session,
          lastActiveAt: Date.now() - (session.provider === 'codex' ? 25 : 6) * 3600000,
        })),
      })
    })
    await page.clock.pauseAt(await page.evaluate(() => Date.now()))
    const tip = page.getByRole('tooltip')
    const hover = async (provider) => {
      const box = await row(provider).boundingBox()
      await page.mouse.move(box.x + 65, box.y + 8)
      return box
    }
    const box = await hover('Claude')
    await page.clock.runFor(999)
    assert.equal(await tip.count(), 0, 'no last active tip before one second')
    await page.mouse.move(box.x + 66, box.y + 8)
    await page.clock.runFor(999)
    assert.equal(await tip.count(), 0, 'movement restarts the one-second wait')
    await page.clock.runFor(1)
    await tip.waitFor()
    assert.match(await tip.innerText(), /^Last active at /)
    await capture('last-active-time-hover')
    await page.mouse.move(box.x + 67, box.y + 8)
    assert.equal(await tip.count(), 0, 'movement dismisses the shown time')
    await page.locator('header').hover()
    await page.clock.runFor(1100)
    assert.equal(await tip.count(), 0, 'leaving cancels the pending time')
    await hover('Codex')
    await page.clock.runFor(1000)
    await tip.waitFor()
    assert.match(await tip.innerText(), /^Last active on /)
    await capture('last-active-date-hover')
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')))
    assert.equal(await tip.count(), 0, 'scrolling clears the last active tip')
    await hover('Claude')
    await page.clock.runFor(500)
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')))
    await page.clock.runFor(1000)
    assert.equal(await tip.count(), 0, 'scrolling cancels a pending time')
    console.log(
      'PASS: last active appears after one stationary second, uses time/date at 24 hours and cancels on movement, leave and scroll.',
    )
  } finally {
    await page.clock.resume()
    await page.evaluate(async ({ snapshot, settings }) => {
      await window.threadlight.updateSettings(settings)
      window.proof.emit('onSnapshot', snapshot)
    }, initial)
  }
}

export async function checkTips(page, row) {
  await page.setViewportSize({ width: 316, height: 900 })
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const tip = page.getByRole('tooltip')
  const move = async (target, offset = 70) => {
    const box = await target.boundingBox()
    const point = { x: box.x + offset, y: box.y + 13 }
    await page.mouse.move(point.x, point.y)
    return point
  }
  const context = async (provider) => {
    const bounds = await row(provider).getByLabel('Context 20%', { exact: true }).boundingBox()
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    await page.mouse.move(point.x, point.y)
    return point
  }
  const beside = async (point, side = 'right') => {
    const box = await tip.boundingBox()
    assert.ok(box, 'the bubble is visible')
    if (side === 'right') assert.ok(box.x >= point.x + 18)
    else assert.ok(box.x + box.width <= point.x - 18)
    assert.ok(box.y <= point.y && box.y + box.height >= point.y, 'same line as the pointer')
    assert.ok(box.x >= 4 && box.x + box.width <= 312, 'inside the window')
    assert.equal(await tip.count(), 1, 'only the hovered target owns a bubble')
  }
  try {
    for (const provider of ['Claude', 'Codex']) {
      assert.equal(await row(provider).getAttribute('title'), null)
      await move(row(provider))
      assert.equal(await tip.count(), 0, 'thread rows have no provider bubble')
      const at = await context(provider)
      await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
      await beside(at)
      await move(row(provider))
      assert.equal(await tip.count(), 0, 'moving away from the ring hides context immediately')
    }
    await context('Claude')
    await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
    await context('Codex')
    await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
    assert.equal(await tip.count(), 1)

    // Scrolling must clear a bubble even when the mouse has not moved.
    await page.evaluate(() => {
      const list = document.querySelector('[class*="_sessions_"] > [class*="_list_"]')
      list.style.maxHeight = '50px'
      list.scrollTop = 10
    })
    await tip.waitFor({ state: 'detached' })
    await page.evaluate(() => {
      const list = document.querySelector('[class*="_sessions_"] > [class*="_list_"]')
      list.style.maxHeight = ''
      list.scrollTop = 0
    })
    await page.mouse.move(5, 5)
    assert.equal(await tip.count(), 0, 'leaving cannot reopen an old bubble')
    await context('Claude')
    await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
    await page.evaluate(async () => {
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onSnapshot', {
        ...snapshot,
        sessions: [...snapshot.sessions]
          .reverse()
          .map((session) => ({ ...session, contextUsed: 0.35 })),
      })
    })
    await page
      .getByRole('tooltip', { name: 'Context 20%', exact: true })
      .waitFor({ state: 'detached' })
    await page.evaluate(async () =>
      window.proof.emit('onSnapshot', await window.threadlight.getSnapshot()),
    )
    await page.mouse.move(5, 5)
    const pointer = await context('Claude')
    await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
    await page.mouse.down()
    assert.equal(await tip.count(), 0, 'clicking dismisses the bubble')
    await page.mouse.move(pointer.x, 5)
    await page.mouse.up()
    // The clock is still paused: none of these bubbles may require a timer to appear.
    await page.getByLabel(/^Claude · 5-hour limit 20%/).hover()
    await page.getByRole('tooltip').filter({ hasText: 'Claude · 5-hour limit 20%' }).waitFor()
    await page.getByLabel(/^Codex · Weekly limit 27%/).hover()
    await page.getByRole('tooltip').filter({ hasText: 'Codex · Weekly limit 27%' }).waitFor()
    await page.mouse.move(5, 5)
    await tip.waitFor({ state: 'detached' })
    console.log(
      'PASS: instant context and usage tips with frozen timers; immediate leave, reorder and scroll.',
    )
  } finally {
    await page.clock.resume()
    await page.setViewportSize({ width: 460, height: 900 })
  }
}
