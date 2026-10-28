import { openHeaderPage } from './header-navigation.mjs'
/* global window, document, AudioContext */
import assert from 'node:assert/strict'
import { checkVoiceTarget } from './voice-target.smoke.mjs'

/** Uses the provider smoke test's generated audio stream; never opens a real microphone. */
export async function checkVoiceRouting(page) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      voiceMode: 'local-stt',
      voiceTarget: 'agent',
      talkMode: 'toggle',
    }),
  )
  await page.evaluate(() => {
    // Calibrate against processed quiet audio, rather than a wall-clock delay that can
    // expire before Chromium delivers its first audio buffers on a busy machine.
    const createProcessor = AudioContext.prototype.createScriptProcessor
    window.proof.createProcessor = createProcessor
    AudioContext.prototype.createScriptProcessor = function (...args) {
      const processor = createProcessor.apply(this, args)
      window.proof.audioProcessor = processor
      window.proof.quietAudioMs = 0
      window.proof.voicedAudioMs = 0
      processor.addEventListener('audioprocess', (event) => {
        if (window.proof.audioProcessor !== processor) return
        const frame = event.inputBuffer.getChannelData(0)
        if (frame.every((sample) => Math.abs(sample) < 0.001))
          window.proof.quietAudioMs += (frame.length / this.sampleRate) * 1000
        else window.proof.voicedAudioMs += (frame.length / this.sampleRate) * 1000
      })
      return processor
    }
    window.proof.nativePeer = window.RTCPeerConnection
    window.proof.livePeers = []
    window.RTCPeerConnection = class {
      connectionState = 'new'
      channel = { readyState: 'connecting' }
      constructor() {
        window.proof.livePeers.push(this)
      }
      addTrack(_track, stream) {
        this.stream = stream
        this.context = new AudioContext()
        this.analyser = this.context.createAnalyser()
        this.context.createMediaStreamSource(stream).connect(this.analyser)
      }
      createDataChannel() {
        return this.channel
      }
      async createOffer() {
        return { type: 'offer', sdp: 'v=0\r\nsynthetic' }
      }
      async setLocalDescription(value) {
        this.localDescription = value
      }
      async setRemoteDescription() {
        this.connectionState = 'connected'
        this.channel.readyState = 'open'
        this.channel.onmessage?.({ data: JSON.stringify({ type: 'session.started' }) })
      }
      close() {
        this.connectionState = 'closed'
        void this.context?.close()
      }
    }
    window.threadlight.agentLiveStart = async (id) => {
      window.proof.calls.push(['liveStart', id])
      if (window.proof.liveFailure) return { ok: false, reason: window.proof.liveFailure }
      if (window.proof.holdLive)
        await new Promise((resolve) => {
          window.proof.connectLive = resolve
        })
      return { ok: true, sdp: 'v=0\r\nanswer' }
    }
    window.threadlight.agentLiveOpen = async (id, text) => {
      window.proof.calls.push(['liveOpen', id, text])
      window.proof.livePeers.at(-1).channel.onmessage?.({
        data: JSON.stringify({ type: 'turn.created' }),
      })
      return { ok: true }
    }
    window.threadlight.agentLiveStop = (id) => window.proof.calls.push(['liveStop', id])
  })
  const agentSends = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentSend'))
  const open = async () => {
    await page.evaluate(() => {
      window.proof.quietAudioMs = 0
      window.proof.emit('onTalkToggle')
    })
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
    await page.waitForFunction(() => window.proof.quietAudioMs >= 650)
  }
  const close = async () => {
    await page.evaluate(() => window.proof.emit('onTalkToggle'))
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  }
  const say = async (text, level = 0.18) => {
    await page.evaluate((volume) => {
      delete window.proof.finishTranscript
      window.proof.voicedAudioMs = 0
      window.proof.setAudioLevel(volume)
    }, level)
    // Start the utterance duration after the real audio callback has detected the tone.
    // Browser/GPU startup can otherwise consume most of a short synthetic utterance.
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'hearing')
    await page.waitForFunction(() => window.proof.voicedAudioMs >= 350)
    await page.evaluate(() => window.proof.setAudioLevel(0))
    await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
    await page.evaluate((words) => window.proof.finishTranscript(words), text)
    await page.waitForFunction(() =>
      ['listening', 'off'].includes(document.documentElement.dataset.openMic),
    )
  }

  const before = (await agentSends()).length
  await open()
  await say('Open.', 0.049) // quiet speech must reach transcription, not just loud test tones
  await page.locator('[data-mic-mode="commands"]').waitFor()
  await page.locator('[data-card][data-pinned]').waitFor()
  await say('Please check the build')
  await page
    .getByText(
      'No thread matched “Please check the build”. Say the title shown in the list, or click the thread.',
      { exact: true },
    )
    .waitFor()
  await say('agent')
  assert.equal((await agentSends()).length, before)

  const codexRow = page.locator(
    '[data-session-id="codex:11111111-1111-4111-8111-111111111111"] button[aria-expanded]',
  )
  await say('Synthetic Codex')
  assert.equal(await page.getByText(/^No thread matched/).count(), 0)
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
  await page.evaluate(() => window.proof.patch({ title: 'Review Threadlight' }))
  await codexRow.getByText('Review Threadlight', { exact: true }).waitFor()
  // A misheard first title must not choose the Agent, even with its view already open.
  for (const fromAgent of [false, true]) {
    if (fromAgent) await openHeaderPage(page, 'Agent')
    await open()
    await say('Open review thread lines.')
    await page.locator('[data-mic-mode="commands"]').waitFor()
    await page
      .getByText(
        'No thread matched “Open review thread lines.”. Say the title shown in the list, or click the thread.',
        { exact: true },
      )
      .waitFor()
    assert.equal(await codexRow.isVisible(), true)
    assert.equal((await agentSends()).length, before)
    await say('Open review thread light.')
    assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
    assert.equal((await agentSends()).length, before)
    await close()
  }
  await open()
  await say('Open review thread light.')
  await page.locator('[data-mic-mode="commands"]').waitFor()
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal((await agentSends()).length, before)
  await codexRow.click()
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'false')
  await say('review thread light')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  await close()
  await page.evaluate(() => window.proof.patch({ title: 'Synthetic Codex' }))

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

  await page.evaluate(() => window.threadlight.updateSettings({ agentProvider: 'codex' }))

  // Codex with Local STT must still send text, without opening any native peer.
  await page.evaluate(() =>
    window.proof.agent({ provider: 'codex', status: 'ready', ended: false, live: null }),
  )
  const peersBefore = await page.evaluate(() => window.proof.livePeers.length)
  await open()
  await say('Please review the plan locally.')
  await page.waitForFunction(() =>
    window.proof.calls.some(
      (c) => c[0] === 'agentSend' && c[1] === 'Please review the plan locally.',
    ),
  )
  await page.getByText('Local STT · Listening; text goes to the Agent', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.proof.livePeers.length), peersBefore)
  await close()

  // GPT Live ignores the local destination/hold preference and needs no STT model.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      voiceMode: 'gpt-live',
      voiceTarget: 'thread',
      talkMode: 'hold',
    })
    window.proof.agent({ provider: 'codex', status: 'ready', ended: false, live: null })
    window.proof.emit('onStt', { state: 'missing' })
    delete window.proof.finishTranscript
    window.proof.holdLive = true
    delete window.proof.connectLive
  })
  const sendsBeforeLive = (await agentSends()).length
  await open()
  await page
    .getByText('Connecting GPT Live · Speak now; your audio is buffered', { exact: true })
    .waitFor()
  await page.waitForFunction(() => typeof window.proof.connectLive === 'function')
  // Speak while setup is blocked, then stop before releasing the connection.
  await page.evaluate(() => {
    window.proof.voicedAudioMs = 0
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForFunction(() => window.proof.voicedAudioMs >= 500)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => {
    const analyser = window.proof.livePeers.at(-1).analyser
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return samples.every((value) => Math.abs(value) < 0.001)
  })
  await page.evaluate(() => {
    window.proof.holdLive = false
    window.proof.connectLive()
  })
  await page
    .getByText('Live · Speak naturally; press the hotkey to finish', { exact: true })
    .waitFor()
  await page.waitForFunction(() => {
    const analyser = window.proof.livePeers.at(-1).analyser
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return samples.some((value) => Math.abs(value) > 0.01)
  })
  await page.evaluate(() => window.proof.setAudioLevel(0))
  assert.equal(await page.evaluate(() => typeof window.proof.finishTranscript), 'undefined')
  assert.equal((await agentSends()).length, sendsBeforeLive)
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').length),
    0,
  )
  // Changing mode releases the active transport, without ending the Agent conversation.
  await page.evaluate(() => window.threadlight.updateSettings({ voiceMode: 'local-stt' }))
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  assert.equal(await page.evaluate(() => window.proof.livePeers.at(-1).connectionState), 'closed')

  // No fallback or delayed connection after switching away during setup.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'gpt-live' })
    window.proof.holdLive = true
    delete window.proof.connectLive
    window.proof.emit('onTalkToggle')
  })
  await page.waitForFunction(() => typeof window.proof.connectLive === 'function')
  await page
    .getByText('Connecting GPT Live · Speak now; your audio is buffered', { exact: true })
    .waitFor()
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'local-stt' })
    window.proof.holdLive = false
    window.proof.connectLive()
  })
  await page.waitForFunction(() => window.proof.livePeers.at(-1).connectionState === 'closed')
  assert.equal((await agentSends()).length, sendsBeforeLive)

  // Runtime startup must not wait for the operating system to grant the microphone.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'gpt-live' })
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.proof.savedBufferedAcquire = acquire
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (options) => {
        await new Promise((resolve) => {
          window.proof.allowBufferedMic = resolve
        })
        return acquire(options)
      },
    })
    window.proof.holdLive = true
    delete window.proof.connectLive
    window.proof.emit('onTalkToggle')
  })
  await page.waitForFunction(
    () =>
      typeof window.proof.connectLive === 'function' &&
      typeof window.proof.allowBufferedMic === 'function',
  )
  await page.getByText('Opening microphone and connecting GPT Live…', { exact: true }).waitFor()
  const stoppedBeforeLateMic = await page.evaluate(() => window.proof.stoppedTracks)
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'local-stt' })
    window.proof.holdLive = false
    window.proof.connectLive()
    window.proof.allowBufferedMic()
  })
  await page.waitForFunction((n) => window.proof.stoppedTracks > n, stoppedBeforeLateMic)
  assert.equal(await page.evaluate(() => window.proof.livePeers.at(-1).connectionState), 'closed')
  await page.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: window.proof.savedBufferedAcquire,
    }),
  )

  // A native failure stays a native failure and releases the microphone.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'gpt-live' })
    window.proof.liveFailure = 'Synthetic Live unavailable'
    window.proof.emit('onTalkToggle')
  })
  await page
    .getByLabel('Live voice error')
    .getByText('Synthetic Live unavailable', { exact: true })
    .waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  assert.equal((await agentSends()).length, sendsBeforeLive)
  await page.evaluate(async () => {
    window.proof.liveFailure = null
    window.proof.agent({ provider: 'claude', status: 'ready', ended: false, live: null })
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    )
    window.proof.emit('onTalkToggle')
  })
  await page
    .getByText(
      'GPT Live requires a Codex Agent conversation. Choose Codex in Agent settings; end an existing Claude conversation first.',
      { exact: true },
    )
    .first()
    .waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.openMic), 'off')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      voiceMode: 'local-stt',
      voiceTarget: 'agent',
      talkMode: 'toggle',
    })
    window.proof.emit('onStt', { state: 'ready' })
  })
  // Closing while transcription is pending cannot leak a command or agent request.
  await open()
  await page.evaluate(() => {
    delete window.proof.finishTranscript
    window.proof.voicedAudioMs = 0
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForFunction(() => window.proof.voicedAudioMs >= 350)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await close()
  const count = (await agentSends()).length
  await page.evaluate(() => window.proof.finishTranscript('Do not send this'))
  await page.waitForTimeout(150)
  assert.equal((await agentSends()).length, count)
  await page.evaluate(() => {
    // Keep the synthetic peer for target/activation coverage below.
  })
  await checkVoiceTarget(page)
  await page.evaluate(() => {
    window.RTCPeerConnection = window.proof.nativePeer
    AudioContext.prototype.createScriptProcessor = window.proof.createProcessor
  })
  await page.evaluate(() => window.proof.agent({ status: 'idle', provider: null, items: [] }))
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
}
