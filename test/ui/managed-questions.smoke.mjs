/* global window */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function checkManagedQuestions(page, proof, memory, capture, target) {
  const space = memory.execute({
    action: 'create_space',
    operationId: randomUUID(),
    title: 'Decision cards proof',
  })
  const actor = { id: 'decision-proof-agent', kind: 'agent', target, spaceId: space.id }
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      listMode: 'recent',
    })
    await window.proof.patch({ state: 'working', attention: null, stage: 'Working' })
  })
  const ask = (body) =>
    proof.service.execute(
      'ask_question',
      {
        operationId: randomUUID(),
        spaceId: space.id,
        audience: 'human',
        answerDelivery: 'tool',
        allowOther: true,
        body,
        choices: ['Explore ideas', 'Make a plan', 'Start building'],
      },
      actor,
    )
  const q = await ask('Which direction should we take next?')
  const row = page.locator(`[data-session-id="${target}"]`).first()
  await row.getByText('Needs your input', { exact: true }).waitFor()
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  const card = row.getByRole('region', { name: 'Threadlight question' })
  await card.waitFor()
  assert.equal(await card.getByRole('button', { name: 'Send answer' }).isDisabled(), true)
  assert.equal(await card.getByText('Copy & open').count(), 0)
  await card.getByLabel('Your answer').fill('Explore first, then build a small prototype.')
  await capture('managed-question-ready')
  // A lost response must leave an actionable error and retain the operation ID on retry.
  await page.evaluate(() => {
    const real = window.threadlight.communicationRequest
    let fail = true
    window.threadlight.communicationRequest = async (input) => {
      if (input.action === 'answer_request') {
        window.proof.calls.push(['managedAnswer', input.arguments])
        if (fail) {
          fail = false
          throw new Error('Synthetic lost response')
        }
      }
      return real(input)
    }
  })
  await card.getByRole('button', { name: 'Send answer' }).click()
  await card.getByRole('alert').waitFor()
  await card.getByRole('button', { name: 'Send answer' }).click()
  await card.waitFor({ state: 'hidden' })
  const result = await proof.service.execute(
    'read_question',
    { id: q.id, generation: q.generation },
    actor,
  )
  assert.equal(result.state, 'answered')
  assert.equal(result.answer, 'Explore first, then build a small prototype.')
  const attempts = await page.evaluate(() =>
    window.proof.calls.filter((c) => c[0] === 'managedAnswer'),
  )
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[0], attempts[1])
  const next = await ask('Choose an option or dismiss this question.')
  await card.waitFor()
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await card.waitFor({ state: 'hidden' })
  assert.equal(
    (
      await proof.service.execute(
        'read_question',
        { id: next.id, generation: next.generation },
        actor,
      )
    ).state,
    'expired',
  )
  assert.equal(memory.communications.list('message').length, 0)
  assert.equal(
    (
      await page.evaluate(() =>
        window.proof.calls.filter((c) =>
          ['openInClaude', 'copyText', 'sendMessage'].includes(c[0]),
        ),
      )
    ).length,
    0,
  )
  await page.evaluate(() =>
    window.proof.patch({
      attention: {
        kind: 'question',
        answerableUntil: null,
        questions: [
          {
            header: 'Native',
            question: 'Existing native question',
            multiSelect: false,
            options: [{ label: 'Build', description: '', recommended: false }],
          },
        ],
      },
    }),
  )
  await row.getByRole('button', { name: 'Copy & open' }).waitFor()
  console.log(
    'PASS: managed card appears on its exact thread, accepts a typed answer, retries one operation, cancels without a reply, and preserves the native-card fallback.',
  )
}
