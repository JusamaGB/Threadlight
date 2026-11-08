/* global window, AudioContext */
import assert from 'node:assert/strict'

/** Exercises the real microphone hook with a generated stream and a substitute peer. */
export async function checkCallReady(page) {
  await page.evaluate(async () => {
    const stats = (window.readyProof = { cues: 0, holdMic: false })
    const oscillator = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      const tone = oscillator.call(this)
      const start = tone.start.bind(tone)
      const frequency = tone.frequency.setValueAtTime.bind(tone.frequency)
      let readyTone = false
      tone.frequency.setValueAtTime = (value, time) => {
        if (value === 660) readyTone = true
        return frequency(value, time)
      }
      tone.start = (...args) => {
        if (readyTone) stats.cues++
        return start(...args)
      }
      return tone
    }
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (options) => {
        if (stats.holdMic)
          await new Promise((resolve) => {
            stats.allowMic = resolve
          })
        return acquire(options)
      },
    })
    window.RTCPeerConnection = class {
      connectionState = 'new'
      channel = { readyState: 'connecting' }
      constructor() {
        stats.peer = this
      }
      addTrack() {}
      createDataChannel() {
        return this.channel
      }
      async createOffer() {
        return { type: 'offer', sdp: 'v=0' }
      }
      async setLocalDescription(value) {
        this.localDescription = value
      }
      async setRemoteDescription() {
        this.connectionState = 'connected'
        this.channel.readyState = 'open'
        this.channel.onopen?.()
      }
      close() {
        this.connectionState = 'closed'
      }
    }
    window.threadlight.agentLiveStart = async () => ({ ok: true, sdp: 'v=0' })
    window.threadlight.agentLiveStop = () => {}
    await window.threadlight.updateSettings({
      voiceMode: 'gpt-live',
      voiceTarget: 'agent',
      agentProvider: 'codex',
    })
    window.proof.agent({ provider: 'codex', status: 'ready', ended: false, live: null })
    stats.started = () =>
      stats.peer.channel.onmessage?.({ data: JSON.stringify({ type: 'session.started' }) })
  })
  const cues = () => page.evaluate(() => window.readyProof.cues)
  const open = async () => {
    await page.evaluate(() => {
      delete window.readyProof.allowMic
      window.proof.emit('onTalkToggle')
    })
    await page.waitForFunction(() => window.readyProof.peer?.connectionState === 'connected')
  }
  const close = async () => {
    await page.evaluate(() => window.proof.emit('onStopOpenMic'))
    await page.waitForFunction(() => window.readyProof.peer.connectionState === 'closed')
  }
  await open()
  assert.equal(await cues(), 0, 'an open transport is not a ready model')
  await page.evaluate(() => window.readyProof.started())
  await page.waitForFunction(() => window.readyProof.cues === 1)
  await page.evaluate(() => {
    window.readyProof.started()
    window.readyProof.started()
  })
  assert.equal(await cues(), 1, 'readiness is acknowledged once per call')
  await close()

  await page.evaluate(() => {
    window.readyProof.holdMic = true
  })
  await open()
  await page.waitForFunction(() => typeof window.readyProof.allowMic === 'function')
  await page.evaluate(() => window.readyProof.started())
  assert.equal(await cues(), 1, 'model readiness must also wait for the microphone')
  await page.evaluate(() => window.readyProof.allowMic())
  await page.waitForFunction(() => window.readyProof.cues === 2)
  await close()

  await open()
  await page.waitForFunction(() => typeof window.readyProof.allowMic === 'function')
  await close()
  await page.evaluate(() => {
    window.readyProof.started()
    window.readyProof.allowMic()
  })
  await page.waitForTimeout(150)
  assert.equal(await cues(), 2, 'a cancelled call must not signal success later')
  await page.evaluate(() => {
    window.readyProof.holdMic = false
  })
  await open()
  await page.getByRole('button', { name: 'Mute speaker', exact: true }).click()
  await page.evaluate(() => window.readyProof.started())
  await page.getByRole('button', { name: 'Unmute speaker', exact: true }).waitFor()
  await page.waitForTimeout(150)
  assert.equal(await cues(), 2, 'speaker mute also silences the connection cue')
  await page.getByRole('button', { name: 'Unmute speaker', exact: true }).click()
  assert.equal(await cues(), 2, 'unmuting does not replay the connection cue')
  await close()
  console.log(
    'PASS ready cue waits for microphone and model, fires once, and ignores cancelled startup; no real microphone or provider calls.',
  )
}
