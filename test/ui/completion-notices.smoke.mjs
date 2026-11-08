import { openHeaderPage, selectThreadView } from './header-navigation.mjs'
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'

export async function checkCompletionNotices(page, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'single',
    })
    await window.proof.patch({
      state: 'working',
      attention: null,
      compacting: false,
      lastReply: null,
      stage: 'Working',
      contextUsed: 0.4,
    })
  })
  const row = page.locator('[data-session-id^="codex:"]').first()
  const toggle = () => row.getByRole('button', { name: /Synthetic Codex/ }).first()
  const dot = () => row.locator('svg[data-unread] circle[class*="unreadDot"]')
  await row.waitFor()
  assert.equal(await dot().count(), 0)
  await page.evaluate(() =>
    window.proof.patch({
      state: 'idle',
      stage: 'New finished reply',
      lastReply: 'New finished reply',
      lastActiveAt: Date.now() - 60_000,
    }),
  )
  await dot().waitFor()
  assert.equal(await row.locator('svg[data-active]').count(), 0, 'finished ring is stationary')
  const geometry = await dot().evaluate((element) => {
    const svg = element.closest('svg')
    return {
      cx: Number(element.getAttribute('cx')),
      cy: Number(element.getAttribute('cy')),
      size: Number(svg.getAttribute('width')),
      colour: getComputedStyle(element).fill,
    }
  })
  assert.equal(geometry.cx, geometry.size / 2)
  assert.equal(geometry.cy, geometry.size / 2)
  assert.equal(
    geometry.colour,
    await row.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      element.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }),
  )
  await page.clock.fastForward(35_000)
  await dot().waitFor()
  await capture('unread-finished-thread')
  const activeCount = async () => page.locator('header [data-thread-view="active"]').innerText()
  const beforeExpiry = await activeCount()
  // The reply is already 95 seconds old. Keep it through 9m35s, then cross ten minutes.
  await page.clock.fastForward(8 * 60_000)
  await dot().waitFor()
  assert.equal(await activeCount(), beforeExpiry, 'unread replies stay Active before ten minutes')
  await page.clock.fastForward(30_000)
  await row.waitFor({ state: 'detached' })
  assert.notEqual(
    await activeCount(),
    beforeExpiry,
    'expired unread replies leave the Active count',
  )
  await selectThreadView(page, 'recent')
  await dot().waitFor()
  await capture('expired-unread-in-recent')
  await page.reload()
  await row.waitFor({ state: 'detached' })
  await selectThreadView(page, 'recent')
  await dot().waitFor()
  await toggle().click()
  await dot().waitFor({ state: 'detached' })
  assert.equal(
    await toggle().getAttribute('aria-expanded'),
    'true',
    'opening clears the dot without removing the row being read',
  )
  await capture('read-finished-thread')
  await toggle().click()
  await selectThreadView(page, 'active')
  await row.waitFor({ state: 'detached' })

  // A completion behind another page must remain unread until the thread becomes visible.
  await page.evaluate(() => window.proof.patch({ state: 'working', stage: 'Working again' }))
  await row.waitFor()
  await toggle().click()
  await openHeaderPage(page, 'Agent')
  await page.evaluate(() =>
    window.proof.patch({
      state: 'idle',
      lastReply: 'Finished behind the Agent',
      stage: 'Finished behind the Agent',
    }),
  )
  assert.equal(await row.getAttribute('data-unread'), 'true')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await dot().waitFor({ state: 'detached' })
  assert.equal(await toggle().getAttribute('aria-expanded'), 'true')
  await toggle().click()
  await page.evaluate(() =>
    window.proof.patch({
      state: 'waiting',
      stage: 'Waiting for you',
      attention: {
        kind: 'next-step',
        recap: null,
        ask: 'Continue?',
        actions: [],
        answerableUntil: null,
      },
    }),
  )
  await row.waitFor()
  assert.equal(await dot().count(), 0, 'waiting keeps its amber indicator')
  assert.equal(await row.locator('[data-state="waiting"][data-attention]').count(), 1)
  console.log(
    'PASS: centered blue unread dot, ten-minute Active expiry and count, Recent/reload persistence, open-to-read, hidden page protection and amber waiting state',
  )
}
