export const DOT_SIZE = 32
export const MIC_PILL_WIDTH = 92
export const MIC_PILL_HEIGHT = 18

type Point = { x: number; y: number }
type Bounds = Point & { width: number; height: number }

/** Grow inward from the dot's saved anchor, without moving that anchor. */
export function micIndicatorBounds(anchor: Point, area: Bounds, live: boolean): Bounds {
  const width = live ? MIC_PILL_WIDTH : DOT_SIZE
  const height = live ? MIC_PILL_HEIGHT : DOT_SIZE
  const right = anchor.x + DOT_SIZE / 2 > area.x + area.width / 2
  const bottom = anchor.y + DOT_SIZE / 2 > area.y + area.height / 2
  return {
    x: Math.max(
      area.x,
      Math.min(anchor.x + (right ? DOT_SIZE - width : 0), area.x + area.width - width),
    ),
    y: Math.max(
      area.y,
      Math.min(anchor.y + (bottom ? DOT_SIZE - height : 0), area.y + area.height - height),
    ),
    width,
    height,
  }
}
