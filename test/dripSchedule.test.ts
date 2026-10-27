import { describe, expect, it } from 'vitest'
import {
  ATTENTION_CYCLE,
  DripSchedule,
  MAX_ATTENTION_DRIPS,
  dripClock,
  dripSpacing,
  formingScale,
} from '../src/shared/dripSchedule'
import type { Provider } from '../src/shared/types'

const FORMING = 1.512
/** Forming at its own pace, a half-second fall and a 1.2 s splash. */
const life = (scale: number) => FORMING * scale + 0.5 + 1.2
const schedule = () => new DripSchedule(FORMING, life)
/** A start time sits on the drip grid (floating point makes `%` unreliable for 0.6). */
const onGrid = (start: number, spacing: number) =>
  Math.abs(start - Math.round(start / spacing) * spacing) < 1e-6
const A: Provider = 'claude'
const B: Provider = 'codex'

describe('dripSpacing and formingScale', () => {
  it('shares the cycle between the waiting threads, up to ten', () => {
    expect(ATTENTION_CYCLE).toBe(6)
    expect([1, 2, 3, 6, 10].map(dripSpacing)).toEqual([6, 3, 2, 1, 0.6])
    expect(dripSpacing(0)).toBe(6)
    expect(dripSpacing(25)).toBe(dripSpacing(MAX_ATTENTION_DRIPS))
  })

  it('forms at the normal pace when drips are far apart and faster as they close in', () => {
    expect(formingScale(1, FORMING)).toBe(1)
    expect(formingScale(2, FORMING)).toBe(1)
    expect(formingScale(10, FORMING)).toBeCloseTo((0.92 * 0.6) / FORMING, 5)
    expect(formingScale(10, FORMING)).toBeLessThan(formingScale(4, FORMING))
    // Each drop is released before the next one starts forming.
    for (let n = 1; n <= MAX_ATTENTION_DRIPS; n++)
      expect(FORMING * formingScale(n, FORMING)).toBeLessThan(dripSpacing(n))
    expect(formingScale(10, 100)).toBe(0.2)
  })

  it('stretches the forming clock but leaves the fall in real time', () => {
    const scale = 0.5
    expect(dripClock(0, scale, FORMING)).toBe(0)
    expect(dripClock(FORMING * scale, scale, FORMING)).toBeCloseTo(FORMING, 8)
    expect(dripClock(FORMING * scale * 0.5, scale, FORMING)).toBeCloseTo(FORMING * 0.5, 8)
    expect(dripClock(FORMING * scale + 0.3, scale, FORMING)).toBeCloseTo(FORMING + 0.3, 8)
  })
})

describe('DripSchedule', () => {
  it('shows nothing without a waiting thread', () => {
    expect(schedule().update(100, [])).toEqual([])
  })

  it('always shows the same drips for a given clock', () => {
    const providers = [A, B, B]
    const first = schedule().update(1300, providers)
    const second = schedule().update(1300, providers)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    for (const drip of first) expect(onGrid(drip.start, dripSpacing(3))).toBe(true)
  })

  it('releases one drip per thread in order, round and round, one spacing apart', () => {
    const drips = schedule()
    const providers = [A, B, B]
    const seen: Provider[] = []
    const starts: number[] = []
    for (let now = 100; now < 112; now += 0.05) {
      for (const drip of drips.update(now, providers)) {
        if (!starts.includes(drip.start)) {
          starts.push(drip.start)
          seen.push(drip.provider)
        }
      }
    }
    // Slot indexes decide the colour, so the sequence is the list repeated.
    const first = Math.round(starts[0]! / dripSpacing(3))
    const expected = starts.map((_, i) => providers[(first + i) % 3])
    expect(seen).toEqual(expected)
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeCloseTo(2, 8)
  })

  it('lets drops already falling carry on when a thread is answered, then speeds the pace', () => {
    const drips = schedule()
    for (let now = 100; now < 103; now += 0.05) drips.update(now, [A])
    const before = drips.update(103, [A]).map((drip) => drip.start)
    expect(before.length).toBeGreaterThan(0)
    const after = drips.update(103.05, [A, B, A, B, A, B])
    for (const start of before) expect(after.some((drip) => drip.start === start)).toBe(true)
    // With six waiting the next drip is due one second later at most, not six.
    let next = after.length
    for (let now = 103.1; now < 104.2; now += 0.05)
      next = drips.update(now, [A, B, A, B, A, B]).length
    expect(next).toBeGreaterThan(before.length)
  })

  it('rebuilds from the clock after a long pause instead of releasing a flood', () => {
    const drips = schedule()
    drips.update(100, [A, B])
    const resumed = drips.update(5000, [A, B])
    expect(resumed.length).toBeLessThanOrEqual(Math.ceil(life(1) / dripSpacing(2)) + 1)
    for (const drip of resumed) expect(5000 - drip.start).toBeLessThan(life(drip.scale))
  })

  it('drops a drip once its splash has settled', () => {
    const drips = schedule()
    drips.update(100, [A])
    const later = drips.update(100 + life(1) + 0.01, [A])
    for (const drip of later)
      expect(100 + life(1) + 0.01 - drip.start).toBeLessThan(life(drip.scale))
  })

  it('never keeps more than ten threads in the rotation', () => {
    const many = Array.from({ length: 14 }, (_, i): Provider => (i % 2 ? B : A))
    const drips = schedule().update(1300, many)
    for (const drip of drips) expect(onGrid(drip.start, dripSpacing(10))).toBe(true)
  })
})
