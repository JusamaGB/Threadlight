import type { Rectangle } from 'electron'
import { boundsAtDot } from '../shared/micIndicator'

/** Reserve header space for the real indicator above the complete reference surface. */
export function referencePlacement(
  dot: Rectangle,
  indicator: Rectangle,
  area: Rectangle,
  width: number,
  height: number,
) {
  const bounds = boundsAtDot(dot, area, Math.min(width, area.width), Math.min(height, area.height))
  const right = dot.x + dot.width / 2 > area.x + area.width / 2
  const bottom = dot.y + dot.height / 2 > area.y + area.height / 2
  return {
    bounds,
    anchor: { right, bottom, width: indicator.width, height: indicator.height },
  }
}
