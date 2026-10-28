import { describe, expect, it } from 'vitest'
import {
  CENTRE_HALF,
  centreWirePath,
  layoutWorkspaceWires,
  placeCentreWires,
  routeWorkspaceWires,
  rightWireGutter,
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

describe('workspace wire routing by provider', () => {
  const m = (y: number, side: -1 | 1) => ({ y, side })
  const groups = [
    { key: 'claude', members: [m(20, -1), m(100, -1), m(60, -1)] },
    { key: 'codex', members: [m(20, 1), m(100, 1), m(60, 1)] },
    { key: 'shared', members: [m(10, -1), m(110, 1)] },
  ]

  it('routes one complete group to each of the three zones', () => {
    const routes = routeWorkspaceWires(groups, true)
    expect(routes.map(({ key, zone }) => [key, zone])).toEqual([
      ['claude', 'left'],
      ['codex', 'right'],
      ['shared', 'centre'],
    ])
    expect(routes.map(({ lane }) => lane)).toEqual([0, 0, 0])
    expect(routes.map(({ x }) => x)).toEqual([12, 4, CENTRE_HALF])
    expect(groups[0]!.members.map(({ y }) => y)).toEqual([20, 100, 60])
  })

  it('reserves only the right rails in use plus their backing stroke', () => {
    expect(rightWireGutter(routeWorkspaceWires(groups, true))).toBe(6)
    expect(rightWireGutter(routeWorkspaceWires(groups, false))).toBe(0)
    expect(
      rightWireGutter(
        routeWorkspaceWires(
          groups.filter((g) => g.key !== 'codex'),
          true,
        ),
      ),
    ).toBe(0)
    expect(
      rightWireGutter(
        routeWorkspaceWires(
          [...groups, { key: 'short-codex', members: [m(40, 1), m(80, 1)] }],
          true,
        ),
      ),
    ).toBe(10)
    expect(
      rightWireGutter(
        routeWorkspaceWires(
          Array.from({ length: 8 }, (_, i) => ({
            key: String(i),
            members: [m(i, 1), m(100 - i, 1)],
          })),
          true,
        ),
      ),
    ).toBe(15)
  })

  it('mirrors outer routes so their endpoints face the card on both sides', () => {
    const routes = routeWorkspaceWires(groups, true)
    expect(routes[0]!.path).toBe(
      'M 16 20 H 15 Q 12 20 12 23 V 97 Q 12 100 15 100 H 16 M 12 60 H 16',
    )
    expect(routes[1]!.path).toBe('M 0 20 H 1 Q 4 20 4 23 V 97 Q 4 100 1 100 H 0 M 4 60 H 0')
  })

  it('allocates overlapping lanes independently of other zones', () => {
    const routes = routeWorkspaceWires(
      [
        ...groups,
        { key: 'short-left', members: [m(40, -1), m(80, -1)] },
        { key: 'short-right', members: [m(40, 1), m(80, 1)] },
        { key: 'short-shared', members: [m(40, -1), m(80, 1)] },
      ],
      true,
    )
    expect(Object.fromEntries(routes.map(({ key, lane }) => [key, lane]))).toEqual({
      claude: 0,
      codex: 0,
      shared: 0,
      'short-left': 1,
      'short-right': 1,
      'short-shared': -3,
    })
  })

  it('reclassifies membership changes and merges all providers into the single left gutter', () => {
    const changed = groups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member, side: 1 as const })),
    }))
    expect(routeWorkspaceWires(changed, true).every(({ zone }) => zone === 'right')).toBe(true)
    const single = routeWorkspaceWires(groups, false)
    expect(single).toHaveLength(3)
    expect(single.every(({ zone }) => zone === 'left')).toBe(true)
    expect(single.some(({ lane }) => lane > 0)).toBe(true)
  })

  it('connects shared threads aligned at the same height across the columns', () => {
    const routes = routeWorkspaceWires([{ key: 'aligned', members: [m(20, -1), m(20, 1)] }], true)
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ zone: 'centre', lane: 0 })
    expect(routes[0]!.path).not.toMatch(/NaN|Infinity/)
    expect(routes[0]!.path).toContain('M 12 20')
    expect(routes[0]!.path).toContain('H 20')
  })

  it('ignores singleton and invalid groups and is stable when the input order changes', () => {
    expect(
      routeWorkspaceWires(
        [
          { key: 'empty', members: [] },
          { key: 'singleton', members: [m(1, 1)] },
          { key: 'invalid', members: [m(1, -1), m(NaN, 1)] },
        ],
        true,
      ),
    ).toEqual([])
    expect(routeWorkspaceWires(groups, true)).toEqual(
      routeWorkspaceWires([...groups].reverse(), true),
    )
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
