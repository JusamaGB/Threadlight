import { WORKSPACE_GUTTER } from './attentionMotion'

/** A rectangle inside the panel window, in window pixels, that stays clickable in the gutter. */
export interface GutterRegion {
  x: number
  y: number
  width: number
  height: number
}

const MAX_REGIONS = 64

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Renderer input is untrusted: keep only well-formed regions of a sensible size. */
export function parseGutterRegions(value: unknown): GutterRegion[] {
  if (!Array.isArray(value)) return []
  const regions: GutterRegion[] = []
  for (const item of value.slice(0, MAX_REGIONS)) {
    if (typeof item !== 'object' || !item) continue
    const { x, y, width, height } = item as Record<string, unknown>
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) continue
    if (x < 0 || x > 64 || y < 0 || y > 32768) continue
    if (width <= 0 || width > 64 || height <= 0 || height > 32768) continue
    regions.push({ x, y, width, height })
  }
  return regions
}

export function inGutterRegion(regions: GutterRegion[], point: { x: number; y: number }): boolean {
  return regions.some(
    (r) => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height,
  )
}

/** The thin clickable strip along one wire's vertical rail, kept inside the gutter. */
export function wireRegion(
  gutterLeft: number,
  rail: number,
  top: number,
  first: number,
  last: number,
): GutterRegion {
  const grab = 4
  const left = Math.max(gutterLeft, gutterLeft + rail - grab)
  const right = Math.min(gutterLeft + WORKSPACE_GUTTER, gutterLeft + rail + grab)
  return {
    x: left,
    y: Math.max(0, top + first - grab),
    width: Math.max(1, right - left),
    height: Math.max(1, last - first + 2 * grab),
  }
}
