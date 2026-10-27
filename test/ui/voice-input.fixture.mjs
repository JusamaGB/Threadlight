/* global window, AudioContext */
export async function setupVoiceInput(page) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceTarget: 'thread' })
    window.proof.emit('onStt', { state: 'ready' })
    window.proof.stoppedTracks = 0
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext()
        window.proof.voiceSourceContext = context
        const tone = context.createOscillator()
        const gain = context.createGain()
        window.proof.voiceSourceGain = gain
        const destination = context.createMediaStreamDestination()
        tone.frequency.value = 220
        tone.connect(gain)
        gain.connect(destination) // no connection to speakers or a physical input
        const now = context.currentTime
        gain.gain.setValueAtTime(0.02, now)
        for (let i = 0; i < 30; i++) {
          gain.gain.linearRampToValueAtTime(0.12, now + i * 0.4 + 0.15)
          gain.gain.linearRampToValueAtTime(0.02, now + i * 0.4 + 0.4)
        }
        window.proof.setAudioLevel = (value) => {
          gain.gain.cancelScheduledValues(context.currentTime)
          gain.gain.setValueAtTime(value, context.currentTime)
        }
        if (window.proof.quietInput) window.proof.setAudioLevel(0)
        tone.start()
        await context.resume()
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            stop()
            tone.stop()
            void context.close()
            window.proof.stoppedTracks++
          }
        }
        return destination.stream
      },
    })
  })
}
