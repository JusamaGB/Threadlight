// The two windows: the dot, and the panel that opens in its place.

import { join } from 'node:path'

import { BrowserWindow, screen, shell, type Rectangle } from 'electron'

import { IPC, type PanelOpened } from '../shared/ipc'
import { loadDotPosition, saveDotPosition, type Point } from './windowState'
import { DOT_SIZE, micIndicatorBounds } from '../shared/micIndicator'

export { DOT_SIZE }
export const PANEL_WIDTH = 342 // 340 of content plus a 1 px border each side
const MARGIN = 8

export const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const
export type Corner = (typeof CORNERS)[number]

export const isCorner = (value: unknown): value is Corner => CORNERS.includes(value as Corner)

/** Where the dot sits in a corner of a screen's work area, the same small gap from each edge. */
export function cornerPosition(corner: Corner, area: Rectangle): Point {
  const left = area.x + MARGIN
  const right = area.x + area.width - DOT_SIZE - MARGIN
  const top = area.y + MARGIN
  const bottom = area.y + area.height - DOT_SIZE - MARGIN
  return {
    x: corner.endsWith('left') ? left : right,
    y: corner.startsWith('top') ? top : bottom,
  }
}

type View = 'dot' | 'panel'

/** Shared hardening for every window: no navigation away, no pop-ups, links open in the browser. */
function harden(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createWindow(view: View, size: { width: number; height: number }, focusable: boolean) {
  const win = new BrowserWindow({
    ...size,
    frame: false,
    transparent: true,
    resizable: false,
    // Keep application-imposed minima below the compact indicator's dimensions.
    minWidth: 1,
    minHeight: 1,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The hidden panel records for the talk hotkey, so its timers must keep running.
      backgroundThrottling: false,
    },
  })
  // 'screen-saver' keeps it above full-screen windows such as borderless games.
  win.setAlwaysOnTop(true, 'screen-saver')
  harden(win)
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void win.loadURL(`${devServer}?view=${view}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  return win
}

export class WindowManager {
  readonly dot: BrowserWindow
  readonly panel: BrowserWindow
  private dragStart: Point | null = null
  private claudeRunning = false
  /** The panel is kept up (the active list or the full list pinned open), so clicking elsewhere must not close it. */
  private stayOpen = false
  private dotPosition: Point
  private openMicLive = false

  constructor() {
    // The dot never takes focus, so clicking it does not pull focus from a game.
    this.dot = createWindow('dot', { width: DOT_SIZE, height: DOT_SIZE }, false)
    const [x, y] = this.initialDotPosition()
    this.dotPosition = { x, y }
    this.placeDot()
    // The panel is created up front (hidden) so it opens instantly.
    this.panel = createWindow('panel', { width: PANEL_WIDTH, height: 120 }, true)
    this.panel.on('blur', () => {
      if (!this.stayOpen) this.closePanel()
    })
  }

  /** Every window gets the same broadcasts. */
  send(channel: string, ...args: unknown[]): void {
    for (const win of [this.dot, this.panel]) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args)
    }
  }

  setClaudeRunning(running: boolean): void {
    if (running === this.claudeRunning) return
    this.claudeRunning = running
    if (running) {
      this.dot.showInactive()
    } else {
      this.closePanel()
      this.dot.hide()
    }
  }

  /**
   * Puts the dot (or the open panel) back above everything. Windows lets the stay-on-top window
   * activated last go above the others, so a full-screen app or Show desktop can cover the dot
   * until it is raised again. Raising never takes focus.
   */
  keepOnTop(): void {
    if (!this.claudeRunning) return
    const win = this.panel.isVisible() ? this.panel : this.dot
    if (!win.isVisible()) win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }

  /**
   * Opens the panel in the dot's place. A click opens it fresh and focused. The talk hotkey
   * opens it without focus (so a full-screen game is not minimised) and keeps the panel's
   * state, because the panel has just filled in the composer itself.
   */
  openPanel({ focus = true }: { focus?: boolean } = {}): void {
    const info: PanelOpened = {
      maxHeight: this.maxPanelHeight(),
      opensDown: this.opensDown(),
      fresh: focus,
    }
    this.panel.webContents.send(IPC.panelOpened, info)
    this.placePanel(this.panel.getBounds().height)
    this.dot.hide() // the panel takes the dot's place
    if (focus) {
      this.panel.show()
      this.panel.focus()
    } else {
      this.panel.showInactive()
    }
  }

  setStayOpen(on: boolean): void {
    this.stayOpen = on
  }

  closePanel(): void {
    this.stayOpen = false
    if (!this.panel.isVisible()) return
    this.panel.hide()
    if (this.claudeRunning) this.dot.showInactive()
  }

  resizePanel(height: number): void {
    if (!Number.isFinite(height)) return
    this.placePanel(Math.max(40, Math.min(Math.ceil(height), this.maxPanelHeight())))
  }

  setOpenMicLive(live: boolean): void {
    if (this.openMicLive === live) return
    this.openMicLive = live
    this.placeDot()
  }

  private dotBounds(): Rectangle {
    return { ...this.dotPosition, width: DOT_SIZE, height: DOT_SIZE }
  }

  private placeDot(): void {
    this.dot.setBounds(micIndicatorBounds(this.dotPosition, this.workArea(), this.openMicLive))
  }

  /**
   * The tallest the panel can be from where it starts (the dot) to the far edge of the screen's
   * work area, leaving the same gap at the far end as the dot has at its own edge (up to 8 px).
   */
  private maxPanelHeight(): number {
    const dot = this.dotBounds()
    const area = this.workArea()
    if (this.opensDown()) {
      const gap = clamp(dot.y - area.y, 0, MARGIN)
      return area.y + area.height - gap - dot.y
    }
    const gap = clamp(area.y + area.height - (dot.y + DOT_SIZE), 0, MARGIN)
    return dot.y + DOT_SIZE - (area.y + gap)
  }

  /** Downward from a dot in the top half of the screen, upward from one in the bottom half. */
  private opensDown(): boolean {
    const dot = this.dotBounds()
    const area = this.workArea()
    return dot.y + DOT_SIZE / 2 <= area.y + area.height / 2
  }

  /** Moving changes the available room, without reopening or resetting the current view. */
  private updatePanelLayout(): void {
    if (!this.panel.isVisible()) return
    const info: PanelOpened = {
      maxHeight: this.maxPanelHeight(),
      opensDown: this.opensDown(),
      fresh: false,
    }
    this.panel.webContents.send(IPC.panelOpened, info)
    this.placePanel(Math.min(this.panel.getBounds().height, info.maxHeight))
  }

  dragDot(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const { x, y } = this.dotPosition
    this.dragStart ??= { x, y }
    // Kept inside the screen's work area, just as the panel is.
    const target = { x: Math.round(this.dragStart.x + dx), y: Math.round(this.dragStart.y + dy) }
    const area = screen.getDisplayNearestPoint(target).workArea
    this.dotPosition = {
      x: clamp(target.x, area.x, area.x + area.width - DOT_SIZE),
      y: clamp(target.y, area.y, area.y + area.height - DOT_SIZE),
    }
    this.placeDot()
    // Dragging the panel's header moves the hidden dot, and the panel stays anchored to it.
    this.updatePanelLayout()
  }

  endDrag(): void {
    if (!this.dragStart) return
    this.dragStart = null
    saveDotPosition(this.dotPosition)
  }

  /** Puts the dot back in the top-right corner of the main screen (Settings → Reset). */
  resetDotPosition(): void {
    const { x, y } = cornerPosition('top-right', screen.getPrimaryDisplay().workArea)
    this.dotPosition = { x, y }
    this.placeDot()
    saveDotPosition({ x, y })
    this.updatePanelLayout()
  }

  /**
   * The panel's top-right corner sits where the dot is, growing down; from a dot in the bottom
   * half its bottom-right corner does, growing up.
   */
  private placePanel(height: number): void {
    const dot = this.dotBounds()
    const area = this.workArea()
    const x = clamp(dot.x + DOT_SIZE - PANEL_WIDTH, area.x, area.x + area.width - PANEL_WIDTH)
    const y = clamp(
      this.opensDown() ? dot.y : dot.y + DOT_SIZE - height,
      area.y,
      area.y + area.height - height,
    )
    this.panel.setBounds({ x, y, width: PANEL_WIDTH, height })
  }

  private workArea(): Rectangle {
    return screen.getDisplayMatching(this.dotBounds()).workArea
  }

  private initialDotPosition(): [number, number] {
    const saved = loadDotPosition()
    if (saved) {
      // Only reuse it if it is still on a connected display.
      const area = screen.getDisplayNearestPoint(saved).workArea
      return [
        clamp(saved.x, area.x, area.x + area.width - DOT_SIZE),
        clamp(saved.y, area.y, area.y + area.height - DOT_SIZE),
      ]
    }
    const { x, y } = cornerPosition('top-right', screen.getPrimaryDisplay().workArea)
    return [x, y]
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
