/* global window, document */
import assert from 'node:assert/strict'

/** Uses the provider smoke test's generated audio stream; never opens a real microphone. */
export async function checkVoiceRouting(page) {
  const agentSends = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentSend'))
  const open = async () => {
    await page.evaluate(() => window.proof.emit('onTalkToggle'))
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
    await page.waitForTimeout(650) // allow the real segmenter to learn the synthetic quiet room
  }
  const close = async () => {
    await page.evaluate(() => window.proof.emit('onTalkToggle'))
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  }
  const say = async (text) => {
    await page.evaluate(() => {
      delete window.proof.finishTranscript
      window.proof.setAudioLevel(0.18)
    })
    await page.waitForTimeout(350)
    await page.evaluate(() => window.proof.setAudioLevel(0))
    await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
    await page.evaluate((words) => window.proof.finishTranscript(words), text)
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
  }

  const before = (await agentSends()).length
  await open()
  await say('Open.')
  await page.locator('[data-mic-mode="commands"]').waitFor()
  await page
    .getByTitle('Pinned open. Click (or triple-click the bar) to unpin', { exact: true })
    .waitFor()
  await say('Please check the build')
  await say('agent')
  assert.equal((await agentSends()).length, before)

  const codexRow = page.locator(
    '[data-session-id="codex:11111111-1111-4111-8111-111111111111"] button[aria-expanded]',
  )
  await say('Synthetic Codex')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal(await codexRow.evaluate((node) => node === document.activeElement), true)
  await say('open Synthetic Codex')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal((await agentSends()).length, before)

  // Composer dictation stays dictation even while command mode is latched.
  await page.getByRole('button', { name: 'Talk', exact: true }).click()
  await page.evaluate(() => {
    delete window.proof.finishTranscript
  })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('Composer words'))
  await page.waitForFunction(() =>
    document
      .querySelector('textarea[placeholder="Type a message…"]')
      ?.value.includes('Composer words'),
  )
  await page.locator('[data-mic-mode="commands"]').waitFor()
  assert.equal((await agentSends()).length, before)
  await close()

  // A single utterance also chooses commands from a fresh session.
  await open()
  await say('Open Synthetic Codex.')
  await page.locator('[data-mic-mode="commands"]').waitFor()
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal((await agentSends()).length, before)
  await close()

  // Names from both providers can be ambiguous; disambiguation never sends a message.
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await open()
  await say('Open Synthetic')
  await page.getByText(/^Several threads match:/).waitFor()
  await page.locator('[data-mic-mode="commands"]').waitFor()
  await say('Synthetic Claude')
  const claudeRow = page.locator('[data-session-id="synthetic-claude"] button[aria-expanded]')
  assert.equal(await claudeRow.getAttribute('aria-expanded'), 'true')
  await say('Synthetic Codex')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal(await claudeRow.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.getByText(/^Several threads match:/).count(), 0)
  assert.equal((await agentSends()).length, before)
  await close()
  await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['codex'] }))

  // A fresh mic session chooses the agent and sends on a pause without closing the mic.
  await open()
  await say('Please review the plan.')
  await page.locator('[data-mic-mode="agent"]').waitFor()
  assert.deepEqual((await agentSends()).slice(before), [['agentSend', 'Please review the plan.']])
  await say('Open.') // once agent mode is chosen, command words are ordinary speech
  const held = page.getByLabel('Unsent agent speech')
  await held.getByText('Open.', { exact: true }).waitFor()
  assert.equal(await held.getByRole('button', { name: 'Send to agent' }).isDisabled(), true)
  await page.evaluate(() => window.proof.agent({ status: 'idle' }))
  await held.getByRole('button', { name: 'Send to agent' }).click()
  await held.waitFor({ state: 'detached' })
  assert.deepEqual((await agentSends()).slice(-1), [['agentSend', 'Open.']])
  await close()

  // Agent errors retain the words and never create a thread-target picker.
  await page.evaluate(() => {
    window.proof.agent({ status: 'idle' })
    window.proof.savedAgentSend = window.threadlight.agentSend
    window.threadlight.agentSend = async () => ({
      ok: false,
      reason: 'Synthetic agent unavailable',
    })
  })
  await open()
  await say('Keep these words for retry.')
  await held.getByText('Keep these words for retry.', { exact: true }).waitFor()
  await held.getByText('Synthetic agent unavailable', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('Click the thread that should get this:', { exact: true }).count(),
    0,
  )
  await held.getByRole('button', { name: 'Discard this' }).click()
  await close()
  await page.evaluate(() => {
    window.threadlight.agentSend = window.proof.savedAgentSend
  })

  // Closing while transcription is pending cannot leak a command or agent request.
  await open()
  await page.evaluate(() => {
    delete window.proof.finishTranscript
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await close()
  const count = (await agentSends()).length
  await page.evaluate(() => window.proof.finishTranscript('Do not send this'))
  await page.waitForTimeout(150)
  assert.equal((await agentSends()).length, count)
  await page.evaluate(() => window.proof.agent({ status: 'idle', provider: null, items: [] }))
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
}
