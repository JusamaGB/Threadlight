/* global window */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { checkAnswerComposer } from './question-composer.smoke.mjs'

export async function checkNativeCodexQuestions(page, capture) {
  const reference = {
    turnId: '22222222-2222-4222-8222-222222222222',
    itemId: 'call_native_ui',
    generation: 'a'.repeat(64),
  }
  const { IgnoredInput } = createRequire(import.meta.url)('../../src/main/ignoredInput.ts')
  const ignored = new IgnoredInput()
  await page.exposeFunction('dismissFixtureQuestion', (session, ref) =>
    ignored.dismiss(session, ref),
  )
  await page.exposeFunction('applyQuestionDismissals', (snapshot) => ignored.annotate(snapshot))
  await page.evaluate(async (reference) => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      listMode: 'recent',
    })
    window.threadlight.answerNativeCodexQuestion = async (...args) => {
      window.proof.calls.push(['native-answer', ...args])
      return new Promise((resolve) => {
        window.proof.finishNative = resolve
      })
    }
    window.threadlight.dismissCodexQuestion = async (id, ref) => {
      const snapshot = await window.threadlight.getSnapshot()
      const session = snapshot.sessions.find((s) => s.id === id)
      const ok = await window.dismissFixtureQuestion(session, ref)
      window.proof.emit('onSnapshot', await window.applyQuestionDismissals(snapshot))
      return ok
    }
    await window.proof.patch({
      state: 'waiting',
      plan: [],
      attention: {
        kind: 'question',
        answerableUntil: null,
        nativeCodex: reference,
        questions: [
          {
            header: 'Sample',
            question: 'Which sample?',
            multiSelect: false,
            options: [
              { label: 'Blue sample', description: '', recommended: false },
              { label: 'Green sample', description: '', recommended: false },
            ],
          },
        ],
      },
    })
  }, reference)
  const row = page.locator('[data-session-id^="codex:"]').first()
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  const card = page.getByRole('region', { name: 'Codex question', exact: true })
  await card.getByRole('button', { name: 'Send answer', exact: true }).waitFor()
  await checkAnswerComposer(page, card, 'Answer for this Codex question', capture)
  assert.equal(await card.getByRole('button', { name: /Open|Copy/ }).count(), 0)
  await card.getByRole('radio').nth(1).check()
  await capture('native-codex-send')
  await card.getByRole('button', { name: 'Send answer', exact: true }).click()
  assert.equal(await card.getByRole('button', { name: 'Sending…', exact: true }).isDisabled(), true)
  const calls = await page.evaluate(() =>
    window.proof.calls.filter((c) => c[0] === 'native-answer'),
  )
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(2), [reference, ['Green sample']])
  await page.evaluate(() =>
    window.proof.finishNative({
      ok: false,
      reason: 'Codex is unavailable. Your answer was not sent.',
      retryable: true,
    }),
  )
  await card.getByRole('alert').waitFor()
  assert.equal(await card.getByRole('radio').nth(1).isChecked(), true)
  await card.getByLabel('Answer for this Codex question').fill('A quieter custom sample')
  await card.getByLabel('Answer for this Codex question').press('Control+Enter')
  await page.evaluate(() =>
    window.proof.finishNative({
      ok: false,
      reason: 'Confirmation was lost. Check Codex.',
      retryable: false,
    }),
  )
  await card.getByText('Confirmation was lost. Check Codex.').waitFor()
  assert.equal(
    await card.getByRole('button', { name: 'Send answer', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await card.getByLabel('Answer for this Codex question').inputValue(),
    'A quieter custom sample',
  )
  await capture('native-codex-uncertain')
  await card.getByRole('button', { name: 'Dismiss question in Threadlight' }).click()
  await card.waitFor({ state: 'detached' })
  assert.equal(
    await row.getByRole('button', { name: 'Open ↗', exact: true }).count(),
    1,
    'thread remains expanded',
  )
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  await page.evaluate(async () =>
    window.proof.emit(
      'onSnapshot',
      await window.applyQuestionDismissals(await window.threadlight.getSnapshot()),
    ),
  )
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  assert.equal(await card.count(), 0, 'reopening a dismissed question does not resurrect it')
  await page.evaluate(async () => {
    await window.proof.patch({
      attention: {
        kind: 'question',
        answerableUntil: null,
        nativeCodex: { turnId: '33333333-3333-4333-8333-333333333333', itemId: 'new_native_ui' },
        questions: [
          {
            header: 'Sample',
            question: 'Which sample?',
            multiSelect: false,
            options: [
              { label: 'Blue sample', description: '', recommended: false },
              { label: 'Green sample', description: '', recommended: false },
            ],
          },
        ],
      },
    })
  })
  await card.getByRole('button', { name: 'Send answer', exact: true }).waitFor()
  assert.equal(await card.getByLabel('Answer for this Codex question').inputValue(), '')
  await page.evaluate(() => window.proof.patch({ state: 'working', attention: null }))
  await card.waitFor({ state: 'detached' })
  await page.evaluate(() =>
    window.proof.patch({
      state: 'waiting',
      attention: {
        kind: 'question',
        answerableUntil: null,
        nativeCodex: {
          turnId: '33333333-3333-4333-8333-333333333333',
          itemId: 'next',
          generation: 'b'.repeat(64),
        },
        questions: [
          {
            header: '',
            question: 'Another sample?',
            multiSelect: false,
            options: [{ label: 'Green', description: '', recommended: true }],
          },
        ],
      },
    }),
  )
  await card.getByRole('button', { name: 'Send answer', exact: true }).click()
  await page.evaluate(() => window.proof.finishNative({ ok: true }))
  await card.waitFor({ state: 'detached' })
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => ['open', 'copy'].includes(c[0]))),
    [],
  )
  console.log(
    'PASS: native Send, local X, reopen, provider resolution, fresh generations, draft isolation and uncertain-send protection.',
  )
}
