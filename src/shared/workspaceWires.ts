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
 * Beside two columns the rail runs down the divider instead of the card's edge, in three
 * slots 3 px apart: the Claude side, the middle and the Codex side. A group sits on the side
 * its threads are on (the middle when it has both), longer groups choose first, and a group
 * that overlaps one already in its slot takes the next preferred one. When all are taken it
 * shares, drawn on top; only one group is lit at a time, so the overlap does not matter.
 */
export const CENTRE_HALF = 16
const SLOT_STEP = 3
export const CENTRE_SLOTS = [-1, 0, 1] as const
const PREFERRED: Record<'left' | 'both' | 'right', number[]> = {
  both: [0, -1, 1],
  right: [1, 0, -1],
  left: [-1, 0, 1],
}
/** Spikes stay short: a few pixels past the rail on a row's side, never far into its text. */
const SPIKE = 3
const SPIKE_MIN = 4
const SPIKE_MAX = 9

/** One member of a wire: where its row's anchor sits, and which column the row is in. */
export interface CentreMember {
  y: number
  /** -1 for the left column, 1 for the right. */
  side: -1 | 1
}

export interface CentreSpan {
  key: string
  members: CentreMember[]
}

/** Which slot (an offset from the divider, in px) each group's rail takes. */
export function placeCentreWires(spans: CentreSpan[]): { key: string; offset: number }[] {
  const ranged = spans
    .map((span) => {
      const ys = span.members.map((m) => m.y)
      const sides = new Set(span.members.map((m) => m.side))
      return {
        key: span.key,
        first: Math.min(...ys),
        last: Math.max(...ys),
        zone:
          sides.size > 1
            ? ('both' as const)
            : sides.has(1)
              ? ('right' as const)
              : ('left' as const),
      }
    })
    .filter((s) => Number.isFinite(s.first) && s.last > s.first)
    .sort((a, b) => b.last - b.first - (a.last - a.first) || a.key.localeCompare(b.key))
  const used = new Map<number, typeof ranged>()
  return ranged.map((span) => {
    const clashes = (slot: number) =>
      (used.get(slot) ?? []).filter((o) => span.first <= o.last && span.last >= o.first).length
    const order = PREFERRED[span.zone]
    const slot =
      order.find((o) => clashes(o) === 0) ?? [...order].sort((a, b) => clashes(a) - clashes(b))[0]!
    used.set(slot, [...(used.get(slot) ?? []), span])
    return { key: span.key, offset: slot * SLOT_STEP }
  })
}

/** How far from the divider a member's spike ends: just past the rail on its own side. */
const spikeEnd = (offset: number, side: number) =>
  side *
  Math.min(SPIKE_MAX, offset * side > 0 ? Math.abs(offset) + SPIKE : SPIKE_MIN + Math.abs(offset))

/**
 * The path for one wire, in a box CENTRE_HALF * 2 wide whose middle is the divider. The two
 * ends of the rail curve into their spikes; the spikes between branch off it with a fillet.
 */
export function centreWirePath(
  members: CentreMember[],
  offset: number,
  radius = 4,
  fillet = 3,
): string {
  const sorted = [...members].sort((a, b) => a.y - b.y)
  const x = CENTRE_HALF + offset
  const end = (member: CentreMember) => CENTRE_HALF + spikeEnd(offset, member.side)
  const toward = (member: CentreMember) => Math.sign(end(member) - x) || 1
  const head = sorted[0]!
  const tail = sorted.at(-1)!
  const r = Math.min(radius, (tail.y - head.y) / 2)
  let path = `M ${end(head)} ${head.y} H ${x + toward(head) * r} Q ${x} ${head.y} ${x} ${head.y + r} V ${tail.y - r} Q ${x} ${tail.y} ${x + toward(tail) * r} ${tail.y} H ${end(tail)}`
  for (const member of sorted.slice(1, -1))
    path += ` M ${x} ${member.y - fillet} Q ${x} ${member.y} ${x + toward(member) * fillet} ${member.y} H ${end(member)}`
  return path
}
