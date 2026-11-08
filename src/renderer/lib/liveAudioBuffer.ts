// Work in PCM16 units only to classify the noise floor. Speech is queued and
// played from the original Float32 samples without quantization or resampling.
const MAX_NOISE_SPAN = 16
function quietFloor(input: Float32Array) {
  let min = Infinity,
    max = -Infinity,
    sum = 0
  for (const value of input) {
    const code = Math.round(value * 32768)
    min = Math.min(min, code)
    max = Math.max(max, code)
    sum += code
    if (min < -64 || max > 64 || max - min > MAX_NOISE_SPAN) return
  }
  if (!input.length) return
  if (min === max) return { min, max }
  if (input.length < 128) return
  // Very short repeating dither and stable decorrelated floor noise are distinct
  // from a slow, quiet tone. Never infer silence from amplitude alone.
  for (const period of [2, 3, 4]) {
    if (
      input.every(
        (v, i) => i < period || Math.round(v * 32768) === Math.round(input[i - period]! * 32768),
      )
    )
      return { min, max }
  }
  const mean = sum / input.length,
    span = max - min
  let loPower = Infinity,
    hiPower = 0
  for (let group = 0; group < 4; group++) {
    const from = Math.floor((group * input.length) / 4),
      to = Math.floor(((group + 1) * input.length) / 4)
    let meanDiff = 0,
      power = 0
    for (let i = from; i < to; i++) {
      const d = Math.round(input[i]! * 32768) - mean
      meanDiff += d
      power += d * d
    }
    power /= to - from
    // Allow sampling variation in the mean of a short stationary-noise window.
    const meanTolerance = Math.max(0.65, span * 0.12, 3.5 * Math.sqrt(power / (to - from)))
    if (Math.abs(meanDiff) / (to - from) > meanTolerance) return
    loPower = Math.min(loPower, power)
    hiPower = Math.max(hiPower, power)
  }
  if (loPower <= 0 || hiPower > loPower * 3) return
  for (const lag of [1, 2, 4, 8, 16]) {
    let xy = 0,
      xx = 0,
      yy = 0
    for (let i = lag; i < input.length; i++) {
      const x = Math.round(input[i]! * 32768) - mean,
        y = Math.round(input[i - lag]! * 32768) - mean
      xx += x * x
      yy += y * y
      xy += x * y
    }
    if (xx === 0 || yy === 0 || Math.abs(xy) > 0.35 * Math.sqrt(xx * yy)) return
  }
  return { min, max }
}

/** Bounded, memory-only PCM queue. No transcription, resampling, or speech detection. */
export class LiveAudioBuffer {
  private frames: Float32Array[] = []
  private head = 0
  private offset = 0
  private silence = 0
  private idleMin = Infinity
  private idleMax = -Infinity
  private samples = 0
  private edge: Float32Array[] = []
  private edgeSize = 0
  constructor(
    private sampleRate: number,
    private seconds = 30,
  ) {}
  get length(): number {
    return this.samples
  }
  append(input: Float32Array, compactSilence: boolean): boolean {
    let frame = input
    const quiet = compactSilence ? quietFloor(input) : undefined
    if (quiet) {
      const { min, max } = quiet
      const lo = Math.min(min, this.idleMin),
        hi = Math.max(max, this.idleMax)
      const levelChanged = min === max && this.idleMin === this.idleMax && min !== this.idleMin
      if (hi - lo > MAX_NOISE_SPAN || levelChanged) {
        if (!this.restoreEdge(input.length)) return false
        this.silence = 0
        this.idleMin = min
        this.idleMax = max
      } else {
        this.idleMin = lo
        this.idleMax = hi
      }
      const keep = Math.max(0, Math.floor(this.sampleRate / 2) - this.silence)
      this.silence += input.length
      frame = input.subarray(0, keep)
      if (frame.length < input.length && (min !== max || this.edgeSize > 0)) {
        this.saveQuietEdge(input.subarray(frame.length))
      }
    } else {
      if (!this.restoreEdge(input.length)) return false
      this.silence = 0
      this.idleMin = Infinity
      this.idleMax = -Infinity
    }
    if (this.samples + frame.length > this.sampleRate * this.seconds) return false
    if (frame.length) {
      this.frames.push(new Float32Array(frame))
      this.samples += frame.length
    }
    return true
  }
  private restoreEdge(nextSize: number) {
    if (this.samples + this.edgeSize + nextSize > this.sampleRate * this.seconds) return false
    if (this.samples && this.edgeSize) {
      this.frames.push(...this.edge)
      this.samples += this.edgeSize
    }
    this.edge = []
    this.edgeSize = 0
    return true
  }
  private saveQuietEdge(samples: Float32Array) {
    // Retain recent raw samples at the far side of a long pause for a quiet onset.
    const limit = Math.ceil(this.sampleRate * 0.12)
    const chunk = samples.slice(Math.max(0, samples.length - limit))
    this.edge.push(chunk)
    this.edgeSize += chunk.length
    while (this.edgeSize > limit) {
      const first = this.edge[0]!,
        excess = this.edgeSize - limit
      if (first.length <= excess) {
        this.edge.shift()
        this.edgeSize -= first.length
      } else {
        this.edge[0] = first.slice(excess)
        this.edgeSize -= excess
      }
    }
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
    this.edge = []
    this.edgeSize = 0
    this.frames = []
    this.head = 0
    this.offset = 0
    this.idleMin = Infinity
    this.idleMax = -Infinity
    this.silence = 0
    this.samples = 0
  }
}
