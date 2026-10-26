/* global window, document, AudioContext */
import assert from 'node:assert/strict'
import { checkVoiceTarget } from './voice-target.smoke.mjs'

/** Uses the provider smoke test's generated audio stream; never opens a real microphone. */
export async function checkVoiceRouting(page) {
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
  await page
    .getByTitle('Pinned open. Click to unpin, or double-click the bar', { exact: true })
    .waitFor()
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
    if (fromAgent)
      await page.getByRole('button', { name: 'Agent: ask it to do something', exact: true }).click()
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

  // A fresh mic session selects native Live and never uses the text-Agent fallback.
  await open()
  await say('Please review the plan.')
  await page.locator('[data-mic-mode="agent"]').waitFor()
  await page
    .getByText('Live · Speak naturally; press the hotkey to finish', { exact: true })
    .waitFor()
  assert.deepEqual(
    await page.evaluate(() =>
      window.proof.calls.filter((c) => c[0] === 'liveOpen').map((c) => c[2]),
    ),
    ['Please review the plan.'],
  )
  assert.equal((await agentSends()).length, before)
  await page.evaluate(() => {
    delete window.proof.finishTranscript
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForFunction(() => {
    const analyser = window.proof.livePeers.at(-1).analyser
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return samples.some((value) => Math.abs(value) > 0.01)
  })
  assert.equal(await page.evaluate(() => typeof window.proof.finishTranscript), 'undefined')
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await close()
  assert.equal(await page.evaluate(() => window.proof.livePeers.at(-1).connectionState), 'closed')

  // A long opening beginning with open selects Live, while setup can lag transcription.
  await page.evaluate(() => {
    window.proof.holdLive = true
  })
  await open()
  const long = 'Open the project and help me understand why all the tests started failing yesterday'
  await say(long)
  await page.getByText('Connecting Live · Keep talking', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').length),
    1,
  )
  await say('This sentence belongs to the same opening.')
  await page.evaluate(() => {
    window.proof.holdLive = false
    window.proof.connectLive()
  })
  await page
    .getByText('Live · Speak naturally; press the hotkey to finish', { exact: true })
    .waitFor()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').at(-1)[2]),
    `${long} This sentence belongs to the same opening.`,
  )
  await close()

  // Native errors retain the opening text, without falling back to a text send.
  await page.evaluate(() => {
    window.proof.liveFailure = 'Synthetic Live unavailable'
  })
  await open()
  await say('Keep these words for retry.')
  const held = page.getByLabel('Live voice error')
  await held.getByText('Keep these words for retry.', { exact: true }).waitFor()
  await held.getByText('Synthetic Live unavailable', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('Click the thread that should get this:', { exact: true }).count(),
    0,
  )
  await held.getByRole('button', { name: 'Copy opening message' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  await page.evaluate(() => {
    window.proof.liveFailure = null
  })

  // Two consistent previews prepare Live before the utterance ends. Only the final text sends.
  const fullOpening =
    'Open the project and help me understand why the microphone routing tests fail after changing the model'
  await page.evaluate((text) => {
    window.proof.savedTranscribe = window.threadlight.transcribe
    window.proof.previewCount = 0
    window.threadlight.transcribe = async () => {
      window.proof.previewCount++
      return window.proof.previewCount <= 2
        ? 'Open the project and help me understand why the microphone routing tests fail'
        : text
    }
  }, fullOpening)
  await open()
  const beforePreview = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'liveStart').length,
  )
  const beforeOpening = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'liveOpen').length,
  )
  await page.evaluate(() => window.proof.setAudioLevel(0.18))
  await page.waitForFunction(
    (n) => window.proof.calls.filter((c) => c[0] === 'liveStart').length > n,
    beforePreview,
  )
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').length),
    beforeOpening,
  )
  assert.equal(await page.locator('[data-mic-mode="commands"]').count(), 0)
  const previewPeak = await page.evaluate(() => {
    const a = window.proof.livePeers.at(-1).analyser,
      samples = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(samples)
    return Math.max(...samples.map(Math.abs))
  })
  assert.ok(previewPeak < 0.001, 'Opening audio must not leak into the preparing Live connection')
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page
    .getByText('Live · Speak naturally; press the hotkey to finish', { exact: true })
    .waitFor()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').at(-1)[2]),
    fullOpening,
  )
  await close()
  await page.evaluate(() => {
    window.threadlight.transcribe = window.proof.savedTranscribe
  })

  // Revised final text can cancel provisional Live preparation and latch commands.
  await page.evaluate(() => {
    window.proof.previewCount = 0
    window.threadlight.transcribe = async () => {
      window.proof.previewCount++
      return window.proof.previewCount <= 2
        ? 'Open the project and help me understand why the microphone routing tests fail'
        : 'Open Synthetic Codex'
    }
  })
  await open()
  const revisedStarts = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'liveStart').length,
  )
  const revisedOpens = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'liveOpen').length,
  )
  await page.evaluate(() => window.proof.setAudioLevel(0.18))
  await page.waitForFunction(
    (n) => window.proof.calls.filter((c) => c[0] === 'liveStart').length > n,
    revisedStarts,
  )
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.locator('[data-mic-mode="commands"]').waitFor()
  assert.equal(await page.evaluate(() => window.proof.livePeers.at(-1).connectionState), 'closed')
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').length),
    revisedOpens,
  )
  await close()
  await page.evaluate(() => {
    window.threadlight.transcribe = window.proof.savedTranscribe
  })

  // Closing during connection setup cannot submit its retained opening later.
  await page.evaluate(() => {
    window.proof.holdLive = true
  })
  await open()
  await say('Cancel this opening please.')
  const openings = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'liveOpen').length,
  )
  await close()
  await page.evaluate(() => {
    window.proof.holdLive = false
    window.proof.connectLive()
  })
  await page.waitForTimeout(150)
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').length),
    openings,
  )

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
