// The two windows: the dot, and the panel that opens in its place.

import { join } from 'node:path'

import { BrowserWindow, screen, shell, type Rectangle } from 'electron'

import { IPC, type PanelOpened } from '../shared/ipc'
import { loadDotPosition, saveDotPosition, type Point } from './windowState'

export const DOT_SIZE = 22
export const PANEL_WIDTH = 342 // 340 of content plus a 1 px border each side
const MARGIN = 8

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
  /** The panel is kept up (as a slim bar, or pinned open), so clicking elsewhere must not close it. */
  private stayOpen = false

  constructor() {
    // The dot never takes focus, so clicking it does not pull focus from a game.
    this.dot = createWindow('dot', { width: DOT_SIZE, height: DOT_SIZE }, false)
    this.dot.setPosition(...this.initialDotPosition())
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
   * Opens the panel in the dot's place. A click opens it fresh and focused. The talk hotkey
   * opens it without focus (so a full-screen game is not minimised) and keeps the panel's
   * state, because the panel has just filled in the composer itself.
   */
  openPanel({ focus = true }: { focus?: boolean } = {}): void {
    const info: PanelOpened = { maxHeight: this.workArea().height - 2 * MARGIN, fresh: focus }
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
    const max = this.workArea().height - 2 * MARGIN
    this.placePanel(Math.max(40, Math.min(Math.ceil(height), max)))
  }

  dragDot(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const [x, y] = this.dot.getPosition() as [number, number]
    this.dragStart ??= { x, y }
    // Kept inside the screen's work area, just as the panel is.
    const target = { x: Math.round(this.dragStart.x + dx), y: Math.round(this.dragStart.y + dy) }
    const area = screen.getDisplayNearestPoint(target).workArea
    this.dot.setPosition(
      clamp(target.x, area.x, area.x + area.width - DOT_SIZE),
      clamp(target.y, area.y, area.y + area.height - DOT_SIZE),
    )
    // Dragging the panel's header moves the hidden dot, and the panel stays anchored to it.
    if (this.panel.isVisible()) this.placePanel(this.panel.getBounds().height)
  }

  endDrag(): void {
    if (!this.dragStart) return
    this.dragStart = null
    const [x, y] = this.dot.getPosition() as [number, number]
    saveDotPosition({ x, y })
  }

  /** Puts the dot back in the top-right corner of the main screen (Settings → Reset). */
  resetDotPosition(): void {
    const area = screen.getPrimaryDisplay().workArea
    const x = area.x + area.width - DOT_SIZE - MARGIN
    const y = area.y + MARGIN
    this.dot.setPosition(x, y)
    saveDotPosition({ x, y })
    if (this.panel.isVisible()) this.placePanel(this.panel.getBounds().height)
  }

  /** The panel's top-right corner sits where the dot is; it flips upward near the bottom edge. */
  private placePanel(height: number): void {
    const dot = this.dot.getBounds()
    const area = this.workArea()
    const x = clamp(dot.x + DOT_SIZE - PANEL_WIDTH, area.x, area.x + area.width - PANEL_WIDTH)
    const fitsBelow = dot.y + height <= area.y + area.height
    const y = clamp(
      fitsBelow ? dot.y : dot.y + DOT_SIZE - height,
      area.y,
      area.y + area.height - height,
    )
    this.panel.setBounds({ x, y, width: PANEL_WIDTH, height })
  }

  private workArea(): Rectangle {
    return screen.getDisplayMatching(this.dot.getBounds()).workArea
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
    const area = screen.getPrimaryDisplay().workArea
    return [area.x + area.width - DOT_SIZE - MARGIN, area.y + MARGIN]
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
