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
