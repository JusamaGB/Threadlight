import { describe, expect, it } from 'vitest'
import {
  CENTRE_HALF,
  centreWirePath,
  layoutWorkspaceWires,
  placeCentreWires,
} from '../src/shared/workspaceWires'

const span = (key: string, first: number, last: number) => ({ key, first, last })
const byKey = (input: ReturnType<typeof layoutWorkspaceWires>) =>
  Object.fromEntries(input.map((s) => [s.key, s]))

describe('workspace wire lanes', () => {
  it('keeps the longest closest even when a shorter group starts higher', () => {
    const routes = byKey(
      layoutWorkspaceWires([span('short', 0, 30), span('long', 10, 100), span('inner', 40, 50)]),
    )
    expect(routes.long!.x).toBe(12)
    expect(routes.short!.x).toBe(8)
    expect(routes.inner!.x).toBe(8)
  })

  it('steps nested spans outward in length order', () => {
    const routes = byKey(
      layoutWorkspaceWires([span('inner', 30, 40), span('middle', 20, 50), span('outer', 0, 100)]),
    )
    expect([routes.outer!.x, routes.middle!.x, routes.inner!.x]).toEqual([12, 8, 4])
  })

  it('resets separate groups to the closest lane and their own spacing', () => {
    const routes = byKey(
      layoutWorkspaceWires([
        span('a', 0, 100),
        span('b', 10, 50),
        span('c', 200, 230),
        span('d', 205, 215),
      ]),
    )
    expect([routes.a!.x, routes.b!.x, routes.c!.x, routes.d!.x]).toEqual([12, 8, 12, 8])
  })

  it('keeps shorter crossing routes outside longer overlapping ones', () => {
    const routes = byKey(
      layoutWorkspaceWires([span('long', 100, 300), span('medium', 40, 200), span('short', 0, 50)]),
    )
    expect(routes.long!.x).toBeGreaterThan(routes.medium!.x)
    expect(routes.medium!.x).toBeGreaterThan(routes.short!.x)
  })

  it('fits crowded groups in the gutter without wrapping shorter wires back inward', () => {
    const routes = layoutWorkspaceWires(
      Array.from({ length: 8 }, (_, i) => span(String(i), i, 100 - i)),
    )
    expect(new Set(routes.map((s) => s.x)).size).toBe(8)
    expect(routes.map((s) => s.x)).toEqual([...routes.map((s) => s.x)].sort((a, b) => b - a))
    expect(Math.min(...routes.map((s) => s.x))).toBeGreaterThanOrEqual(3)
    expect(routes[0]!.x).toBe(12)
  })

  it('uses measured spans after expansion, with stable ties and scroll offsets', () => {
    const input = [span('b', -40, 10), span('a', -30, 20)]
    expect(layoutWorkspaceWires(input)).toEqual(layoutWorkspaceWires([...input].reverse()))
    expect(byKey(layoutWorkspaceWires(input)).b!.x).toBe(12)
    expect(byKey(layoutWorkspaceWires([input[0]!, span('a', -30, 50)])).a!.x).toBe(12)
    expect(input).toEqual([span('b', -40, 10), span('a', -30, 20)])
  })
})

describe('workspace wires down the centre', () => {
  const m = (y: number, side: -1 | 1) => ({ y, side })
  const slots = (spans: Parameters<typeof placeCentreWires>[0]) =>
    Object.fromEntries(placeCentreWires(spans).map((p) => [p.key, p.offset]))

  it('keeps a group on the side its threads are on, and a mixed one in the middle', () => {
    expect(
      slots([
        { key: 'mixed', members: [m(0, -1), m(100, 1)] },
        { key: 'codex', members: [m(10, 1), m(90, 1)] },
        { key: 'claude', members: [m(20, -1), m(80, -1)] },
      ]),
    ).toEqual({ mixed: 0, codex: 3, claude: -3 })
  })

  it('puts a longer group first, so a shorter overlapping one takes the next preferred slot', () => {
    expect(
      slots([
        { key: 'long', members: [m(0, 1), m(200, 1)] },
        { key: 'short', members: [m(50, 1), m(100, 1)] },
        { key: 'shortest', members: [m(60, 1), m(70, 1)] },
      ]),
    ).toEqual({ long: 3, short: 0, shortest: -3 })
  })

  it('resets for groups that do not overlap, and shares a slot when all three are taken', () => {
    expect(
      slots([
        { key: 'a', members: [m(0, 1), m(40, 1)] },
        { key: 'b', members: [m(100, 1), m(140, 1)] },
      ]),
    ).toEqual({ a: 3, b: 3 })
    const crowded = slots(
      ['a', 'b', 'c', 'd'].map((key, i) => ({ key, members: [m(i, 1), m(100 - i, 1)] })),
    )
    expect(Object.values(crowded).every((offset) => Math.abs(offset) <= 3)).toBe(true)
  })

  it('draws short spikes, with a rounded end and a filleted branch', () => {
    const path = centreWirePath([m(100, 1), m(20, -1), m(60, 1)], 0)
    expect(path).toBe(
      `M ${CENTRE_HALF - 4} 20 H ${CENTRE_HALF - 4} Q ${CENTRE_HALF} 20 ${CENTRE_HALF} 24 V 96 Q ${CENTRE_HALF} 100 ${CENTRE_HALF + 4} 100 H ${CENTRE_HALF + 4} M ${CENTRE_HALF} 57 Q ${CENTRE_HALF} 60 ${CENTRE_HALF + 3} 60 H ${CENTRE_HALF + 4}`,
    )
  })

  it('never lets a spike run more than 9 px from the divider', () => {
    for (const offset of [-3, 0, 3])
      for (const side of [-1, 1] as const) {
        const ends = centreWirePath([m(0, side), m(50, side)], offset).match(/H (-?[\d.]+)/g)!
        for (const end of ends)
          expect(Math.abs(Number(end.slice(2)) - CENTRE_HALF)).toBeLessThanOrEqual(9)
      }
  })
})
