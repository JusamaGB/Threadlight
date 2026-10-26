/** Bounded, memory-only PCM queue. No transcription, resampling, or speech detection. */
export class LiveAudioBuffer {
  private frames: Float32Array[] = []
  private head = 0
  private offset = 0
  private silence = 0
  private samples = 0
  constructor(
    private sampleRate: number,
    private seconds = 30,
  ) {}
  get length(): number {
    return this.samples
  }
  append(input: Float32Array, compactSilence: boolean): boolean {
    let frame = input
    // Preserve a half-second pause, then omit only exact digital silence while catching up.
    // Even the quietest nonzero microphone samples are retained, in order.
    if (compactSilence && input.every((value) => value === 0)) {
      const keep = Math.max(0, Math.floor(this.sampleRate / 2) - this.silence)
      this.silence += input.length
      frame = input.subarray(0, keep)
    } else this.silence = 0
    if (this.samples + frame.length > this.sampleRate * this.seconds) return false
    if (frame.length) {
      this.frames.push(new Float32Array(frame))
      this.samples += frame.length
    }
    return true
  }
  read(output: Float32Array): void {
    output.fill(0)
    let written = 0
    while (written < output.length && this.head < this.frames.length) {
      const frame = this.frames[this.head]!
      const size = Math.min(output.length - written, frame.length - this.offset)
      output.set(frame.subarray(this.offset, this.offset + size), written)
      written += size
      this.samples -= size
      this.offset += size
      if (this.offset === frame.length) {
        this.head++
        this.offset = 0
      }
    }
    if (this.head === this.frames.length) this.clear()
    else if (this.head > 100) {
      this.frames = this.frames.slice(this.head)
      this.head = 0
    }
  }
  clear(): void {
    this.frames = []
    this.head = 0
    this.offset = 0
    this.silence = 0
    this.samples = 0
  }
}
