/* global window, document */
import assert from 'node:assert/strict'
import { setupVoiceInput } from './voice-input.fixture.mjs'

export async function checkAnswerComposer(page, card, label, capture) {
  const input = card.getByLabel(label, { exact: true })
  const pill = card.locator('[data-composer-input]')
  await pill.waitFor()
  const geometry = await pill.evaluate((element) => {
    const outer = element.parentElement.parentElement.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      left: box.left - outer.left,
      right: outer.right - box.right,
      overflow: element.scrollWidth - element.clientWidth,
    }
  })
  assert.ok(Math.abs(geometry.left - geometry.right) < 1, JSON.stringify(geometry))
  assert.ok(geometry.overflow <= 1, JSON.stringify(geometry))
  await pill.getByRole('button', { name: 'Talk', exact: true }).click()
  await card.getByRole('button', { name: 'Download', exact: true }).waitFor()
  await setupVoiceInput(page)
  await page.evaluate(() => {
    window.threadlight.transcribe = async () => 'spoken answer'
  })
  const deliveries = () =>
    page.evaluate(
      () =>
        window.proof.calls.filter((c) =>
          ['answer', 'native-answer', 'managedAnswer', 'send', 'copy', 'open'].includes(c[0]),
        ).length,
    )
  const before = await deliveries()
  await input.fill('Typed first')
  await pill.getByRole('button', { name: 'Talk', exact: true }).click()
  const stop = pill.getByRole('button', { name: 'Stop and transcribe', exact: true })
  await stop.waitFor()
  assert.equal(
    await pill
      .getByRole('button', { name: /Submit typed answer|Copy answer and open Codex/ })
      .isDisabled(),
    true,
  )
  await input.press('Enter')
  assert.equal(await deliveries(), before)
  await page.waitForTimeout(350)
  await stop.click()
  await page.waitForFunction(
    (label) =>
      Array.from(document.querySelectorAll('textarea')).find(
        (e) => e.getAttribute('aria-label') === label,
      )?.value === 'Typed first spoken answer',
    label,
  )
  assert.equal(await deliveries(), before, 'dictation only updates the answer draft')
  assert.equal(await page.evaluate(() => window.proof.stoppedTracks), 1)
  await input.press('Shift+Enter')
  assert.match(await input.inputValue(), /\n$/)
  await capture('question-composer-' + label.replaceAll(' ', '-'))
  await input.fill('')
}

export async function checkCodexNextStepComposer(page, capture) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      enabledProviders: ['codex'],
      panelLayout: 'single',
      listMode: 'recent',
    }),
  )
  const row = page.locator('[data-session-id^="codex:"]').first()
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  const input = row.getByLabel('Answer for this Codex chat')
  await checkAnswerComposer(page, row, 'Answer for this Codex chat', capture)
  await input.fill('Proceed with the shared composer')
  await input.press('Enter')
  await row.getByText('Answer sent', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'answer').at(-1)?.[3]),
    'Proceed with the shared composer',
  )
  assert.equal(await row.getByRole('button', { name: 'Talk', exact: true }).isDisabled(), true)

  await page.evaluate(() =>
    window.proof.patch({
      attention: {
        kind: 'next-step',
        ask: 'Use the shared composer for the fallback?',
        actions: [],
        recap: null,
        answerableUntil: null,
      },
    }),
  )
  await input.fill('Copy this answer')
  await input.press('Enter')
  assert.deepEqual(
    (await page.evaluate(() => window.proof.calls.slice(-2))).map((c) => c[0]),
    ['copy', 'open'],
  )

  // Closing the card while recording releases its stream; a remount keeps the draft.
  await row.getByRole('button', { name: 'Talk', exact: true }).click()
  await row.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor()
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  await page.waitForFunction(() => window.proof.stoppedTracks === 2)
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  assert.equal(await input.inputValue(), 'Copy this answer')
  await page.evaluate(() => {
    window.threadlight.transcribe = () =>
      new Promise((resolve) => {
        window.proof.finishAnswerTranscript = resolve
      })
  })
  await row.getByRole('button', { name: 'Talk', exact: true }).click()
  await page.waitForTimeout(350)
  await row.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await page.waitForFunction(() => !!window.proof.finishAnswerTranscript)
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  await page.evaluate(() => window.proof.finishAnswerTranscript('stale transcript'))
  await row.getByRole('button', { name: 'Talk', exact: true }).waitFor()
  assert.equal(
    await input.inputValue(),
    'Copy this answer',
    'a transcript from a closed card never lands in the remounted draft',
  )
  console.log(
    'PASS: centred shared question composer, microphone setup, dictation draft, multiline input, explicit delivery, fallback and recording cleanup.',
  )
}
