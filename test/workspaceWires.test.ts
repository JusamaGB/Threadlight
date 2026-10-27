import { describe, expect, it } from 'vitest'
import {
  CENTRE_HALF,
  centreOffset,
  centreReach,
  centreWirePath,
  layoutWorkspaceWires,
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
  it('puts the longest lane dead centre and alternates the rest either side', () => {
    expect([0, 1, 2, 3, 4].map(centreOffset)).toEqual([0, -4, 4, -8, 8])
  })

  it('keeps every lane inside the strip, with spikes reaching further as lanes step out', () => {
    for (let lane = 0; lane < 12; lane++) {
      expect(Math.abs(centreOffset(lane))).toBeLessThan(CENTRE_HALF)
      expect(centreReach(lane)).toBeLessThan(CENTRE_HALF)
    }
    expect(centreReach(1)).toBeGreaterThan(centreReach(0))
    expect(centreReach(2)).toBeGreaterThan(centreReach(1))
  })

  it('draws a spike from each thread, either side of the divider, to the rail', () => {
    const { first, last, path } = centreWirePath(
      [
        { y: 100, side: 1 },
        { y: 20, side: -1 },
        { y: 60, side: 1 },
      ],
      0,
    )
    expect([first, last]).toEqual([20, 100])
    expect(path).toBe(
      `M ${CENTRE_HALF - 5} 20 H ${CENTRE_HALF - 3} Q ${CENTRE_HALF} 20 ${CENTRE_HALF} 23 V 97 Q ${CENTRE_HALF} 100 ${CENTRE_HALF + 3} 100 H ${CENTRE_HALF + 5} M ${CENTRE_HALF} 60 H ${CENTRE_HALF + 5}`,
    )
  })
})
