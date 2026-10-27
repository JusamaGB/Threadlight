import { WORKSPACE_GUTTER } from './attentionMotion'

/** Shared by the header clip and the pinned panel's perimeter. */
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
