import { SILENT_AUDIO, unit, type AudioEnergy, type MotionSnapshot } from '../../shared/motion'

export interface MotionPose {
  wheel: number
  warmth: number
  rest: number
  input: AudioEnergy
  output: AudioEnergy
}
export const restingPose = (): MotionPose => ({
  wheel: 0,
  warmth: 0,
  rest: 1,
  input: { ...SILENT_AUDIO },
  output: { ...SILENT_AUDIO },
})

/** Time-based attack/release keeps the response consistent at 30, 60 and 120 Hz. */
export function advancePose(pose: MotionPose, snapshot: MotionSnapshot, elapsed: number): void {
  const dt = Math.max(0, Math.min(100, elapsed))
  const ease = (current: number, target: number, ms: number) =>
    current + (target - current) * (1 - Math.exp(-dt / ms))
  for (const channel of ['input', 'output'] as const) {
    for (const key of ['level', 'low', 'mid', 'high'] as const) {
      const next = unit(snapshot[channel][key])
      pose[channel][key] = ease(pose[channel][key], next, next > pose[channel][key] ? 45 : 170)
    }
  }
  // Real speech has precedence over the background work state, including interruptions.
  const speaking = Math.max(unit(snapshot.input.level), unit(snapshot.output.level)) > 0.035
  const wheel = !speaking && ['thinking', 'transcribing', 'waiting'].includes(snapshot.mode)
  pose.wheel = ease(pose.wheel, wheel ? 1 : 0, speaking ? 70 : 115)
  pose.warmth = ease(pose.warmth, wheel ? 1 : 0, 150)
  pose.rest = ease(pose.rest, snapshot.mode === 'idle' && !speaking ? 1 : 0, 180)
}

type Point = { x: number; y: number }
type Colour = readonly [number, number, number]
const CYAN: Colour = [0.04, 0.83, 1]
const BLUE: Colour = [0.15, 0.29, 1]
const VIOLET: Colour = [0.58, 0.25, 1]
const PINK: Colour = [1, 0.13, 0.6]
const GOLD: Colour = [1, 0.67, 0.18]
const PEARL: Colour = [0.8, 1, 0.98]
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const palette = [PINK, VIOLET, BLUE, CYAN, PEARL, GOLD, PINK]

/** Interleaved position/RGBA triangles. Both renderers consume the same bounded geometry. */
export class MotionGeometry {
  readonly vertices = new Float32Array(220_000)
  count = 0

  build(
    width: number,
    height: number,
    time: number,
    pose: MotionPose,
    reduced: boolean,
    edgeToEdge = false,
  ): Float32Array {
    this.count = 0
    const compact = height < 36
    const strands = compact ? 5 : 7
    const segments = compact ? 48 : 104
    const t = reduced ? 0 : time
    const both = pose.input.level > 0.045 && pose.output.level > 0.045
    const output = pose.output.level > pose.input.level
    const drawBody = (audio: AudioEnergy, agent: boolean, offset: number, size: number) => {
      const energy = Math.sqrt(unit(Math.max(0, audio.level - 0.008)))
      const amplitude = (0.025 + (compact ? pose.rest * 0.02 : 0) + energy * 0.38) * height * size
      const colourAt = (u: number, strand: number): Colour => {
        const p = (((u * 4 + strand * 0.55 + t * 0.12) % 6) + 6) % 6
        const a = palette[Math.floor(p)]!
        const b = palette[Math.floor(p) + 1]!
        const f = p % 1
        const base: Colour = [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)]
        const tint = agent ? VIOLET : CYAN
        const warm = pose.warmth
        return [
          mix(mix(base[0], tint[0], 0.18), GOLD[0], warm * 0.82),
          mix(mix(base[1], tint[1], 0.18), GOLD[1], warm * 0.82),
          mix(mix(base[2], tint[2], 0.18), GOLD[2], warm * 0.82),
        ]
      }
      const point = (u: number, strand: number): Point => {
        const phase = strand * 0.62
        const envelope = Math.pow(Math.sin(Math.PI * u), 2.3)
        const sway =
          Math.sin(u * Math.PI * 3.1 - t * (agent ? 1.7 : 2.1) + phase) * (0.62 + audio.low * 0.1) +
          Math.sin(u * Math.PI * 5 + t * 0.65 + phase * 0.7) * (0.2 + audio.mid * 0.08) +
          Math.sin(u * Math.PI * 13 - t * 3.2 + phase) * audio.high * 0.16
        const span = edgeToEdge ? width : width * 0.96 * (1 - pose.rest * (compact ? 0.15 : 0.6))
        const x = (u - 0.5) * span
        const y = envelope * amplitude * sway + offset
        const angle = (strand / strands) * Math.PI * 2 + t * 2.5 - u * 4.1
        const radius = height * (0.055 + u * 0.31)
        return {
          x: width / 2 + mix(x, Math.cos(angle) * radius, pose.wheel),
          y: height / 2 + mix(y, Math.sin(angle) * radius, pose.wheel),
        }
      }
      for (let strand = 0; strand < strands; strand++) {
        let previous = point(0, strand)
        for (let i = 1; i <= segments; i++) {
          const u = i / segments
          const next = point(u, strand)
          const colour = colourAt(u, strand)
          const envelope = Math.pow(Math.sin(Math.PI * u), 0.35)
          // Header ribbons keep visible ends even after their resting pose settles.
          const taper = mix(
            edgeToEdge ? 0.55 + envelope * 0.45 : envelope,
            0.25 + u * 0.75,
            pose.wheel,
          )
          const alpha = taper * (0.55 + energy * 0.4) * (1 - pose.rest * (compact ? 0.2 : 0.5))
          if (!compact && strand % 2 === 0 && strand + 1 < strands) {
            this.quad(
              previous,
              next,
              point(u, strand + 1),
              point((i - 1) / segments, strand + 1),
              colour,
              alpha * 0.13,
            )
          }
          this.line(previous, next, compact ? 2.2 : 5, colour, alpha * 0.065)
          this.line(previous, next, compact ? 1.2 : 2.2, colour, alpha * 0.2)
          this.line(previous, next, compact ? 0.6 : 0.8, colour, Math.min(1, alpha * 1.4))
          previous = next
        }
      }
      if (pose.wheel > 0.8 && !compact && !reduced) {
        for (let i = 0; i < 5; i++) {
          const life = (t * 0.65 + i * 0.217) % 1
          const angle = t * 2.5 + i * 2.4
          const radius = height * (0.35 + life * 0.085)
          const p = {
            x: width / 2 + Math.cos(angle) * radius,
            y: height / 2 + Math.sin(angle) * radius,
          }
          this.line(
            p,
            { x: p.x + Math.sin(angle) * 3, y: p.y - Math.cos(angle) * 3 },
            0.75,
            GOLD,
            (1 - life) * 0.45 * pose.wheel,
          )
        }
      }
    }
    if (both) {
      drawBody(pose.input, false, -height * 0.19, 0.46)
      drawBody(pose.output, true, height * 0.19, 0.46)
    } else drawBody(output ? pose.output : pose.input, output, 0, 1)
    return this.vertices.subarray(0, this.count)
  }

  private line(a: Point, b: Point, width: number, colour: Colour, alpha: number): void {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const dx = ((b.y - a.y) / length) * width * 0.5
    const dy = ((a.x - b.x) / length) * width * 0.5
    this.quad(
      { x: a.x - dx, y: a.y - dy },
      { x: b.x - dx, y: b.y - dy },
      { x: b.x + dx, y: b.y + dy },
      { x: a.x + dx, y: a.y + dy },
      colour,
      alpha,
    )
  }

  private quad(a: Point, b: Point, c: Point, d: Point, colour: Colour, alpha: number): void {
    for (const p of [a, b, c, a, c, d]) {
      this.vertices[this.count++] = p.x
      this.vertices[this.count++] = p.y
      this.vertices[this.count++] = colour[0]
      this.vertices[this.count++] = colour[1]
      this.vertices[this.count++] = colour[2]
      this.vertices[this.count++] = alpha
    }
  }
}
