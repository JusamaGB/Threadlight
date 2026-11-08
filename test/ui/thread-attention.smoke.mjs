/* global window, document */
import assert from 'node:assert/strict'
import { selectThreadView } from './header-navigation.mjs'

export async function checkThreadAttention(page, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ enabledProviders: ['codex'], panelLayout: 'single' })
    await window.proof.patch({ state: 'working', attention: null, plan: [], planText: null })
    window.threadlight.threadTimeline = async ({ threadId }) => ({
      ok: true,
      timeline: {
        threadId,
        revision: 1,
        connection: 'live',
        hasMore: false,
        loadingOlder: false,
        items: Array.from({ length: 30 }, (_, i) => ({
          id: 'earlier-' + i,
          role: 'assistant',
          kind: 'message',
          phase: 'final',
          complete: true,
          text: 'Earlier reply ' + i,
          turnId: 'turn-' + i,
          at: null,
          source: 'codex_stream',
        })),
      },
    })
  })
  await selectThreadView(page, 'active')
  const row = page.locator('[data-session-id^="codex:"]').first()
  const toggle = row.getByRole('button', { name: /Synthetic Codex/ }).first()
  await toggle.click()
  const conversation = row.getByLabel('Codex conversation', { exact: true })
  const history = conversation.getByRole('region', { name: 'Conversation history' })
  const last = history.getByText('Earlier reply 29', { exact: true })
  await last.waitFor()
  const normal = (await conversation.boundingBox()).height
  await page.evaluate(() =>
    window.proof.patch({
      state: 'waiting',
      attention: {
        kind: 'next-step',
        recap: null,
        ask: 'Shall we run the checks?',
        actions: [],
        holdId: 'test-hold',
        answerableUntil: Date.now() + 60000,
      },
    }),
  )
  const card = history.locator('[data-pending-card]')
  await card.getByText('Shall we run the checks?', { exact: true }).waitFor()
  const atCard = async () => {
    await page.waitForFunction(() => {
      const s = document.querySelector('[aria-label="Conversation history"]')
      return s && s.scrollHeight - s.clientHeight - s.scrollTop < 2
    })
    assert.ok(
      (await last.boundingBox()).y + (await last.boundingBox()).height <=
        (await history.boundingBox()).y + 2,
    )
    assert.ok((await conversation.boundingBox()).height <= normal + 1)
    assert.equal(await row.locator('[data-pending-card]').count(), 1)
    const composer = conversation.getByRole('group', { name: 'Codex message composer' }).last()
    assert.ok(
      (await card.boundingBox()).y + (await card.boundingBox()).height <=
        (await composer.boundingBox()).y + 1,
    )
  }
  await atCard()
  await capture('smart-thread-attention-live')
  const initialHeight = (await history.boundingBox()).height
  await history.hover({ position: { x: 12, y: 10 } })
  await page.mouse.wheel(0, -52)
  await conversation.getByRole('button', { name: /Jump to live/ }).waitFor()
  await page.waitForFunction(() => {
    const el = document.querySelector('[aria-label="Conversation history"]')
    return el.scrollHeight - el.clientHeight - el.scrollTop > 5
  })
  const previous = await last.boundingBox(),
    currentCard = await card.boundingBox(),
    viewport = await history.boundingBox()
  assert.ok(Math.abs(viewport.height - initialHeight) <= 1, 'first scroll keeps the reader height')
  assert.ok(
    previous.y + previous.height > viewport.y + 5 &&
      previous.y + previous.height <= currentCard.y + 1,
    'the preceding text enters on the first scroll',
  )
  assert.ok(
    currentCard.y - previous.y - previous.height < 12,
    'no spacer between the text and the card',
  )
  await capture('smart-thread-attention-first-scroll')
  const reading = await history.evaluate((el) => el.scrollTop)
  await toggle.click()
  await toggle.click()
  await atCard()
  assert.ok((await history.evaluate((el) => el.scrollTop)) > reading)
  await page.evaluate(() => window.proof.patch({ state: 'working', attention: null }))
  await card.waitFor({ state: 'detached' })
  assert.equal(await history.count(), 1)
}
