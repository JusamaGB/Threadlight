/* global document, window */
import assert from 'node:assert/strict'

export async function checkTips(page, row) {
  await page.setViewportSize({ width: 342, height: 900 })
  await page.clock.pauseAt(new Date())
  const tip = page.getByRole('tooltip')
  const move = async (target, offset = 70) => {
    const box = await target.boundingBox()
    const point = { x: box.x + offset, y: box.y + 13 }
    await page.mouse.move(point.x, point.y)
    return point
  }
  const beside = async (point, side = 'right') => {
    const box = await tip.boundingBox()
    assert.ok(box, 'the bubble is visible')
    if (side === 'right') assert.ok(box.x >= point.x + 18)
    else assert.ok(box.x + box.width <= point.x - 18)
    assert.ok(box.y <= point.y && box.y + box.height >= point.y, 'same line as the pointer')
    assert.ok(box.x >= 4 && box.x + box.width <= 338, 'inside the window')
    assert.equal(await tip.count(), 1, 'only the hovered target owns a bubble')
  }
  try {
    for (const provider of ['Claude', 'Codex']) {
      assert.equal(await row(provider).getAttribute('title'), null)
      const pointer = await move(row(provider))
      await page.clock.runFor(999)
      assert.equal(await tip.count(), 0, 'no bubble before the one-second delay')
      await page.clock.runFor(1)
      await page.getByRole('tooltip', { name: `${provider} chat`, exact: true }).waitFor()
      await beside(pointer)

      // A context target cancels its parent row's bubble and starts its own delay.
      const context = row(provider).getByLabel('Context 20%', { exact: true })
      const bounds = await context.boundingBox()
      const at = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      await page.mouse.move(at.x, at.y)
      assert.equal(await tip.count(), 0)
      await page.clock.runFor(1000)
      await page.getByRole('tooltip', { name: 'Context 20%', exact: true }).waitFor()
      await beside(at)
    }
    const edge = await move(row('Codex'), 325)
    await page.clock.runFor(1000)
    await page.getByRole('tooltip', { name: 'Codex chat', exact: true }).waitFor()
    await beside(edge, 'left')
    // Moving a visible bubble keeps it beside this pointer, rather than on the previous row.
    await page.mouse.move(edge.x - 15, edge.y + 2)
    await beside({ x: edge.x - 15, y: edge.y + 2 }, 'left')

    await move(row('Claude'))
    assert.equal(await tip.count(), 0, 'old row disappears immediately')
    await page.clock.runFor(500)
    await move(row('Codex'))
    await page.clock.runFor(500)
    assert.equal(await tip.count(), 0, 'crossing rows cancels the previous timer')
    await page.clock.runFor(500)
    await page.getByRole('tooltip', { name: 'Codex chat', exact: true }).waitFor()

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
    await page.clock.runFor(1100)
    assert.equal(await tip.count(), 0, 'leaving cannot reopen an old bubble')
    await move(row('Claude'))
    await page.clock.runFor(1000)
    await page.getByRole('tooltip', { name: 'Claude chat', exact: true }).waitFor()
    await page.evaluate(async () => {
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onSnapshot', { ...snapshot, sessions: [...snapshot.sessions].reverse() })
    })
    await tip.waitFor({ state: 'detached' })
    await page.evaluate(async () =>
      window.proof.emit('onSnapshot', await window.threadlight.getSnapshot()),
    )
    await page.mouse.move(5, 5)
    const pointer = await move(row('Claude'))
    await page.clock.runFor(1000)
    await page.getByRole('tooltip', { name: 'Claude chat', exact: true }).waitFor()
    await page.mouse.down()
    assert.equal(await tip.count(), 0, 'clicking dismisses the bubble')
    await page.mouse.move(pointer.x, 5)
    await page.mouse.up()
    console.log(
      'PASS: delayed pointer-side tips, nested targets, edge flip, row changes, reorder and scroll.',
    )
  } finally {
    await page.clock.resume()
    await page.setViewportSize({ width: 460, height: 900 })
  }
}
