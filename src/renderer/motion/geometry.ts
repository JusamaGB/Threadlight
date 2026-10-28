import { PROVIDER_COLOURS } from './provider-colours'
import { SILENT_AUDIO, unit, type AudioEnergy, type MotionSnapshot } from '../../shared/motion'

export interface MotionPose {
  wheel: number
  warmth: number
  rest: number
  audioReveal: number
  headerOpening: boolean
  input: AudioEnergy
  output: AudioEnergy
}
export const restingPose = (): MotionPose => ({
  wheel: 0,
  warmth: 0,
  rest: 1,
  audioReveal: 1,
  headerOpening: false,
  input: { ...SILENT_AUDIO },
  output: { ...SILENT_AUDIO },
})

/** Time-based attack/release keeps the response consistent at 30, 60 and 120 Hz. */
export function advancePose(
  pose: MotionPose,
  snapshot: MotionSnapshot,
  elapsed: number,
  header = false,
): void {
  const dt = Math.max(0, Math.min(100, elapsed))
  const ease = (current: number, target: number, ms: number) =>
    current + (target - current) * (1 - Math.exp(-dt / ms))
  // Real speech has precedence over the background work state, including interruptions.
  const speaking = Math.max(unit(snapshot.input.level), unit(snapshot.output.level)) > 0.035
  let wheel = !speaking && ['thinking', 'transcribing', 'waiting'].includes(snapshot.mode)
  // Once the header starts opening, audio gaps cannot fold it back into the wheel.
  if (header && pose.wheel > 0 && !wheel) pose.headerOpening = true
  if (header && pose.headerOpening) wheel = false
  pose.wheel = ease(pose.wheel, wheel ? 1 : 0, header ? 180 : speaking ? 70 : 115)
  // Finish the header's asymptotic opening at full width before audio can move it.
  if (header && !wheel && pose.wheel < 0.005) pose.wheel = 0
  if (pose.wheel === 0) pose.headerOpening = false
  pose.audioReveal = header && pose.wheel > 0 ? 0 : ease(pose.audioReveal, 1, 120)
  for (const channel of ['input', 'output'] as const) {
    for (const key of ['level', 'low', 'mid', 'high'] as const) {
      if (header && pose.wheel > 0) pose[channel][key] = 0
      else {
        const next = unit(snapshot[channel][key]) * pose.audioReveal
        pose[channel][key] = ease(pose[channel][key], next, next > pose[channel][key] ? 45 : 170)
      }
    }
  }
  pose.warmth = ease(pose.warmth, wheel ? 1 : 0, 150)
  const visibleSpeech = speaking && (!header || pose.wheel === 0)
  pose.rest = ease(pose.rest, snapshot.mode === 'idle' && !visibleSpeech ? 1 : 0, 180)
}

type Point = { x: number; y: number }
type Colour = readonly [number, number, number]
const CYAN: Colour = [0.04, 0.83, 1]
const BLUE: Colour = [0.15, 0.29, 1]
const VIOLET: Colour = [0.58, 0.25, 1]
const PINK: Colour = [1, 0.13, 0.6]
const GOLD: Colour = [1, 0.67, 0.18]
const SHINE: Colour = [1, 0.96, 0.78]
// Approved active-wheel preview: vibrant Claude orange with a glossy Codex-blue sweep.
const ACTIVE_ORANGE: Colour = [(218 / 255) * 1.15, (138 / 255) * 1.1, (98 / 255) * 0.94]
const ACTIVE_BLUE: Colour = [(104 / 255) * 0.87, (170 / 255) * 1.08, 1]
const PEARL: Colour = [0.8, 1, 0.98]
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const palette = [PINK, VIOLET, BLUE, CYAN, PEARL, GOLD, PINK]

// Continuous lattice noise has no wrap-around clock or repeating colour sweep.
const smooth = (value: number) => value * value * (3 - 2 * value)
const noise = (x: number, y: number): number => {
  const ix = Math.floor(x),
    iy = Math.floor(y)
  const hash = (a: number, b: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123
    return value - Math.floor(value)
  }
  return mix(
    mix(hash(ix, iy), hash(ix + 1, iy), smooth(x - ix)),
    mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), smooth(x - ix)),
    smooth(y - iy),
  )
}

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
    activeWheel = false,
    provider?: keyof typeof PROVIDER_COLOURS,
  ): Float32Array {
    this.count = 0
    const compact = height < 36 || edgeToEdge
    const strands = compact ? 5 : 7
    const segments = compact ? 48 : 104
    const t = reduced ? 0 : time
    // Also cover scrubbed previews and direct poses, which bypass advancePose.
    const inputAudio = edgeToEdge && pose.wheel > 0 ? SILENT_AUDIO : pose.input
    const outputAudio = edgeToEdge && pose.wheel > 0 ? SILENT_AUDIO : pose.output
    const both = inputAudio.level > 0.045 && outputAudio.level > 0.045
    const output = outputAudio.level > inputAudio.level
    // The wheel touches the left wall, centred on the divider. Its existing
    // strands stretch to the right while the left end stays at that wall.
    const divider = Math.min(9, height * 0.3)
    const wheelRadius = Math.min(6.5, height * 0.18)
    const wheelX = wheelRadius + 1
    // Keep the left end fixed while different turns of the spiral unwind.
    let headerLeft = 0
    if (edgeToEdge) {
      headerLeft = Infinity
      for (let strand = 0; strand < strands; strand++) {
        for (let i = 0; i <= segments; i++) {
          const u = i / segments
          const angle = (strand / strands) * Math.PI * 2 + t * 2.5 - u * 4.1
          const radius = wheelRadius * (0.15 + u * 0.85)
          headerLeft = Math.min(
            headerLeft,
            mix(u * width, wheelX + Math.cos(angle) * radius, pose.wheel),
          )
        }
      }
      headerLeft -= pose.wheel * 1.1
    }
    const drawBody = (audio: AudioEnergy, agent: boolean, offset: number, size: number) => {
      const energy = Math.sqrt(unit(Math.max(0, audio.level - 0.008)))
      const amplitude = edgeToEdge
        ? (0.6 + energy * 16) * size
        : (0.025 + (compact ? pose.rest * 0.02 : 0) + energy * 0.38) * height * size
      const colourAt = (u: number, strand: number): Colour => {
        const flow = edgeToEdge
          ? t * 0.32 +
            noise(u * 2.7 + strand * 2.13, t * 0.38) * 2.3 +
            noise(u * 6.1 - t * 0.11, t * 0.19 + strand * 0.71) * 0.65
          : t * 0.12
        const p = (((u * 4 + strand * 0.55 + flow) % 6) + 6) % 6
        const a = palette[Math.floor(p)]!
        const b = palette[Math.floor(p) + 1]!
        const f = p % 1
        const base: Colour = [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)]
        // Fade provider colour with the smoothed playback envelope, including speech tails.
        if (agent && provider) {
          const tone = PROVIDER_COLOURS[provider].rgb
          const speaking = unit(audio.level / 0.035)
          return [
            mix(base[0], tone[0], speaking),
            mix(base[1], tone[1], speaking),
            mix(base[2], tone[2], speaking),
          ]
        }
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
        // Overlapping frequency regions avoid seams: bass left, mids centre, treble right.
        // Overall level still controls silence; individual bands control local height.
        const weights = [0.18, 0.5, 0.82].map((centre) =>
          Math.exp(-0.5 * ((u - centre) / 0.18) ** 2),
        )
        const local =
          (weights[0]! * audio.low + weights[1]! * audio.mid + weights[2]! * audio.high) /
          (weights[0]! + weights[1]! + weights[2]!)
        const response =
          energy > 0 ? 0.12 + 0.88 * Math.sqrt(unit(local / Math.max(0.008, audio.level))) : 1
        const rawY = envelope * amplitude * response * sway + offset
        // Most expression opens below the bar; the short upper crest stays clear
        // of header text. Soft compression avoids clipped, flat-topped waves.
        const room = rawY < 0 ? Math.max(1, Math.min(4.5, divider - 1.5)) : 11
        const y = edgeToEdge ? room * Math.tanh(rawY / room) : rawY
        const angle = (strand / strands) * Math.PI * 2 + t * 2.5 - u * 4.1
        const radius = edgeToEdge ? wheelRadius * (0.15 + u * 0.85) : height * (0.055 + u * 0.31)
        return {
          x: edgeToEdge
            ? mix(u * width, wheelX + Math.cos(angle) * radius, pose.wheel) - headerLeft
            : width / 2 + mix(x, Math.cos(angle) * radius, pose.wheel),
          y: edgeToEdge
            ? divider + mix(y, Math.sin(angle) * radius, pose.wheel)
            : height / 2 + mix(y, Math.sin(angle) * radius, pose.wheel),
        }
      }
      for (let strand = 0; strand < strands; strand++) {
        let previous = point(0, strand)
        for (let i = 1; i <= segments; i++) {
          const u = i / segments
          const next = point(u, strand)
          const ribbonColour = colourAt(u, strand)
          const baseColour: Colour = activeWheel
            ? [
                mix(ribbonColour[0], ACTIVE_ORANGE[0], pose.wheel),
                mix(ribbonColour[1], ACTIVE_ORANGE[1], pose.wheel),
                mix(ribbonColour[2], ACTIVE_ORANGE[2], pose.wheel),
              ]
            : ribbonColour
          // A narrow leading edge and a longer tail travel from each spiral's root to its tip.
          // The quiet interval lets the strands settle between sweeps. Reduced motion
          // keeps the original static wheel, and ribbons retain their audio-driven light.
          const head = (t % 2.1) / 1.35 - 0.12
          const distance = u - head
          const spread = distance > 0 ? 0.055 : 0.16
          const fade = unit(head / 0.08) * unit((1.32 - head) / 0.28)
          const shine = reduced ? 0 : Math.exp(-0.5 * (distance / spread) ** 2) * fade * pose.wheel
          const glint = reduced ? 0 : Math.exp(-0.5 * (distance / 0.026) ** 2) * fade * 0.28
          const highlight: Colour = activeWheel
            ? [
                mix(ACTIVE_BLUE[0], 1, glint),
                mix(ACTIVE_BLUE[1], 1, glint),
                mix(ACTIVE_BLUE[2], 1, glint),
              ]
            : SHINE
          const light = shine * (activeWheel ? 1 : 0.92)
          const colour: Colour = [
            mix(baseColour[0], highlight[0], light),
            mix(baseColour[1], highlight[1], light),
            mix(baseColour[2], highlight[2], light),
          ]
          const envelope = Math.pow(Math.sin(Math.PI * u), 0.35)
          // Header ribbons keep visible ends even after their resting pose settles.
          const taper = mix(
            edgeToEdge ? 0.55 + envelope * 0.45 : envelope,
            0.25 + u * 0.75,
            pose.wheel,
          )
          const alpha =
            taper *
            (0.55 + energy * 0.4) *
            (1 - pose.rest * (compact ? 0.2 : 0.5)) *
            (1 + (activeWheel ? (0.18 + shine * 0.16) * pose.wheel : 0))
          if ((!compact || edgeToEdge) && strand % 2 === 0 && strand + 1 < strands) {
            this.quad(
              previous,
              next,
              point(u, strand + 1),
              point((i - 1) / segments, strand + 1),
              colour,
              alpha * (edgeToEdge ? 0.08 : 0.13),
            )
          }
          this.line(previous, next, compact ? 2.2 : 5, colour, alpha * (0.065 + shine * 0.14))
          this.line(previous, next, compact ? 1.2 : 2.2, colour, alpha * (0.2 + shine * 0.35))
          this.line(
            previous,
            next,
            compact ? 0.6 : 0.8,
            colour,
            Math.min(1, alpha * 1.4 + shine * 0.65),
          )
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
            activeWheel ? ACTIVE_ORANGE : GOLD,
            (1 - life) * 0.45 * pose.wheel,
          )
        }
      }
    }
    if (both) {
      drawBody(inputAudio, false, -height * 0.19, 0.46)
      drawBody(outputAudio, true, height * 0.19, 0.46)
    } else drawBody(output ? outputAudio : inputAudio, output, 0, 1)
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
