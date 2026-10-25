/* global window, document, getComputedStyle */
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
  const expandedList = page.locator('header button[aria-haspopup="menu"]')
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
