// The open mic's ears: splits a continuous stream of microphone frames into utterances, on the
// device, by loudness against the room.
//
// The room rules are BLAM8's Concierge (voice-live.js), which handles rooms with a telly or a
// dishwasher well: a slow rolling estimate of the room's level (the ambient floor) learns only
// while nobody is speaking, so speech can never teach it to ignore speech, and an utterance
// counts only if its loudest moment reached four times the room and a real speaking level.
// BLAM8 finds where speech starts and stops with a speech model (Silero); this is simpler, by
// loudness alone, which suits short deliberate commands: an utterance starts when a frame stands
// clearly above the room, ends after half a second of quiet (as BLAM8's), and keeps about 600 ms
// from before it started (as BLAM8's), so first words are not clipped. Anything else (a cough,
// a click, the telly) is dropped without being transcribed.

/** The tuning, in one place. Levels are frame peaks (0 to 1); times are milliseconds. */
export const VAD = {
  /** How fast the floor follows the room: about a second to settle. */
  AMBIENT_SETTLE_MS: 1000,
  /** At first the floor is only learned, never acted on. */
  CALIBRATE_MS: 500,
  /** A frame this far above the room (and above MIN_START_PEAK) starts an utterance. */
  START_OVER_AMBIENT: 2.5,
  // Unamplified headset speech can peak below 0.05. Let its quieter syllables count;
  // the ambient ratio and minimum voiced duration still reject noise and clicks.
  MIN_START_PEAK: 0.01,
  /** An utterance counts only if its peak reached this far above the room… */
  SPEECH_OVER_AMBIENT: 4,
  /** …and real talking level. */
  MIN_SPEECH_PEAK: 0.025,
  /** This much quiet ends an utterance. */
  END_SILENCE_MS: 500,
  /** Audio kept from before the start. */
  PRE_ROLL_MS: 600,
  /** Shorter than this above the start level is a click or a cough. */
  MIN_SPEECH_MS: 150,
  /** A command is short: anything longer is cut off here and judged as it is. */
  MAX_UTTERANCE_MS: 8000,
} as const

/**
 * What one frame did: began an utterance, finished one that counts (its audio, and when its
 * last loud frame was), or finished one that did not (a cough, a click). Times are on the
 * audio's own clock (Segmenter.now), so they never drift from what was heard.
 */
export type SegmenterEvent =
  | { kind: 'start'; at: number }
  | { kind: 'utterance'; audio: Float32Array; endedAt: number }
  | { kind: 'dropped'; at: number }

export class Segmenter {
  private ambient: number | null = null
  private elapsedMs = 0
  private preRoll: Float32Array[] = []
  private preRollMs = 0
  private speech: Float32Array[] | null = null
  private speechMs = 0
  private voicedMs = 0
  private silentMs = 0
  private peak = 0

  constructor(private readonly sampleRate: number) {}

  /** The room's level as learned so far (0 before the first frame). */
  get floor(): number {
    return this.ambient ?? 0
  }

  /** How much audio has been heard, in milliseconds: the clock events are timed on. */
  get now(): number {
    return this.elapsedMs
  }

  /** Takes one frame (it is kept, so pass a copy) and says what it did, if anything. */
  feed(frame: Float32Array): SegmenterEvent | null {
    const ms = (frame.length / this.sampleRate) * 1000
    let peak = 0
    for (const sample of frame) peak = Math.max(peak, Math.abs(sample))
    this.elapsedMs += ms
    this.ambient ??= peak
    const startGate = Math.max(this.ambient * VAD.START_OVER_AMBIENT, VAD.MIN_START_PEAK)

    if (!this.speech) {
      if (this.elapsedMs > VAD.CALIBRATE_MS && peak >= startGate) {
        this.speech = [...this.preRoll, frame]
        this.speechMs = this.preRollMs + ms
        this.voicedMs = ms
        this.silentMs = 0
        this.peak = peak
        this.preRoll = []
        this.preRollMs = 0
        return { kind: 'start', at: this.elapsedMs - ms }
      }
      // Nobody is speaking: the floor learns the room, and the frame waits as pre-roll.
      const rate = Math.min(1, ms / VAD.AMBIENT_SETTLE_MS)
      this.ambient = this.ambient * (1 - rate) + peak * rate
      this.preRoll.push(frame)
      this.preRollMs += ms
      while (this.preRollMs > VAD.PRE_ROLL_MS && this.preRoll.length > 1) {
        const dropped = this.preRoll.shift()!
        this.preRollMs -= (dropped.length / this.sampleRate) * 1000
      }
      return null
    }

    this.speech.push(frame)
    this.speechMs += ms
    this.peak = Math.max(this.peak, peak)
    if (peak >= startGate) {
      this.voicedMs += ms
      this.silentMs = 0
    } else {
      this.silentMs += ms
    }
    if (this.silentMs < VAD.END_SILENCE_MS && this.speechMs < VAD.MAX_UTTERANCE_MS) return null

    const frames = this.speech
    this.speech = null
    const endedAt = this.elapsedMs - this.silentMs
    const speechGate = Math.max(this.ambient * VAD.SPEECH_OVER_AMBIENT, VAD.MIN_SPEECH_PEAK)
    if (this.voicedMs < VAD.MIN_SPEECH_MS || this.peak < speechGate) {
      return { kind: 'dropped', at: this.elapsedMs }
    }
    return { kind: 'utterance', audio: concat(frames), endedAt }
  }

  /** Forgets any utterance under way (the mic was paused), keeping what it knows of the room. */
  preview(): Float32Array | null {
    if (
      !this.speech ||
      this.voicedMs < 500 ||
      this.peak < Math.max((this.ambient ?? 0) * VAD.SPEECH_OVER_AMBIENT, VAD.MIN_SPEECH_PEAK)
    )
      return null
    return concat(this.speech)
  }

  /** Forgets captured audio while retaining the learned room level. */
  drop(): void {
    this.speech = null
    this.preRoll = []
    this.preRollMs = 0
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0))
  let at = 0
  for (const frame of frames) {
    out.set(frame, at)
    at += frame.length
  }
  return out
}
