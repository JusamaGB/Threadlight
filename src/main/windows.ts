// The two windows: the dot, and the panel that opens in its place.

import { join } from 'node:path'

import { BrowserWindow, screen, shell, type Rectangle } from 'electron'

import { IPC, type PanelOpened } from '../shared/ipc'
import { loadDotPosition, saveDotPosition, type Point } from './windowState'
import { DOT_SIZE, micIndicatorBounds } from '../shared/micIndicator'
import {
  attentionThread,
  attentionProvider,
  NO_ATTENTION,
  WORKSPACE_GUTTER,
  type AttentionMotion,
} from '../shared/attentionMotion'
import { inGutterRegion, parseGutterRegions, type GutterRegion } from '../shared/gutterRegions'
import type { Session } from '../shared/types'

export { DOT_SIZE }
export const PANEL_WIDTH = 238 // 236 of content plus a 1 px border each side
/** Two columns wide: Claude and Codex threads side by side. */
export const PANEL_WIDTH_DUAL = 475 // two 236px columns, a 1px divider and a border each side
/** The widening and narrowing animation; the gutter stays interactive-safe while it runs. */
const LAYOUT_ANIMATION_MS = 1000
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

type View = 'dot' | 'panel' | 'attention'

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
  private pointerWatch: ReturnType<typeof setInterval> | null = null
  private attentionWindow: BrowserWindow | null = null
  private attentionSession: Session | undefined
  private attentionState: AttentionMotion = NO_ATTENTION
  private talking = false
  private gutterIgnored = false
  private wireControl: { top: number; height: number } | null = null
  private wireRegions: GutterRegion[] = []
  private panelLayout: 'single' | 'dual' = 'single'
  private layoutAnimation: ReturnType<typeof setTimeout> | null = null
  private workspacePanel = false
  private workspaceTop: number | null = null
  private workspaceDragTop: number | null = null

  constructor() {
    // The dot never takes focus, so clicking it does not pull focus from a game.
    this.dot = createWindow('dot', { width: DOT_SIZE, height: DOT_SIZE }, false)
    const [x, y] = this.initialDotPosition()
    this.dotPosition = { x, y }
    this.placeDot()
    // The panel is created up front (hidden) so it opens instantly.
    this.panel = createWindow('panel', { width: PANEL_WIDTH + WORKSPACE_GUTTER, height: 120 }, true)
    this.panel.on('blur', () => {
      // A showInactive/resize handoff can deliver a delayed blur while still hovered.
      this.closeOnPointerLeave()
    })
    this.panel.on('closed', () => this.stopPointerWatch())
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
    this.syncAttention()
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
    this.syncAttention()
    if (this.attentionWindow?.isVisible()) this.attentionWindow.moveTop()
  }

  /** Ignore duplicate and delayed hover messages from the dot window being replaced. */
  openFromDot(hover = false): void {
    if (this.panel.isVisible()) return
    if (hover) {
      if (!this.dot.isVisible()) return
      const point = screen.getCursorScreenPoint()
      const bounds = this.dot.getBounds()
      if (
        point.x < bounds.x ||
        point.x >= bounds.x + bounds.width ||
        point.y < bounds.y ||
        point.y >= bounds.y + bounds.height
      )
        return
    }
    this.openPanel({ focus: !hover, fresh: true })
  }

  /**
   * Opens the panel in the dot's place. A click opens it fresh and focused. The talk hotkey
   * opens it without focus (so a full-screen game is not minimised) and keeps the panel's
   * state, because the panel has just filled in the composer itself.
   */
  openPanel({ focus = true, fresh = focus }: { focus?: boolean; fresh?: boolean } = {}): void {
    if (fresh) {
      this.stayOpen = false
      this.workspacePanel = false
      this.workspaceTop = null
    }
    const info: PanelOpened = {
      maxHeight: this.maxPanelHeight(),
      opensDown: this.opensDown(),
      fresh,
    }
    this.panel.webContents.send(IPC.panelOpened, info)
    this.placePanel(Math.min(this.panel.getBounds().height, info.maxHeight))
    if (focus) {
      this.panel.show()
      this.panel.focus()
    } else {
      this.panel.showInactive()
    }
    // Present the replacement before hiding the already-painted indicator.
    this.dot.hide()
    this.attentionWindow?.hide()
    this.broadcastAttention({ ...this.attentionState, active: false })
    this.startPointerWatch()
  }

  setStayOpen(on: boolean): void {
    this.stayOpen = on
  }

  closePanel(): void {
    this.stayOpen = false
    this.stopPointerWatch()
    if (!this.panel.isVisible()) return
    if (this.claudeRunning) this.dot.showInactive()
    this.syncAttention(false)
    this.panel.hide()
  }

  /** Browser leave events may be stale while replacing or resizing a transparent window. */
  closeOnPointerLeave(): void {
    if (this.stayOpen || this.dragStart || this.pointerInsidePanel()) return
    this.closePanel()
  }

  private pointerInsidePanel(): boolean {
    const point = screen.getCursorScreenPoint()
    const bounds = this.panel.getBounds()
    return (
      point.x >= bounds.x &&
      point.x < bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y < bounds.y + bounds.height
    )
  }

  private startPointerWatch(): void {
    if (this.pointerWatch) return
    // Showing the panel beneath the pointer can miss Chromium's enter/leave handoff.
    // The renderer still applies its pin, microphone and countdown protections.
    this.pointerWatch = setInterval(() => {
      if (!this.panel.isVisible()) {
        this.stopPointerWatch()
        return
      }
      const point = screen.getCursorScreenPoint()
      const bounds = this.panel.getBounds()
      const gutter =
        point.x >= bounds.x &&
        point.x < bounds.x + WORKSPACE_GUTTER &&
        point.y >= bounds.y &&
        point.y < bounds.y + bounds.height &&
        !(
          this.wireControl &&
          point.y >= bounds.y + this.wireControl.top &&
          point.y < bounds.y + this.wireControl.top + this.wireControl.height
        ) &&
        !inGutterRegion(this.wireRegions, { x: point.x - bounds.x, y: point.y - bounds.y }) &&
        // The card is moving while the layout changes, so nothing is click-through then.
        !this.layoutAnimation
      if (gutter !== this.gutterIgnored) {
        this.gutterIgnored = gutter
        this.panel.setIgnoreMouseEvents(gutter, { forward: true })
      }
      if (!this.stayOpen && !this.dragStart && !this.pointerInsidePanel())
        this.panel.webContents.send(IPC.panelPointerOutside)
    }, 16)
    this.pointerWatch.unref()
  }

  private stopPointerWatch(): void {
    if (this.pointerWatch) clearInterval(this.pointerWatch)
    this.pointerWatch = null
    if (this.gutterIgnored) this.panel.setIgnoreMouseEvents(false)
    this.gutterIgnored = false
  }

  /** Only the small header clip intercepts clicks in the otherwise transparent gutter. */
  setWorkspaceWireControl(value: unknown): void {
    if (value === null) {
      this.wireControl = null
      return
    }
    if (typeof value !== 'object' || !value) return
    const { top, height } = value as Record<string, unknown>
    if (
      typeof top === 'number' &&
      Number.isFinite(top) &&
      top >= 0 &&
      top <= 32768 &&
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height > 0 &&
      height <= 32
    )
      this.wireControl = { top, height }
  }

  /** The thin clickable strips along each wire; everything else in the gutter passes clicks through. */
  setWorkspaceWireRegions(value: unknown): void {
    this.wireRegions = parseGutterRegions(value)
  }

  /** The card's width in the current layout, kept inside the work area. */
  private cardWidth(): number {
    if (this.panelLayout === 'single') return PANEL_WIDTH
    const area = this.workArea()
    return Math.max(
      PANEL_WIDTH,
      Math.min(PANEL_WIDTH_DUAL, area.width - 2 * MARGIN - WORKSPACE_GUTTER),
    )
  }

  /** Single is the narrow column; dual widens the window leftwards from the dot's corner. */
  setPanelLayout(value: unknown, animating?: unknown): { cardWidth: number } | null {
    if (value !== 'single' && value !== 'dual') return null
    const changed = value !== this.panelLayout
    // `animating` starts the animation window without changing the width, for the rows and card
    // that move before the window narrows.
    if (changed || animating === true) {
      if (this.layoutAnimation) clearTimeout(this.layoutAnimation)
      this.layoutAnimation = setTimeout(() => {
        this.layoutAnimation = null
      }, LAYOUT_ANIMATION_MS)
      this.layoutAnimation.unref?.()
    }
    if (changed) {
      this.panelLayout = value
      this.placePanel(this.panel.getBounds().height)
    }
    return { cardWidth: this.cardWidth() }
  }

  resizePanel(height: number): void {
    if (!Number.isFinite(height)) return
    this.placePanel(Math.max(40, Math.min(Math.ceil(height), this.maxPanelHeight())))
  }

  /** Workspace grows from a stable top edge, so its bottom usage grip follows the pointer. */
  setWorkspacePanel(on: boolean): PanelOpened {
    if (on !== this.workspacePanel) {
      this.workspaceTop = on ? this.panel.getBounds().y : null
      this.workspacePanel = on
    }
    const info = { maxHeight: this.maxPanelHeight(), opensDown: this.opensDown(), fresh: false }
    this.placePanel(Math.min(this.panel.getBounds().height, info.maxHeight))
    return info
  }

  setOpenMicLive(live: boolean): void {
    if (this.openMicLive === live) return
    this.openMicLive = live
    this.placeDot()
    this.syncAttention()
  }

  get attentionMotion(): AttentionMotion {
    return this.attentionState
  }
  setAttention(sessions: Session[]): void {
    this.attentionSession = attentionThread(sessions, this.attentionSession?.id)
    this.syncAttention()
  }
  setTalking(on: boolean): void {
    this.talking = on
    this.syncAttention()
  }
  private broadcastAttention(state: AttentionMotion): void {
    if (JSON.stringify(state) === JSON.stringify(this.attentionState)) return
    this.attentionState = state
    this.dot.webContents.send(IPC.attentionMotion, state)
    this.attentionWindow?.webContents.send(IPC.attentionMotion, state)
  }
  private syncAttention(panelVisible = this.panel.isVisible()): void {
    const selected = this.attentionSession
    if (!selected || !this.claudeRunning || panelVisible || this.openMicLive || this.talking) {
      this.attentionWindow?.hide()
      this.broadcastAttention({ ...this.attentionState, active: false })
      return
    }
    const area = this.workArea()
    const width = Math.min(140, area.width)
    const x = clamp(
      this.dotPosition.x + DOT_SIZE / 2 - width / 2,
      area.x,
      area.x + area.width - width,
    )
    const y = this.dotPosition.y
    const height = Math.max(DOT_SIZE + 2, area.y + area.height - y + 2)
    const bounds = { x, y, width, height }
    if (!this.attentionWindow) {
      this.attentionWindow = createWindow('attention', { width, height }, false)
      this.attentionWindow.setIgnoreMouseEvents(true)
    }
    if (JSON.stringify(this.attentionWindow.getBounds()) !== JSON.stringify(bounds))
      this.attentionWindow.setBounds(bounds)
    this.broadcastAttention({
      active: true,
      provider: attentionProvider(selected),
      width,
      height,
      x: this.dotPosition.x + DOT_SIZE / 2 - x,
      y: DOT_SIZE / 2,
      floor: height - 2,
    })
    if (!this.attentionWindow.isVisible()) this.attentionWindow.showInactive()
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
    if (this.workspacePanel) return Math.max(40, area.height - MARGIN * 2)
    if (this.opensDown()) {
      const gap = clamp(dot.y - area.y, 0, MARGIN)
      return area.y + area.height - gap - dot.y
    }
    const gap = clamp(area.y + area.height - (dot.y + DOT_SIZE), 0, MARGIN)
    return dot.y + DOT_SIZE - (area.y + gap)
  }

  /** Downward from a dot in the top half of the screen, upward from one in the bottom half. */
  private opensDown(): boolean {
    if (this.workspacePanel) return true
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
    if (!this.dragStart && this.workspacePanel) this.workspaceDragTop = this.panel.getBounds().y
    this.dragStart ??= { x, y }
    if (this.workspacePanel && this.workspaceDragTop !== null)
      this.workspaceTop = this.workspaceDragTop + dy
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
    this.syncAttention()
  }

  endDrag(): void {
    if (!this.dragStart) return
    this.dragStart = null
    this.workspaceDragTop = null
    saveDotPosition(this.dotPosition)
  }

  /** Puts the dot back in the top-right corner of the main screen (Settings → Reset). */
  resetDotPosition(): void {
    const { x, y } = cornerPosition('top-right', screen.getPrimaryDisplay().workArea)
    this.dotPosition = { x, y }
    if (this.workspacePanel) this.workspaceTop = y
    this.placeDot()
    saveDotPosition({ x, y })
    this.updatePanelLayout()
    this.syncAttention()
  }

  /**
   * The panel's top-right corner sits where the dot is, growing down; from a dot in the bottom
   * half its bottom-right corner does, growing up.
   */
  private placePanel(height: number): void {
    const dot = this.dotBounds()
    const area = this.workArea()
    const width = this.cardWidth() + WORKSPACE_GUTTER
    const x = clamp(dot.x + DOT_SIZE - width, area.x, area.x + area.width - width)
    const y = this.workspacePanel
      ? clamp(this.workspaceTop ?? dot.y, area.y + MARGIN, area.y + area.height - MARGIN - height)
      : clamp(
          this.opensDown() ? dot.y : dot.y + DOT_SIZE - height,
          area.y,
          area.y + area.height - height,
        )
    if (this.workspacePanel) this.workspaceTop = y
    this.panel.setBounds({ x, y, width, height })
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
