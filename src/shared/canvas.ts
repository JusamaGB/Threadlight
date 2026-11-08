export interface Viewport {
  x: number
  y: number
  zoom: number
}
export const initialViewport: Viewport = { x: 12, y: 12, zoom: 1 }
export function zoomAt(v: Viewport, factor: number, x: number, y: number): Viewport {
  const zoom = Math.max(0.02, Math.min(2, v.zoom * factor))
  return { zoom, x: x - ((x - v.x) * zoom) / v.zoom, y: y - ((y - v.y) * zoom) / v.zoom }
}
export function fitCanvas(
  width: number,
  height: number,
  contentWidth: number,
  contentHeight: number,
): Viewport {
  const zoom = Math.max(
    0.02,
    Math.min(1, (width - 24) / contentWidth, (height - 24) / contentHeight),
  )
  return { x: 12, y: 12, zoom }
}
export function squareOverlay(
  area: { x: number; y: number; width: number; height: number },
  anchor: { x: number; y: number },
) {
  const side = Math.max(1, Math.min(900, area.width, area.height))
  return {
    x: Math.max(area.x, Math.min(anchor.x, area.x + area.width - side)),
    y: Math.max(area.y, Math.min(anchor.y, area.y + area.height - side)),
    width: side,
    height: side,
  }
}
