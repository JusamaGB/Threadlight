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
          state: 'waiting', // keep both dated rows visible throughout the clock advances
          lastActiveAt: Date.now() - (session.provider === 'codex' ? 25 : 6) * 3600000,
        })),
      })
    })
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
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

export async function checkTips(page, row, capture = async () => {}) {
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
  const vertical = async (point) => {
    const box = await tip.boundingBox()
    const card = await page.locator('[data-card]').boundingBox()
    assert.ok(box, 'the bubble is visible')
    assert.ok(
      box.y >= point.y + 17.5 || box.y + box.height <= point.y - 17.5,
      'above or below the pointer',
    )
    assert.ok(
      box.x >= card.x + 3.5 && box.x + box.width <= card.x + card.width - 3.5,
      'inside the app card',
    )
    assert.equal(await tip.count(), 1, 'only the hovered target owns a bubble')
  }
  try {
    for (const provider of ['Claude', 'Codex']) {
      assert.equal(await row(provider).getAttribute('title'), null)
      await move(row(provider))
      assert.equal(await tip.count(), 0, 'thread rows have no provider bubble')
      const at = await context(provider)
      await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
      await vertical(at)
      assert.ok((await tip.boundingBox()).width < 150, 'short text stays content-sized')
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
    const reorderPoint = await context('Claude')
    await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
    await page.evaluate(async () => {
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onSnapshot', {
        ...snapshot,
        sessions: [...snapshot.sessions]
          .reverse()
          .map((session) => ({
            ...session,
            contextUsed: session.provider === 'claude' ? 0.35 : 0.45,
          })),
      })
    })
    await page
      .getByRole('tooltip', { name: 'Context 20%', exact: true })
      .waitFor({ state: 'detached' })
    if (await tip.count()) {
      const owner = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[data-tip-anchor]')?.getAttribute('aria-label'),
        reorderPoint,
      )
      assert.equal(
        await tip.innerText(),
        owner,
        'any replacement tip belongs to the target now under the pointer',
      )
    }
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
    const usage = await page.getByLabel(/^Claude · 5-hour limit 20%/).boundingBox()
    for (const x of [usage.x + 12, usage.x + usage.width / 2, usage.x + usage.width - 12]) {
      const at = { x, y: usage.y + usage.height / 2 }
      await page.mouse.move(at.x, at.y)
      await vertical(at)
      assert.ok(
        (await tip.boundingBox()).width >= 280,
        'long text may use the full app width at either edge or the centre',
      )
    }
    await capture('hover-info-full-width')
    await page.getByLabel(/^Codex · Weekly limit 27%/).hover()
    await page.getByRole('tooltip').filter({ hasText: 'Codex · Weekly limit 27%' }).waitFor()
    await page.mouse.move(5, 5)
    await tip.waitFor({ state: 'detached' })
    // Task details share the same placement and may wrap a long task label.
    await page.evaluate(async () => {
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onSnapshot', {
        ...snapshot,
        sessions: snapshot.sessions.map((session) =>
          session.provider === 'claude'
            ? {
                ...session,
                backgroundTasks: [
                  {
                    id: 'long-task',
                    label:
                      'Check the shared workspace implementation and run the complete focused verification for the current application changes',
                    startedAt: Date.now() - 42000,
                  },
                  { id: 'short-task', label: 'Build', startedAt: Date.now() - 7000 },
                ],
              }
            : session,
        ),
      })
    })
    const task = row('Claude').getByText('Tasks ×2', { exact: true })
    const taskBox = await task.boundingBox()
    const at = { x: taskBox.x + taskBox.width / 2, y: taskBox.y + taskBox.height / 2 }
    await page.mouse.move(at.x, at.y)
    await tip.waitFor()
    await vertical(at)
    assert.ok((await tip.boundingBox()).width >= 280)
    const taskTip = await tip.boundingBox()
    assert.ok(
      await page.evaluate(
        (bottom) => window.proof.resizes.at(-1) >= bottom + 3,
        taskTip.y + taskTip.height,
      ),
      'compact windows reserve enough height for the popup',
    )
    await capture('hover-info-task-details')
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')))
    await tip.waitFor({ state: 'detached' })
    assert.equal(
      await page.evaluate(() => window.proof.resizes.at(-1)),
      await page.locator('[data-card]').evaluate((el) => el.getBoundingClientRect().height),
      'popup room is released on dismissal',
    )
    await page.evaluate(async () =>
      window.proof.emit('onSnapshot', await window.threadlight.getSnapshot()),
    )
    console.log(
      'PASS: content-sized tips above/below the pointer, full-width long usage/task text, and instant leave/click/reorder/scroll dismissal with frozen timers.',
    )
  } finally {
    await page.clock.resume()
    await page.setViewportSize({ width: 460, height: 900 })
  }
}
