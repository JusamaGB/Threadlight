/* global window, document */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkBrainstormVoice(page, proof, capture) {
  const native = []
  proof.service.agent.startLive = async (sessionId) => {
    native.push(sessionId)
    proof.service.agent.publish({
      ...proof.service.agent.current,
      conversationId: `codex:${randomUUID()}`,
      provider: 'codex',
      ended: false,
      status: 'ready',
      live: 'ready',
      items: [],
    })
    return { ok: true, sdp: 'v=0\nsynthetic answer' }
  }
  proof.service.agent.stopLive = async () => {}
  await page.exposeFunction('mockBrainstormLive', (...args) => proof.service.startLive(...args))
  await page.exposeFunction('mockBrainstormLiveStop', (id) => proof.service.stopLive(id))
  await page.exposeFunction('mockBrainstormCallCount', () => proof.calls.length)
  await page.evaluate(() => {
    const stats = (window.voiceProof = { opened: 0, stopped: 0, transcribed: 0, general: 0 })
    class Node {
      connect() {}
      disconnect() {}
    }
    class Context {
      sampleRate = 16000
      state = 'running'
      destination = new Node()
      createMediaStreamSource() {
        return new Node()
      }
      createGain() {
        return Object.assign(new Node(), { gain: { value: 0 } })
      }
      createAnalyser() {
        return Object.assign(new Node(), {
          context: this,
          fftSize: 1024,
          frequencyBinCount: 512,
          getFloatTimeDomainData: (a) => a.fill(0),
          getFloatFrequencyData: (a) => a.fill(-Infinity),
        })
      }
      createScriptProcessor() {
        stats.processor = Object.assign(new Node(), { onaudioprocess: null })
        return stats.processor
      }
      createMediaStreamDestination() {
        return { stream: { getAudioTracks: () => [{}], getTracks: () => [] } }
      }
      async resume() {}
      async close() {
        this.state = 'closed'
      }
    }
    class Peer {
      connectionState = 'new'
      localDescription = { sdp: 'v=0\nsynthetic offer' }
      channel = { readyState: 'connecting' }
      addTrack() {}
      createDataChannel() {
        return this.channel
      }
      async createOffer() {
        return this.localDescription
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = 'connected'
        this.channel.readyState = 'open'
        this.channel.onmessage?.({ data: JSON.stringify({ type: 'session.started' }) })
      }
      close() {
        this.connectionState = 'closed'
      }
    }
    window.AudioContext = Context
    window.RTCPeerConnection = Peer
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        stats.opened++
        let stopped = false
        return {
          getTracks: () => [
            {
              stop: () => {
                if (!stopped) stats.stopped++
                stopped = true
              },
            },
          ],
        }
      },
    })
    stats.frames = (value, count) => {
      for (let i = 0; i < count; i++)
        stats.processor?.onaudioprocess?.({
          inputBuffer: { getChannelData: () => new Float32Array(512).fill(value) },
          outputBuffer: { getChannelData: () => new Float32Array(512) },
        })
    }
    window.threadlight.transcribe = async () => {
      stats.transcribed++
      return stats.text
    }
    window.threadlight.getStt = async () => ({ state: 'ready' })
    window.threadlight.agentSend = async () => {
      stats.general++
      return { ok: true }
    }
    window.threadlight.spacesLiveStart = (...args) => window.mockBrainstormLive(...args)
    window.threadlight.spacesLiveStop = (id) => {
      void window.mockBrainstormLiveStop(id)
    }
  })
  const press = () => page.evaluate(() => window.proof.emit('onTalkToggle', 'brainstorm'))
  const say = async (text) => {
    const before = await page.evaluate((text) => {
      window.voiceProof.text = text
      window.voiceProof.frames(0, 22)
      window.voiceProof.frames(0.15, 35)
      window.voiceProof.frames(0, 24)
      return window.voiceProof.transcribed
    }, text)
    await page.waitForFunction((before) => window.voiceProof.transcribed > before, before)
    await page.evaluate(() => window.voiceProof.frames(0, 45))
  }
  await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await press()
  await page.getByText(/Open an available project in Shared Spaces/).waitFor()
  assert.equal(await page.evaluate(() => window.voiceProof.opened), 0)
  await view.getByRole('button', { name: 'Create a space', exact: true }).click()
  await view.getByLabel('Space name').fill('Voice ideas')
  await view.getByRole('button', { name: 'Create space', exact: true }).click()
  const chat = view.getByRole('region', { name: 'Brainstorm chat', exact: true })
  const message = chat.getByRole('textbox', { name: 'Message to Agent', exact: true })
  await message.waitFor()
  await message.fill('Unsent typed thought')
  await page.evaluate(() => window.proof.emit('onStt', { state: 'ready' }))
  // Open from outside Brainstorm while its newly-mounted view's own settings IPC is delayed.
  // Voice must use the already-running Agent controller, without waiting for that view.
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await page.evaluate(() => {
    const read = window.threadlight.getSettings
    window.voiceProof.restoreSettings = () => {
      window.threadlight.getSettings = read
    }
    window.threadlight.getSettings = () => new Promise(() => {})
  })
  await press()
  const stop = page.getByRole('button', { name: 'End call', exact: true })
  await stop.waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
  await page.evaluate(() => window.voiceProof.restoreSettings())
  assert.equal(proof.store.discussions().length, 0)
  assert.equal(proof.calls.length, 0)
  if (process.env.THREADLIGHT_UI_FOCUS === 'hotkeys-routes') {
    // Both microphone capture and provider transports in this fixture are substitutes.
    const checkMute = async () => {
      const opened = await page.evaluate(() => window.voiceProof.opened)
      await page.evaluate(() => {
        document.body.style.visibility = 'hidden'
        window.proof.emit('onLiveMuteShortcut')
      })
      await page.waitForFunction(() => window.proof.motion?.inputMuted)
      await page.evaluate(() => {
        document.body.style.visibility = ''
        window.proof.emit('onLiveMuteShortcut')
      })
      await page.waitForFunction(() => !window.proof.motion?.inputMuted)
      assert.equal(await page.evaluate(() => window.voiceProof.opened), opened)
      assert.equal(await page.evaluate(() => document.documentElement.dataset.openMic), 'listening')
      await page.evaluate(() => window.proof.emit('onStopOpenMic'))
      await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
      await page.evaluate(() => window.proof.emit('onLiveMuteShortcut'))
      assert.equal(await page.evaluate(() => window.voiceProof.opened), opened)
    }
    await checkMute()
    await page.evaluate(async () => {
      await window.threadlight.updateSettings({
        voiceMode: 'local-stt',
        voiceTarget: 'agent',
        talkMode: 'toggle',
        talkHotkey: 'F8',
      })
      window.proof.emit('onTalkToggle')
    })
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
    await checkMute()
    assert.equal(native.length, 0)
    assert.equal(proof.calls.length, 0)
    console.log(
      'PASS hidden and visible renderer mute/unmute for Brainstorm and foreground Agent, no reopen after end, with substitute audio and zero provider calls.',
    )
    return
  }
  await say('Open the shared plan and brainstorm a clearer overview')
  await page.waitForFunction(async () => (await window.mockBrainstormCallCount()) >= 1)
  await chat
    .getByText(
      'Start with one shared activity summary. Show blockers and link to the original chat.',
      { exact: true },
    )
    .waitFor()
  assert.equal(proof.store.discussions().length, 1)
  const first = proof.store.discussions()[0].id
  await say('Include decisions and blockers')
  await page.waitForFunction(async () => (await window.mockBrainstormCallCount()) >= 2)
  assert.equal(proof.store.discussions()[0].id, first)
  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  await page.getByRole('button', { name: 'Return to call' }).waitFor()
  assert.equal(await stop.count(), 0)
  await page.evaluate(() =>
    window.proof.emit('onPanelOpened', {
      fresh: false,
      fromMic: true,
      maxHeight: 800,
      opensDown: true,
    }),
  )
  await chat.getByRole('textbox', { name: 'Message to Agent' }).waitFor()
  await stop.waitFor()
  assert.equal(proof.store.discussions()[0].id, first)
  await capture('brainstorm-voice-stt')
  await stop.click()
  await page.waitForFunction(() => window.voiceProof.opened === window.voiceProof.stopped)
  await chat.getByRole('button', { name: 'Start Agent voice', exact: true }).click()
  await stop.waitFor()
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  await page.waitForFunction(() => window.voiceProof.opened === window.voiceProof.stopped)
  await chat.getByRole('button', { name: 'End', exact: true }).click()
  assert.equal(await message.inputValue(), 'Unsent typed thought')
  await page.evaluate(() =>
    window.threadlight.updateSettings({ voiceMode: 'gpt-live', agentProvider: 'codex' }),
  )
  await page.evaluate(() => window.proof.agent({ provider: 'claude', status: 'ready' }))
  const transcribed = await page.evaluate(() => window.voiceProof.transcribed)
  await press()
  await stop.waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
  assert.equal(native.length, 1)
  await page
    .getByRole('region', { name: 'Voice waveform', exact: true })
    .locator('[data-provider="codex"]')
    .waitFor()
  assert.equal(proof.store.discussions().length, 1)
  proof.service.agent.publish({
    ...proof.service.agent.current,
    live: 'active',
    items: [
      {
        id: 'live:spoken',
        kind: 'you',
        text: 'Explore this native voice idea',
        liveComplete: true,
      },
      { id: 'live:reply', kind: 'agent', text: 'Let us compare the options.', liveComplete: true },
    ],
  })
  await chat
    .locator('[data-kind="you"]')
    .getByText('Explore this native voice idea', { exact: true })
    .waitFor()
  assert.equal(proof.store.discussions().length, 2)
  assert.equal(await page.evaluate(() => window.voiceProof.transcribed), transcribed)
  assert.equal(await page.evaluate(() => window.voiceProof.general), 0)
  await capture('brainstorm-voice-gpt-live')
  await page.evaluate(() => window.proof.emit('onStopOpenMic'))
  await page.waitForFunction(() => window.voiceProof.opened === window.voiceProof.stopped)
  console.log(
    'PASS: one Agent voice controller, first hotkey across delayed view settings, shared conversation UI, local STT, native Live, first-message binding, follow-ups and both stop controls.',
  )
}
