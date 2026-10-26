/* global window, document, getComputedStyle, MouseEvent */
import assert from 'node:assert/strict'

export async function checkPanelHeight(page) {
  await page.setViewportSize({ width: 460, height: 1200 })
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    const settings = await window.threadlight.getSettings()
    const template = snapshot.sessions[0]
    const sessions = Array.from({ length: 19 }, (_, i) => ({
      ...template,
      id: `synthetic-height-${i}`,
      title: `Synthetic height row ${i}`,
      state: 'idle',
      lastActiveAt: Date.now() - 3600_000,
      attention: null,
    }))
    window.proof.emit('onSettings', { ...settings, listMode: 'recent' })
    window.proof.emit('onSnapshot', { ...snapshot, sessions, lookupSessions: sessions })
    window.proof.emit('onPanelOpened', { maxHeight: 1200, opensDown: true, fresh: true })
  })
  const expandedList = page.locator('header button[data-thread-view]')
  await expandedList.click()
  await page.locator('[data-session-id="synthetic-height-18"]').waitFor()
  const measure = () =>
    page.evaluate(() => {
      const card = document.querySelector('[data-card]')
      const list = card.querySelector('[class*="_sessions_"] > [class*="_list_"]')
      const footer = card.querySelector('[class*="_usageBars_"]')
      return {
        height: card.getBoundingClientRect().height,
        maxHeight: Number.parseFloat(getComputedStyle(card).maxHeight),
        overflow: list.scrollHeight - list.clientHeight,
        listBottom: list.getBoundingClientRect().bottom,
        footerTop: footer.getBoundingClientRect().top,
      }
    })
  const natural = await measure()
  assert.equal(natural.overflow, 0)
  // Closing must not wait for an opacity transition or a timeout.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const leaves = () =>
    page.evaluate(() => window.proof.calls.filter((call) => call[0] === 'leavePanel').length)
  await page.mouse.move(5, 5)
  const before = await leaves()
  await page.mouse.move(450, 1100)
  assert.equal(await leaves(), before + 1)
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(await leaves(), before + 2, 'native pointer fallback also closes without a timer')
  await page.evaluate(() => {
    document
      .querySelector('header')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  })
  await page.getByTitle(/Pinned open/).waitFor()
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(await leaves(), before + 2, 'double-click pins immediately, even with frozen timers')
  assert.equal(await expandedList.getAttribute('data-thread-view'), 'recent')
  await page.evaluate(() => {
    document
      .querySelector('header')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 3 }))
  })
  assert.equal(await page.getByTitle(/Pinned open/).count(), 1, 'the third click has no action')
  await page.evaluate(() => {
    document
      .querySelector('header')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  })
  await page.getByTitle(/Pinned open/).waitFor({ state: 'detached' })
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  await page.clock.runFor(300)
  assert.equal(
    await page.getByTitle(/Pinned open/).count(),
    0,
    'unpinning leaves no delayed toggle',
  )
  assert.equal(await leaves(), before + 3, 'unpinning restores pointer-leave behavior')
  assert.equal(await expandedList.getAttribute('data-thread-view'), 'recent')
  await page.clock.resume()
  for (const opensDown of [true, false]) {
    const limit = Math.floor(natural.height - 35)
    await page.evaluate((layout) => window.proof.emit('onPanelOpened', layout), {
      maxHeight: limit,
      opensDown,
      fresh: false,
    })
    await page.waitForFunction(
      (height) => document.querySelector('[data-card]').getBoundingClientRect().height === height,
      limit,
    )
    const constrained = await measure()
    assert.ok(constrained.overflow > 0, 'scroll only when the list exceeds available room')
    assert.ok(constrained.listBottom <= constrained.footerTop + 0.5, 'usage bars reserve room')
    await page.evaluate((layout) => window.proof.emit('onPanelOpened', layout), {
      maxHeight: natural.height + 20,
      opensDown,
      fresh: false,
    })
    await page.waitForFunction(
      (height) => document.querySelector('[data-card]').getBoundingClientRect().height === height,
      natural.height,
    )
    assert.equal((await measure()).overflow, 0, 'extra room removes the scrollbar')
    assert.equal(await expandedList.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('[data-session-id]').count(), 19)
  }
  await page.setViewportSize({ width: 460, height: 900 })
  await page.reload()
  console.log('PASS: panel grows/shrinks without resetting its list; borders and usage bars fit.')
}
