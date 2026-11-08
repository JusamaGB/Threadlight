/** A short local acknowledgement. Never send the cue into the microphone stream. */
export function callReadyCue(context: AudioContext): void {
  if (context.state !== 'running') return
  try {
    const tone = context.createOscillator()
    const volume = context.createGain()
    const now = context.currentTime
    tone.frequency.setValueAtTime(660, now)
    tone.frequency.setValueAtTime(880, now + 0.07)
    volume.gain.setValueAtTime(0.0001, now)
    volume.gain.linearRampToValueAtTime(0.035, now + 0.012)
    volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    tone.connect(volume)
    volume.connect(context.destination)
    tone.onended = () => {
      tone.disconnect()
      volume.disconnect()
    }
    tone.start(now)
    tone.stop(now + 0.18)
  } catch {
    // An unavailable sound device must not prevent the call from connecting.
  }
}
