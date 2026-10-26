import { describe, expect, it } from 'vitest'
import { IDLE_MOTION, SILENT_AUDIO, motionMode, readMotion } from '../src/shared/motion'
import { advancePose, MotionGeometry, restingPose } from '../src/renderer/motion/geometry'

const full = { level: 1, low: 1, mid: 1, high: 1 }
describe('motion state and telemetry', () => {
  const context = {
    recording: 'idle',
    microphone: true,
    agent: 'ready',
    waitingForReply: false,
    failed: false,
  }
  it('keeps silence distinct from thinking and approval waits', () => {
    expect(motionMode(context)).toBe('listening')
    expect(motionMode({ ...context, agent: 'working' })).toBe('thinking')
    expect(motionMode({ ...context, waitingForReply: true })).toBe('thinking')
    expect(motionMode({ ...context, agent: 'waiting' })).toBe('waiting')
    expect(motionMode({ ...context, recording: 'listening', agent: 'working' })).toBe('listening')
    expect(motionMode({ ...context, failed: true })).toBe('error')
  })
  it('rejects malformed telemetry and bounds every audio band', () => {
    expect(readMotion({ ...IDLE_MOTION, input: { ...full, level: NaN } })).toBeNull()
    expect(readMotion({ ...IDLE_MOTION, mode: 'complete' })).toBeNull()
    expect(readMotion({ ...IDLE_MOTION, output: null })).toBeNull()
    expect(
      readMotion({ ...IDLE_MOTION, input: { level: 20, low: -2, mid: 0.5, high: 1 } })?.input,
    ).toEqual({ level: 1, low: 0, mid: 0.5, high: 1 })
  })
  it('opens quickly on speech and releases smoothly on silence', () => {
    const pose = restingPose()
    for (let i = 0; i < 60; i++) advancePose(pose, { ...IDLE_MOTION, mode: 'thinking' }, 16)
    expect(pose.wheel).toBeGreaterThan(0.99)
    for (let i = 0; i < 7; i++)
      advancePose(pose, { ...IDLE_MOTION, mode: 'thinking', input: full }, 16)
    expect(pose.input.level).toBeGreaterThan(0.9)
    expect(pose.wheel).toBeLessThan(0.21)
    advancePose(pose, { ...IDLE_MOTION, mode: 'listening' }, 16)
    expect(pose.input.level).toBeGreaterThan(0.7)
    for (let i = 0; i < 70; i++) advancePose(pose, { ...IDLE_MOTION, mode: 'listening' }, 16)
    expect(pose.input.level).toBeLessThan(0.002)
  })
  it('responds equally across refresh rates', () => {
    const a = restingPose(),
      b = restingPose()
    const snapshot = { ...IDLE_MOTION, mode: 'listening', input: full }
    for (let i = 0; i < 60; i++) advancePose(a, snapshot, 1000 / 60)
    for (let i = 0; i < 120; i++) advancePose(b, snapshot, 1000 / 120)
    expect(a.input.level).toBeCloseTo(b.input.level, 8)
  })
})

describe('ribbon and wheel geometry', () => {
  it('uses orange strands and a blue outward shine for active wheels on dot and header surfaces', () => {
    const mesh = new MotionGeometry()
    const pose = { ...restingPose(), wheel: 1, warmth: 1, rest: 0 }
    for (const [width, height, header] of [
      [22, 22, false],
      [342, 36, true],
    ]) {
      const vertices = mesh.build(width, height, 0.8, pose, false, header, true)
      let orange = 0,
        blue = 0
      for (let i = 0; i < vertices.length; i += 6) {
        if (vertices[i + 2] > vertices[i + 4] * 1.5) orange++
        if (vertices[i + 4] > vertices[i + 2] * 1.3) blue++
      }
      expect(orange).toBeGreaterThan(0)
      expect(blue).toBeGreaterThan(0)
      const still = [...mesh.build(width, height, 0, pose, true, header, true)]
      expect([...mesh.build(width, height, 100, pose, true, header, true)]).toEqual(still)
      for (let i = 0; i < still.length; i += 6)
        expect(still[i + 2]).toBeGreaterThan(still[i + 4] * 1.5)
    }
    // Selecting the active palette has no effect once the wheel has opened into voice ribbons.
    const speaking = { ...pose, wheel: 0, input: full }
    const ribbon = [...mesh.build(342, 36, 0.8, speaking, false, true, false)]
    expect([...mesh.build(342, 36, 0.8, speaking, false, true, true)]).toEqual(ribbon)
  })
  it.each([
    [22, 22],
    [50, 24],
    [280, 88],
    [310, 88],
  ])('fits the %i × %i surface through all morphs and overlapping speech', (width, height) => {
    const mesh = new MotionGeometry()
    for (const wheel of [0, 0.3, 0.7, 1]) {
      for (const output of [SILENT_AUDIO, full]) {
        for (let time = 0; time < 5; time += 0.4) {
          const vertices = mesh.build(
            width,
            height,
            time,
            { wheel, warmth: wheel, rest: 0, input: full, output },
            false,
          )
          expect(vertices.length).toBeLessThan(mesh.vertices.length)
          expect(vertices.length % 18).toBe(0)
          for (let i = 0; i < vertices.length; i += 6) {
            if (
              vertices[i] < -3 ||
              vertices[i] > width + 3 ||
              vertices[i + 1] < -3 ||
              vertices[i + 1] > height + 3
            )
              throw new Error(
                `Clipped geometry at ${width}x${height}: ${vertices[i]}, ${vertices[i + 1]}`,
              )
          }
        }
      }
    }
  })
  it('has no temporal movement with reduced motion', () => {
    const mesh = new MotionGeometry()
    const pose = { ...restingPose(), input: full, wheel: 0.4, rest: 0 }
    const first = [...mesh.build(300, 88, 0, pose, true)]
    expect([...mesh.build(300, 88, 500, pose, true)]).toEqual(first)
  })
})

describe('connected header motion', () => {
  const width = 342,
    height = 36,
    divider = 9
  const bounds = (vertices) => {
    const xs = [],
      ys = []
    for (let i = 0; i < vertices.length; i += 6) {
      xs.push(vertices[i])
      ys.push(vertices[i + 1])
    }
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    }
  }
  it('keeps microphone and playback energy out of every partially opened header pose', () => {
    const geometry = new MotionGeometry()
    for (const wheel of [1, 0.7, 0.3, 0.01, 0.0001]) {
      const pose = { ...restingPose(), rest: 0, wheel, warmth: wheel }
      for (const reduced of [false, true]) {
        const quiet = [...geometry.build(width, height, 0.8, pose, reduced, true)]
        for (const [input, output] of [
          [full, SILENT_AUDIO],
          [SILENT_AUDIO, full],
          [full, full],
        ]) {
          expect([
            ...geometry.build(width, height, 0.8, { ...pose, input, output }, reduced, true),
          ]).toEqual(quiet)
        }
      }
    }
    const open = { ...restingPose(), rest: 0 }
    const quiet = [...geometry.build(width, height, 0.8, open, false, true)]
    for (const [input, output] of [
      [full, SILENT_AUDIO],
      [SILENT_AUDIO, full],
      [full, full],
    ]) {
      expect([
        ...geometry.build(width, height, 0.8, { ...open, input, output }, false, true),
      ]).not.toEqual(quiet)
    }
  })
  it('finishes opening before easing live audio in, including another opening mid-task', () => {
    const pose = { ...restingPose(), wheel: 1, warmth: 1, rest: 0 }
    for (let cycle = 0; cycle < 2; cycle++) {
      let openingFrames = 0
      do {
        advancePose(
          pose,
          { ...IDLE_MOTION, mode: 'listening', input: full, output: full },
          1000 / 60,
          true,
        )
        if (pose.wheel > 0) {
          expect(pose.input).toEqual(SILENT_AUDIO)
          expect(pose.output).toEqual(SILENT_AUDIO)
          openingFrames++
        }
        expect(openingFrames).toBeLessThan(65)
      } while (pose.wheel > 0)
      expect(openingFrames).toBeGreaterThan(50)
      expect(pose.input.level).toBeGreaterThan(0)
      expect(pose.input.level).toBeLessThan(0.4)
      expect(pose.output).toEqual(pose.input)
      for (let i = 0; i < 30; i++)
        advancePose(
          pose,
          { ...IDLE_MOTION, mode: 'listening', input: full, output: full },
          1000 / 60,
          true,
        )
      expect(pose.input.level).toBeGreaterThan(0.98)
      for (let i = 0; i < 120; i++)
        advancePose(pose, { ...IDLE_MOTION, mode: 'thinking' }, 1000 / 60, true)
    }
  })
  it('keeps the wheel at the left wall on the divider and every morph inside the header surface', () => {
    const geometry = new MotionGeometry()
    for (const wheel of [0, 0.1, 0.3, 0.7, 1]) {
      for (let time = 0; time < 5; time += 0.2) {
        const pose = { ...restingPose(), rest: 0, wheel, warmth: wheel, input: full }
        const vertices = geometry.build(width, height, time, pose, false, true)
        const box = bounds(vertices)
        expect(box.left).toBeGreaterThanOrEqual(-2)
        expect(box.right).toBeLessThanOrEqual(width + 2)
        expect(box.top).toBeGreaterThan(0)
        expect(box.bottom).toBeLessThan(height)
        expect(box.left).toBeLessThan(1.6)
        if (wheel === 1) {
          expect(box.right).toBeLessThan(17)
          expect(Math.abs((box.top + box.bottom) / 2 - divider)).toBeLessThan(1.5)
        }
        if (wheel === 0) {
          expect(box.right - box.left).toBeGreaterThan(width - 1)
          expect(box.bottom - box.top).toBeGreaterThan(7)
        }
      }
    }
  })
  it('stretches the same strands continuously from the left wall to the right', () => {
    const geometry = new MotionGeometry()
    const pose = { ...restingPose(), wheel: 1, warmth: 1, rest: 0 }
    let previous = [...geometry.build(width, height, 0, pose, false, true)]
    const start = bounds(previous)
    for (let i = 0; i < 60; i++) {
      advancePose(pose, { ...IDLE_MOTION, mode: 'thinking', input: full }, 1000 / 60, true)
      const vertices = [...geometry.build(width, height, 0, pose, false, true)]
      expect(vertices.length).toBe(previous.length)
      // Follow each stroke's centre rather than the halo's changing normal at a fold.
      for (let j = 0; j < vertices.length; j += 36) {
        const dx = (vertices[j] + vertices[j + 30] - previous[j] - previous[j + 30]) / 2
        const dy = (vertices[j + 1] + vertices[j + 31] - previous[j + 1] - previous[j + 31]) / 2
        expect(Math.abs(dx)).toBeLessThan(32)
        expect(Math.abs(dy)).toBeLessThan(2)
      }
      previous = vertices
    }
    const end = bounds(previous)
    expect(end.right - end.left).toBeGreaterThan(330)
    expect(start.right).toBeLessThan(17)
    expect(end.left).toBeLessThan(2)
    expect(end.right).toBeGreaterThan(width - 2)
    expect(pose.wheel).toBeLessThan(0.01)
  })
  it('evolves colour smoothly without a repeated sweep, including a quiet waveform', () => {
    const geometry = new MotionGeometry()
    const colours = (time, reduced = false) =>
      [...geometry.build(width, height, time, restingPose(), reduced, true)].filter(
        (_, index) => index % 6 >= 2 && index % 6 <= 4,
      )
    const a = colours(1),
      b = colours(1 + 1 / 60)
    expect(a).not.toEqual(b)
    expect(Math.max(...a.map((value, index) => Math.abs(value - b[index])))).toBeLessThan(0.04)
    expect(colours(0)).not.toEqual(colours(50))
    expect(colours(0)).not.toEqual(colours(100))
    expect(colours(0, true)).toEqual(colours(500, true))
  })
})
