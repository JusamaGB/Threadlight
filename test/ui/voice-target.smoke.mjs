/* global window, document */
import assert from 'node:assert/strict'

/** Synthetic microphones and provider IPC: no user audio or real Agent requests. */
export async function checkVoiceTarget(page) {
  const settings = (patch) =>
    page.evaluate((value) => window.threadlight.updateSettings(value), patch)
  const calls = () =>
    page.evaluate(() =>
      window.proof.calls.filter((c) => ['liveOpen', 'agentSend', 'send'].includes(c[0])),
    )
  const agent = (provider) =>
    page.evaluate(
      (value) => window.proof.agent({ provider: value, status: 'ready', live: null, ended: false }),
      provider,
    )
  const record = async (mode) => {
    const tracks = await page.evaluate(() => window.proof.stoppedTracks)
    await page.evaluate((value) => {
      delete window.proof.finishTranscript
      window.proof.emit(value === 'hold' ? 'onTalkHold' : 'onTalkToggle', 'down')
    }, mode)
    await page.getByRole('region', { name: 'Voice waveform', exact: true }).waitFor()
    await page.getByText('Microphone on', { exact: true }).waitFor()
    await page.waitForTimeout(260)
    await page.evaluate(
      (value) => window.proof.emit(value === 'hold' ? 'onTalkHold' : 'onTalkToggle', 'up'),
      mode,
    )
    await page.waitForFunction(
      (n) => window.proof.stoppedTracks > n && typeof window.proof.finishTranscript === 'function',
      tracks,
    )
  }
  const transcribe = (text) => page.evaluate((value) => window.proof.finishTranscript(value), text)

  // Agent push-to-talk sends through the normal conversation only after releasing the mic.
  await settings({ voiceTarget: 'agent', talkMode: 'hold' })
  await agent('codex')
  const before = (await calls()).length
  await record('hold')
  assert.equal((await calls()).length, before)
  await transcribe('Please compare these approaches.')
  await page.waitForFunction(() =>
    window.proof.calls.some(
      (c) => c[0] === 'agentSend' && c[1] === 'Please compare these approaches.',
    ),
  )
  assert.equal((await calls()).length, before + 1)
  assert.equal(
    await page.getByText('Click the thread that should get this:', { exact: true }).count(),
    0,
  )
  // Switching target while transcription is pending discards that recording.
  await record('hold')
  const pending = (await calls()).length
  await settings({ voiceTarget: 'thread' })
  await transcribe('Do not redirect this old recording.')
  await page.waitForTimeout(100)
  assert.equal((await calls()).length, pending)
  assert.equal(
    await page.getByText('Click the thread that should get this:', { exact: true }).count(),
    0,
  )

  // Both activation modes prepare a thread message, with no Agent send.
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  for (const talkMode of ['toggle', 'hold']) {
    await settings({ talkMode, voiceTarget: 'thread', voiceHold: true })
    const count = (await calls()).length
    await record(talkMode)
    await transcribe(`message Synthetic Codex, review ${talkMode}`)
    await page.waitForFunction(
      (value) =>
        document.querySelector('textarea[placeholder="Type a message…"]')?.value.includes(value),
      `Review ${talkMode}`,
    )
    assert.equal((await calls()).length, count)
  }

  // A release during asynchronous microphone acquisition cannot leave recording running.
  await settings({ voiceTarget: 'agent', talkMode: 'hold' })
  await agent('codex')
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.proof.savedAcquire = acquire
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: async (options) => {
        await new Promise((resolve) => {
          window.proof.allowMic = resolve
        })
        return acquire(options)
      },
    })
    delete window.proof.finishTranscript
    window.proof.emit('onTalkHold', 'down')
  })
  await page.waitForFunction(() => typeof window.proof.allowMic === 'function')
  await page.evaluate(() => {
    window.proof.emit('onTalkHold', 'up')
    window.proof.allowMic()
  })
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  assert.equal(await page.getByText('Microphone on', { exact: true }).count(), 0)
  await transcribe('A quick released request.')
  await page.waitForFunction(() =>
    window.proof.calls.some((c) => c[0] === 'agentSend' && c[1] === 'A quick released request.'),
  )
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = window.proof.savedAcquire
  })

  // Claude also accepts Agent speech in either mode through local transcription.
  await page.evaluate(() => {
    window.proof.savedAgentSend = window.threadlight.agentSend
    window.threadlight.agentSend = async (text) => {
      window.proof.calls.push(['agentSend', text])
      return { ok: true }
    }
  })
  await settings({ agentProvider: 'claude', voiceTarget: 'agent', talkMode: 'hold' })
  await agent('claude')
  await record('hold')
  await transcribe('Please check the first approach.')
  await page.waitForFunction(() =>
    window.proof.calls.some(
      (c) => c[0] === 'agentSend' && c[1] === 'Please check the first approach.',
    ),
  )
  await settings({ talkMode: 'toggle' })
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
  await page.waitForTimeout(650)
  await page.evaluate(() => {
    delete window.proof.finishTranscript
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await transcribe('Please check the other approach.')
  await page.waitForFunction(() =>
    window.proof.calls.some(
      (c) => c[0] === 'agentSend' && c[1] === 'Please check the other approach.',
    ),
  )
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  await page.evaluate(() => {
    window.threadlight.agentSend = window.proof.savedAgentSend
  })
  await settings({
    voiceTarget: 'agent',
    talkMode: 'toggle',
    agentProvider: 'claude',
    voiceHold: false,
  })
}
