/* global window, document */
import assert from 'node:assert/strict'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkAgentDecision(page, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ agentProvider: 'codex' })
    const original = window.threadlight.communicationRequest
    window.proof.decisionCards = []
    window.threadlight.communicationRequest = async (input) => {
      if (input.action === 'conversation_feed')
        return {
          ok: true,
          value: { owner: input.arguments.owner, cards: window.proof.decisionCards, cursor: 1 },
        }
      if (input.action === 'conversation_answer') {
        window.proof.calls.push(['decision', input.arguments.response])
        window.proof.decisionCards = []
        window.proof.emit('onCommunication')
        return { ok: true }
      }
      return original(input)
    }
    window.proof.agent({
      provider: 'codex',
      conversationId: 'codex:decision-fixture',
      status: 'ready',
      requests: [],
      items: Array.from({ length: 24 }, (_, i) => ({
        id: `decision-line-${i}`,
        kind: 'agent',
        text: `Earlier conversation line ${i}. Preserve the pending request while replies arrive.`,
      })),
    })
  })
  await openHeaderPage(page, 'Agent')
  for (const provider of ['Perplexity', 'Claude Code']) {
    const log = page.locator('[data-agent-conversation] [class*="_agentLog_"]')
    await log.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      el.dispatchEvent(new Event('scroll'))
    })
    await page.evaluate((provider) => {
      window.proof.decisionCards = [
        {
          id: 'provider-approval',
          revision: 1,
          kind: 'native',
          source: 'codex:decision-fixture',
          state: 'pending',
          title: `Start ${provider} chat`,
          body: 'Pending human decision',
          anchor: 'decision-line-8',
          request: {
            id: 'provider-request',
            generation: 'fixture',
            target: 'codex:decision-fixture',
            kind: 'approval',
            nativeKind: 'approval',
            title: `Start ${provider} chat`,
            detail:
              'Space: Provider Chat Acceptance\nRole: Acceptance Research\n\nOpening message:\nReply with exactly TL-OPEN-🙂',
            startedAt: Date.now(),
            expiresAt: Date.now() + 60000,
            canAllow: true,
          },
        },
      ]
      window.proof.emit('onCommunication')
    }, provider)
    const card = page.locator('[data-card-id="provider-approval"]')
    await card.waitFor()
    const request = card.locator('[data-agent-request]')
    await request.getByText(`Start ${provider} chat`, { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Needs input', exact: true }).click()
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-card-id="provider-approval"]')
      const log = card.closest('[class*="_agentLog_"]')
      const bounds = card.getBoundingClientRect()
      const reader = log.getBoundingClientRect()
      return (
        Math.abs(bounds.top - reader.top) < 3 ||
        (log.scrollHeight - log.clientHeight - log.scrollTop < 3 &&
          bounds.top >= reader.top &&
          bounds.bottom <= reader.bottom + 1)
      )
    })
    const details = request.getByLabel('Request details', { exact: true })
    assert.ok((await details.innerText()).includes('Space: Provider Chat Acceptance'))
    assert.ok((await details.innerText()).includes('Role: Acceptance Research'))
    assert.ok((await details.innerText()).includes('TL-OPEN-🙂'))
    const allow = await request
      .getByRole('button', { name: 'Allow once', exact: true })
      .boundingBox()
    const deny = await request.getByRole('button', { name: 'Deny', exact: true }).boundingBox()
    assert.equal(allow.y, deny.y, 'content-sized approval controls share one row')
    const bounds = await log.boundingBox()
    assert.ok(allow.y + allow.height <= bounds.y + bounds.height, 'the decision stays visible')
    await capture(`agent-provider-decision-${provider.replaceAll(' ', '-')}`)
    await page.evaluate(() =>
      window.proof.agent({
        items: Array.from({ length: 36 }, (_, i) => ({
          id: `decision-line-${i}`,
          kind: 'agent',
          text: `Conversation line ${i}; the pending card remains readable.`,
        })),
      }),
    )
    const position = await card.boundingBox()
    assert.ok(position.y >= bounds.y - 3, 'later commentary does not hide the pending heading')
    await details.focus()
    assert.equal(await details.evaluate((el) => el === document.activeElement), true)
    await request
      .getByRole('button', { name: provider === 'Perplexity' ? 'Allow once' : 'Deny', exact: true })
      .click()
    await card.waitFor({ state: 'detached' })
    assert.deepEqual(
      await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'decision').at(-1)[1]),
      {
        action: provider === 'Perplexity' ? 'allow' : 'deny',
      },
    )
  }
  await page.setViewportSize({ width: 252, height: 460 })
  await page.evaluate(() => {
    const source = 'codex:decision-fixture'
    window.proof.agent({ sessionId: 'decision-fixture' })
    window.proof.decisionCards = [
      {
        id: 'colour',
        kind: 'native',
        state: 'pending',
        source,
        title: source,
        body: '',
        at: Date.now(),
        revision: 1,
        generation: 'colour',
        speech: 'announced',
        request: {
          id: 'colour',
          generation: 'colour',
          target: source,
          title: 'Codex needs your input',
          kind: 'question',
          nativeKind: 'questions',
          questions: [
            {
              id: 'colour',
              question: 'Which colour do you want?',
              other: true,
              options: [{ label: 'Red' }, { label: 'Blue' }],
            },
          ],
        },
      },
    ]
    window.proof.emit('onCommunication')
  })
  const question = page.locator('[data-card-id="colour"]')
  await question.getByRole('radio', { name: 'Red' }).waitFor()
  assert.equal(await question.getByText('Codex', { exact: true }).count(), 1)
  assert.equal(await question.getByText('Needs you', { exact: true }).count(), 1)
  assert.equal(await question.getByText('codex:decision-fixture', { exact: true }).count(), 0)
  assert.equal(await question.locator('details').count(), 0)
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Needs input'),
  )
  assert.equal(await question.evaluate((el) => window.getComputedStyle(el).borderLeftWidth), '0px')
  const answer = question.getByPlaceholder('Your answer…')
  const frame = await question.locator('[data-agent-request]').boundingBox()
  const field = await answer.boundingBox()
  const left = field.x - frame.x,
    right = frame.x + frame.width - field.x - field.width
  assert.ok(Math.abs(left - right) < 2 && left >= 8, JSON.stringify({ left, right }))
  await question.getByRole('button', { name: 'Submit' }).scrollIntoViewIfNeeded()
  await capture('agent-colour-question')
  await question.getByRole('radio', { name: 'Blue' }).check()
  await question.getByRole('button', { name: 'Submit' }).click()
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'decision').at(-1)[1]),
    { action: 'answer', answers: { colour: 'Blue' } },
  )
  console.log(
    'PASS: named provider decision summaries, compact controls, keyboard-readable details and visible pending cards across later Agent replies; no provider sends.',
  )
}
