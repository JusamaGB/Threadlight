import { WORKSPACE_GUTTER } from './attentionMotion'

/** Shared by the header clip and the pinned header's muted pinstripe. */
export const headerWireColour = (connected: boolean) => (connected ? '#aacfd6' : '#737b86')

interface Span {
  key: string
  first: number
  last: number
}

/** Long overlapping routes hug the card; shorter ones step out. Disjoint groups reset. */
export function layoutWorkspaceWires(spans: Span[]) {
  const components: Span[][] = []
  let end = -Infinity
  for (const span of [...spans]
    .filter((s) => Number.isFinite(s.first) && Number.isFinite(s.last) && s.last > s.first)
    .sort((a, b) => a.first - b.first || a.key.localeCompare(b.key))) {
    if (span.first > end) components.push([])
    components.at(-1)!.push(span)
    end = Math.max(end, span.last)
  }
  return components.flatMap((component) => {
    const placed: (Span & { lane: number })[] = []
    for (const span of component.sort(
      (a, b) =>
        b.last - b.first - (a.last - a.first) || a.first - b.first || a.key.localeCompare(b.key),
    )) {
      let lane = 0
      for (const other of placed)
        if (span.first <= other.last && span.last >= other.first)
          lane = Math.max(lane, other.lane + 1)
      placed.push({ ...span, lane })
    }
    const step = Math.min(4, (WORKSPACE_GUTTER - 7) / Math.max(1, ...placed.map((s) => s.lane)))
    return placed.map((span) => ({ ...span, x: WORKSPACE_GUTTER - 4 - span.lane * step }))
  })
}

/**
 * Beside two columns the rail runs down the divider instead of the card's edge. The lanes
 * are the same ones layoutWorkspaceWires gives (longest first, overlapping ones one further
 * out), but "further out" has no single direction there: lane 0 is dead centre and the rest
 * step to either side of it, alternating, with spikes that reach further into the rows.
 */
export const CENTRE_HALF = 16
const CENTRE_STEP = 4
const CENTRE_REACH = 5
const CENTRE_REACH_STEP = 3

export const centreOffset = (lane: number) =>
  lane === 0
    ? 0
    : Math.min(CENTRE_HALF - 6, Math.ceil(lane / 2) * CENTRE_STEP) * (lane % 2 ? -1 : 1)

export const centreReach = (lane: number) =>
  Math.min(CENTRE_HALF - 1, CENTRE_REACH + CENTRE_REACH_STEP * lane)

/** One member of a wire: where its row's anchor sits, and which column the row is in. */
export interface CentreMember {
  y: number
  /** -1 for the left column, 1 for the right. */
  side: -1 | 1
}

/** The path for one wire, in a box CENTRE_HALF * 2 wide whose middle is the divider. */
export function centreWirePath(
  members: CentreMember[],
  lane: number,
  radius = 3,
): { first: number; last: number; path: string } {
  const sorted = [...members].sort((a, b) => a.y - b.y)
  const x = CENTRE_HALF + centreOffset(lane)
  const reach = centreReach(lane)
  const start = (member: CentreMember) => CENTRE_HALF + member.side * reach
  const head = sorted[0]!
  const tail = sorted.at(-1)!
  const r = Math.min(radius, (tail.y - head.y) / 2)
  const toward = (member: CentreMember) => Math.sign(start(member) - x)
  let path = `M ${start(head)} ${head.y} H ${x + toward(head) * r} Q ${x} ${head.y} ${x} ${head.y + r} V ${tail.y - r} Q ${x} ${tail.y} ${x + toward(tail) * r} ${tail.y} H ${start(tail)}`
  for (const member of sorted.slice(1, -1)) path += ` M ${x} ${member.y} H ${start(member)}`
  return { first: head.y, last: tail.y, path }
}
