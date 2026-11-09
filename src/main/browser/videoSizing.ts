import { screen, type BrowserWindow, type Rectangle } from 'electron'
import type { VideoGripGesture } from '../../shared/browser'

// Transparent margins around the painted card match the fullscreen grips in Panel.module.css.
const LEFT = 12
const RIGHT = 4
const BOTTOM = 4

export type VideoPanelLayout = {
  dx: number
  dy: number
  width: number
  height: number
  viewport: Electron.Size
}

export class VideoPanelSizing {
  active = false
  private restore?: Rectangle
  private drag?: {
    edge: 'left' | 'right' | 'crop'
    card: Rectangle
    guest: Rectangle
    area: Rectangle
  }

  constructor(private panel: BrowserWindow) {}

  get sized() {
    return !!this.restore
  }
  get dragging() {
    return !!this.drag
  }
  resume(layout: VideoPanelLayout) {
    if (this.sized) return
    const before = this.panel.getContentBounds()
    this.restore = before
    this.fit(before.x + layout.dx, before.y + layout.dy, layout.width, layout.height)
  }

  fitViewport(viewport: Electron.Size, insets: Electron.Size) {
    if (!this.sized || this.dragging) return
    const bounds = this.panel.getContentBounds()
    const width = Math.round(viewport.width + insets.width)
    const height = Math.round(viewport.height + insets.height)
    if (bounds.width !== width || bounds.height !== height)
      this.fit(bounds.x, bounds.y, width, height)
  }

  private fit(x: number, y: number, width: number, height: number) {
    const area = screen.getDisplayMatching(this.panel.getContentBounds()).workArea
    width = Math.min(width, area.width)
    height = Math.min(height, area.height)
    this.panel.setContentBounds({
      x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
      width,
      height,
    })
  }

  reset() {
    this.active = false
    this.drag = undefined
    const before = this.restore
    this.restore = undefined
    if (before && !this.panel.isDestroyed()) this.panel.setContentBounds(before)
  }

  gesture(input: VideoGripGesture, guest: Rectangle, aspect: number): VideoPanelLayout | undefined {
    if (input.phase === 'end') {
      this.drag = undefined
      return
    }
    if (input.phase === 'begin') {
      const bounds = this.panel.getContentBounds()
      this.drag = {
        edge: input.edge,
        card: { ...input.card, x: bounds.x + input.card.x, y: bounds.y + input.card.y },
        guest,
        area: screen.getDisplayMatching(bounds).workArea,
      }
      return
    }
    if (!this.drag || (!this.sized && !input.dx && !input.dy)) return
    const { edge, card, guest: start, area } = this.drag
    const trimX = card.width - start.width
    const trimY = card.height - start.height
    const maxHeight = Math.max(1, area.y + area.height - card.y - trimY - BOTTOM)
    let width = start.width
    let height = start.height
    if (edge === 'crop') {
      // Stop when the letterbox is gone, before the site starts shrinking the picture.
      const floor = Math.min(height, Math.ceil(width / aspect))
      height = Math.min(maxHeight, Math.max(floor, height + input.dy))
    } else {
      const room =
        edge === 'left' ? card.x + card.width - area.x - LEFT : area.x + area.width - card.x - RIGHT
      const maxScale = Math.min((room - trimX) / width, maxHeight / height)
      const minScale = Math.max(180 / width, 90 / height)
      // Project the drag onto the diagonal so horizontal and vertical motion both scale.
      const dx = edge === 'left' ? -input.dx : input.dx
      const scale = 1 + (width * dx + height * input.dy) / (width * width + height * height)
      const bounded = Math.max(0, Math.min(maxScale, Math.max(minScale, scale)))
      width = Math.max(1, Math.round(width * bounded))
      height = Math.max(1, Math.round(height * bounded))
    }
    const cardWidth = width + trimX
    this.restore ??= this.panel.getContentBounds()
    const bounds = {
      x: Math.round(card.x - LEFT + (edge === 'left' ? card.width - cardWidth : 0)),
      y: Math.round(card.y),
      width: Math.round(cardWidth + LEFT + RIGHT),
      height: Math.round(height + trimY + BOTTOM),
    }
    this.panel.setContentBounds(bounds)
    return {
      dx: bounds.x - this.restore.x,
      dy: bounds.y - this.restore.y,
      width: bounds.width,
      height: bounds.height,
      viewport: { width, height },
    }
  }
}
