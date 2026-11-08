// The two windows: the dot, and the panel that opens in its place.

import { join } from 'node:path'
import { squareOverlay } from '../shared/canvas'

import { BrowserWindow, screen, shell, type Rectangle } from 'electron'

import type { SpokenReply } from '../shared/spokenReply'
import { IPC, type PanelOpened } from '../shared/ipc'
import { loadDotPosition, saveDotPosition, type Point } from './windowState'
import {
  boundsAtDot,
  DOT_SIZE,
  MIC_PILL_WIDTH,
  MIC_PILL_HEIGHT,
  micIndicatorBounds,
} from '../shared/micIndicator'
import { MAX_ATTENTION_DRIPS } from '../shared/dripSchedule'
import {
  attentionThreads,
  attentionProvider,
  NO_ATTENTION,
  WORKSPACE_GUTTER,
  type AttentionMotion,
} from '../shared/attentionMotion'
import { inGutterRegion, parseGutterRegions, type GutterRegion } from '../shared/gutterRegions'
import type { Session } from '../shared/types'
import type { ModifierStage } from './modifierStepper'
import { isKeyDown } from './keyState'
import { referencePlacement } from './referencePlacement'

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

type View = 'dot' | 'panel' | 'attention' | 'reference'

/** Shared hardening for every window: no navigation away, no pop-ups, links open in the browser. */
function harden(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createWindow(
  view: View,
  size: { width: number; height: number },
  focusable: boolean,
  load = true,
) {
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
  if (load) void loadRenderer(win, view)
  return win
}

function loadRenderer(win: BrowserWindow, view: View): Promise<void> {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  return devServer
    ? win.loadURL(`${devServer}?view=${view}`)
    : win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
}

/** Unfold down from the resting waveform, moving upward only at the work-area edge. */
export function spokenReplyBounds(
  anchor: Point,
  area: Rectangle,
  width: number,
  height: number,
): Rectangle {
  const w = Math.min(area.width, clamp(Math.ceil(width), 92, 296))
  const h = Math.min(area.height, clamp(Math.ceil(height), 24, 256))
  const pill = micIndicatorBounds(anchor, area, true)
  return {
    x: clamp(Math.round(pill.x + (pill.width - w) / 2), area.x, area.x + area.width - w),
    y: clamp(pill.y, area.y, area.y + area.height - h),
    width: w,
    height: h,
  }
}

export class WindowManager {
  private rendererLoad?: Promise<void>
  /** Call only after every renderer IPC handler and startup service is registered. */
  loadRenderers(): Promise<void> {
    return (this.rendererLoad ??= Promise.all([
      loadRenderer(this.dot, 'dot'),
      loadRenderer(this.panel, 'panel'),
    ]).then(() => {}))
  }
  readonly dot: BrowserWindow
  readonly panel: BrowserWindow
  private dragStart: Point | null = null
  private liveDragBounds: Rectangle | null = null
  private liveDragEndedAt = -Infinity
  private claudeRunning = false
  /** The panel is kept up (the active list or the full list pinned open), so clicking elsewhere must not close it. */
  private stayOpen = false
  private dotPosition: Point
  private openMicLive = false
  /** Briefly ignore stale leave events while the pill is replaced by the panel. */
  private micOpenGraceUntil = 0
  private pointerWatch: ReturnType<typeof setInterval> | null = null
  private attentionWindow: BrowserWindow | null = null
  private attentionSessions: Session[] = []
  private agentAttention: AttentionMotion['provider'] | null = null
  private attentionState: AttentionMotion = NO_ATTENTION
  private talking = false
  private gutterIgnored = false
  private micMenuShown = false
  private spokenReply: SpokenReply | null = null
  private replySize = { width: 92, height: 24 }

  setSpokenReply(reply: SpokenReply | null) {
    this.spokenReply = reply
    this.syncSpokenReply()
  }

  getSpokenReply(sender: Electron.WebContents) {
    return sender === this.dot.webContents &&
      this.openMicLive &&
      !this.panel.isVisible() &&
      this.modifierStage === 'normal' &&
      !this.micMenuShown
      ? this.spokenReply
      : null
  }

  setSpokenReplySize(sender: Electron.WebContents, width: number, height: number) {
    if (
      sender !== this.dot.webContents ||
      !this.openMicLive ||
      this.micMenuShown ||
      this.panel.isVisible() ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    )
      return
    this.replySize = { width, height }
    this.placeDot()
  }

  private syncSpokenReply() {
    if (this.overlayClosed) return
    this.dot.webContents.send(IPC.spokenReply, this.getSpokenReply(this.dot.webContents))
  }

  private reference?: BrowserWindow
  private hasReferences = false
  private referenceReady = false
  private referenceHeight = 300
  codeWindow(sender: Electron.WebContents) {
    return sender === this.panel.webContents
      ? this.panel
      : sender === this.reference?.webContents
        ? this.reference
        : undefined
  }
  pinsChanged(state: import('../shared/pinnedCode').PinState) {
    for (const win of [this.panel, this.reference]) {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.pinsChanged, state)
    }
  }
  setPinnedCode(visible: boolean, height: number) {
    const removed = this.hasReferences && !visible
    this.hasReferences = visible
    this.referenceHeight = clamp(Math.round(height), 160, 540)
    this.syncReference()
    this.syncSpokenReply()
    if (removed && !this.indicatorAvailable && !this.panel.isVisible()) this.dot.hide()
  }
  private syncReference() {
    if (this.overlayClosed || !this.hasReferences || this.panel.isVisible()) {
      if (
        this.reference &&
        !this.dot.isDestroyed() &&
        this.dot.getParentWindow() === this.reference
      )
        this.dot.setParentWindow(null)
      this.reference?.hide()
      return
    }
    if (!this.reference) {
      const win = (this.reference = createWindow(
        'reference',
        { width: PANEL_WIDTH, height: this.referenceHeight },
        true,
        false,
      ))
      win.on('blur', () => {
        if (this.panning?.window === win) this.endCodePan()
      })
      win.on('closed', () => {
        this.reference = undefined
        this.referenceReady = false
      })
      void loadRenderer(win, 'reference')
        .then(() => {
          if (this.reference === win) {
            this.referenceReady = true
            this.syncReference()
            this.syncSpokenReply()
          }
        })
        .catch(() => {
          if (!win.isDestroyed()) win.close()
        })
    }
    const win = this.reference
    if (!this.referenceReady) return
    const { bounds, anchor } = referencePlacement(
      this.dotBounds(),
      this.dot.getBounds(),
      this.workArea(),
      PANEL_WIDTH,
      this.referenceHeight,
    )
    win.setBounds(bounds)
    win.webContents.send(IPC.referenceAnchor, anchor)
    if (!win.isVisible()) win.showInactive()
    if (this.modifierStage === 'normal') {
      // Keep the logo over the full background even after the reference takes focus.
      if (this.dot.getParentWindow() !== win) this.dot.setParentWindow(win)
      if (!this.dot.isVisible()) this.dot.showInactive()
      this.dot.moveTop()
    }
  }
  private panning?: { id: string; last: Point; timer: NodeJS.Timeout; window: BrowserWindow }
  codePan(id: string, active: boolean, win = this.panel) {
    if (!active) {
      if (this.panning?.id === id && this.panning.window === win) this.endCodePan()
      return
    }
    if (
      this.overlayClosed ||
      win.isDestroyed() ||
      !win.isVisible() ||
      this.panning ||
      !this.keyHeld(0x11) ||
      !this.keyHeld(0x01)
    ) {
      if (!this.overlayClosed)
        win.webContents.send(IPC.codePanMotion, { id, dx: 0, dy: 0, end: true })
      return
    }
    if (win === this.panel && this.gutterIgnored) {
      this.panel.setIgnoreMouseEvents(false)
      this.gutterIgnored = false
    }
    const pan = (this.panning = {
      id,
      window: win,
      last: screen.getCursorScreenPoint(),
      timer: setInterval(() => {
        if (
          this.overlayClosed ||
          win.isDestroyed() ||
          !win.isVisible() ||
          !this.keyHeld(0x11) ||
          !this.keyHeld(0x01)
        )
          return this.endCodePan()
        const point = screen.getCursorScreenPoint()
        const bounds = screen.getDisplayNearestPoint(point).bounds
        const dx = pan.last.x - point.x,
          dy = pan.last.y - point.y
        // Continue in the drag direction while the mouse is held against a display edge.
        const edgeX = point.x <= bounds.x ? 4 : point.x >= bounds.x + bounds.width - 1 ? -4 : 0
        const edgeY = point.y <= bounds.y ? 4 : point.y >= bounds.y + bounds.height - 1 ? -4 : 0
        pan.last = point
        if (dx || dy || edgeX || edgeY)
          win.webContents.send(IPC.codePanMotion, { id, dx: dx || edgeX, dy: dy || edgeY })
      }, 16),
    })
  }
  private endCodePan() {
    const pan = this.panning
    if (!pan) return
    this.panning = undefined
    clearInterval(pan.timer)
    if (!pan.window.isDestroyed())
      pan.window.webContents.send(IPC.codePanMotion, { id: pan.id, end: true, dx: 0, dy: 0 })
  }
  private wireControl: { top: number; height: number } | null = null
  private wireRegions: GutterRegion[] = []
  private panelLayout: 'single' | 'dual' = 'single'
  private canvasRestore: Rectangle | null = null

  setCanvasExpanded(on: unknown): { width: number; height: number } | null {
    if (typeof on !== 'boolean') return null
    if (on) {
      this.canvasRestore ??= this.panel.getBounds()
      this.placePanel(this.canvasRestore.height)
      const bounds = this.panel.getBounds()
      return { width: bounds.width, height: bounds.height }
    }
    const before = this.canvasRestore
    this.canvasRestore = null
    if (before) {
      this.placePanel(before.height)
      this.panel.webContents.send(IPC.panelOpened, {
        maxHeight: this.maxPanelHeight(),
        opensDown: this.opensDown(),
        fresh: false,
      })
    }
    return null
  }
  private rightWireGutter = 0
  private layoutAnimation: ReturnType<typeof setTimeout> | null = null
  private workspacePanel = false
  private workspaceTop: number | null = null
  private workspaceDragTop: number | null = null
  private modifierStage: ModifierStage = 'normal'
  private beforePeek: {
    visible: boolean
    stayOpen: boolean
    workspace: boolean
    top: number | null
    layout: 'single' | 'dual'
    gutter: number
    bounds: Rectangle
  } | null = null

  constructor(private keyHeld = isKeyDown) {
    // The dot never takes focus, so clicking it does not pull focus from a game.
    this.dot = createWindow('dot', { width: DOT_SIZE, height: DOT_SIZE }, false, false)
    const [x, y] = this.initialDotPosition()
    this.dotPosition = { x, y }
    this.placeDot()
    // The panel is created up front (hidden) so it opens instantly.
    this.panel = createWindow(
      'panel',
      { width: PANEL_WIDTH + WORKSPACE_GUTTER, height: 120 },
      true,
      false,
    )
    const syncCompanions = () => {
      this.syncReference()
      this.syncSpokenReply()
    }
    this.panel.on('hide', syncCompanions)
    this.panel.on('show', () => {
      if (this.openMicLive) {
        this.replySize = { width: 92, height: 24 }
        this.placeDot()
      }
      syncCompanions()
    })
    this.panel.on('blur', () => {
      if (this.panning?.window === this.panel) this.endCodePan()
      // A showInactive/resize handoff can deliver a delayed blur while still hovered.
      if (this.openMicLive) this.panel.webContents.send(IPC.panelPointerOutside)
      else this.closeOnPointerLeave()
    })
    const updateDisplay = () => {
      if ((!this.hasReferences && !this.spokenReply) || this.overlayClosed) return
      const area = this.workArea()
      this.dotPosition = {
        x: clamp(this.dotPosition.x, area.x, area.x + area.width - DOT_SIZE),
        y: clamp(this.dotPosition.y, area.y, area.y + area.height - DOT_SIZE),
      }
      this.placeDot()
    }
    screen.on('display-metrics-changed', updateDisplay)
    screen.on('display-removed', updateDisplay)
    this.panel.on('closed', () => {
      this.stopPointerWatch()
      screen.off('display-metrics-changed', updateDisplay)
      screen.off('display-removed', updateDisplay)
    })
    this.panel.on('app-command', (_event, command) => {
      if (this.modifierStage === 'peek') return
      if (command === 'browser-backward' || command === 'browser-forward')
        this.panel.webContents.send(
          IPC.panelNavigate,
          command === 'browser-backward' ? 'back' : 'forward',
        )
    })
  }

  /** A held preview borrows the window; it never changes the saved page, focus or settings. */
  setModifierStage(stage: ModifierStage): void {
    if (this.dot.isDestroyed() || this.panel.isDestroyed()) return
    if (stage === this.modifierStage) return
    this.modifierStage = stage
    this.syncSpokenReply()
    if (stage === 'peek') this.endCodePan()
    this.panel.webContents.send(IPC.panelControlHeld, stage === 'hidden')
    this.reference?.webContents.send(IPC.panelControlHeld, stage === 'hidden')
    if (this.beforePeek) {
      const before = this.beforePeek
      this.beforePeek = null
      this.panel.webContents.send(IPC.panelPeek, false)
      this.panel.setIgnoreMouseEvents(false)
      this.gutterIgnored = false
      if (!before.visible) this.closePanel()
      this.stayOpen = before.stayOpen
      this.workspacePanel = before.workspace
      this.workspaceTop = before.top
      this.panelLayout = before.layout
      this.rightWireGutter = before.gutter
      this.panel.setBounds(before.bounds)
    }
    if (stage === 'peek') {
      this.beforePeek = {
        visible: this.panel.isVisible(),
        stayOpen: this.stayOpen,
        workspace: this.workspacePanel,
        top: this.workspaceTop,
        layout: this.panelLayout,
        gutter: this.rightWireGutter,
        bounds: this.panel.getBounds(),
      }
      this.workspacePanel = false
      this.workspaceTop = null
      this.panel.webContents.send(IPC.panelPeek, true)
      this.openPanel({ focus: false, fresh: false })
      this.panel.setIgnoreMouseEvents(true, { forward: true })
    } else if (stage === 'hidden') {
      this.dot.hide()
      this.attentionWindow?.hide()
    } else {
      if (this.indicatorAvailable && !this.panel.isVisible()) this.dot.showInactive()
      this.syncAttention()
    }
  }

  send(channel: string, ...args: unknown[]): void {
    const targets = [this.dot, this.panel]
    if (channel === IPC.settingsChanged && this.reference) targets.push(this.reference)
    for (const win of targets) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args)
    }
  }

  setClaudeRunning(running: boolean): void {
    if (this.dot.isDestroyed() || this.panel.isDestroyed()) return
    if (running === this.claudeRunning) return
    this.claudeRunning = running
    this.syncIndicatorVisibility()
  }

  private get indicatorAvailable(): boolean {
    return this.claudeRunning || this.openMicLive || !!this.agentAttention || this.hasReferences
  }

  private syncIndicatorVisibility(): void {
    if (this.indicatorAvailable) {
      if (this.modifierStage === 'normal' && !this.panel.isVisible()) this.dot.showInactive()
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
    if (this.dot.isDestroyed() || this.panel.isDestroyed()) return
    if (!this.indicatorAvailable) return
    if (this.modifierStage === 'hidden') return
    const win = this.panel.isVisible() ? this.panel : this.dot
    if (!win.isVisible()) win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
    this.syncAttention()
    if (
      this.attentionWindow &&
      !this.attentionWindow.isDestroyed() &&
      this.attentionWindow.isVisible()
    )
      this.attentionWindow.moveTop()
  }

  /** Ignore duplicate and delayed hover messages from the dot window being replaced. */
  openFromDot(hover = false): void {
    if (this.dot.isDestroyed() || this.panel.isDestroyed()) return
    if (this.modifierStage !== 'normal') return
    if (this.panel.isVisible()) return
    if (this.openMicLive && (this.dragStart || this.micMenuShown)) return
    if (hover) {
      if (
        this.openMicLive &&
        (Date.now() - this.liveDragEndedAt < 200 || this.keyHeld(0x01) || this.keyHeld(0x02))
      )
        return
      if (!this.dot.isVisible()) return
      const point = screen.getCursorScreenPoint()
      const bounds = this.dot.getBounds()
      if (
        point.x < bounds.x ||
        point.x >= bounds.x + bounds.width ||
        point.y < bounds.y ||
        point.y >= bounds.y + (this.openMicLive ? MIC_PILL_HEIGHT : bounds.height)
      )
        return
    }
    if (this.openMicLive) {
      this.micOpenGraceUntil = Date.now() + 300
      this.openPanel({ focus: !hover, fresh: false, fromMic: true })
      return
    }
    this.openPanel({ focus: !hover, fresh: true })
  }

  /**
   * Opens the panel in the dot's place. A click opens it fresh and focused. The talk hotkey
   * opens it without focus (so a full-screen game is not minimised) and keeps the panel's
   * state, because the panel has just filled in the composer itself.
   */
  openPanel({
    focus = true,
    fresh = focus,
    fromMic = false,
  }: { focus?: boolean; fresh?: boolean; fromMic?: boolean } = {}): void {
    if (fresh) {
      this.stayOpen = false
      this.workspacePanel = false
      this.workspaceTop = null
    }
    const info: PanelOpened = {
      maxHeight: this.maxPanelHeight(),
      opensDown: this.opensDown(),
      fresh,
      ...(fromMic && { fromMic: true }),
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
    if (this.panning?.window === this.panel) this.endCodePan()
    if (this.overlayClosed) return
    if (this.modifierStage === 'peek') return
    this.micOpenGraceUntil = 0
    this.stayOpen = false
    this.stopPointerWatch()
    if (!this.panel.isVisible()) return
    if (this.indicatorAvailable && this.modifierStage === 'normal') this.dot.showInactive()
    this.syncAttention(false)
    this.panel.hide()
  }

  /** Browser leave events may be stale while replacing or resizing a transparent window. */
  closeOnPointerLeave(): void {
    if (this.overlayClosed || this.modifierStage === 'peek') return
    if (
      this.panning?.window === this.panel ||
      Date.now() < this.micOpenGraceUntil ||
      this.stayOpen ||
      this.dragStart ||
      this.pointerInsidePanel()
    )
      return
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

  private get overlayClosed(): boolean {
    return this.dot.isDestroyed() || this.panel.isDestroyed()
  }

  private startPointerWatch(): void {
    if (this.pointerWatch) return
    // Showing the panel beneath the pointer can miss Chromium's enter/leave handoff.
    // The renderer still applies its pin, microphone and countdown protections.
    this.pointerWatch = setInterval(() => {
      if (this.overlayClosed || !this.panel.isVisible()) {
        this.stopPointerWatch()
        return
      }
      if (this.panning?.window === this.panel) return
      const point = screen.getCursorScreenPoint()
      const bounds = this.panel.getBounds()
      if (this.modifierStage === 'peek') return
      const leftGutter = point.x >= bounds.x && point.x < bounds.x + WORKSPACE_GUTTER
      const rightGutter =
        !this.canvasRestore &&
        this.panelLayout === 'dual' &&
        point.x >= bounds.x + bounds.width - this.rightWireGutter &&
        point.x < bounds.x + bounds.width
      const gutter =
        (leftGutter || rightGutter) &&
        point.y >= bounds.y &&
        point.y < bounds.y + bounds.height &&
        !(
          leftGutter &&
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
      if (
        Date.now() >= this.micOpenGraceUntil &&
        !this.stayOpen &&
        !this.dragStart &&
        !this.pointerInsidePanel()
      )
        this.panel.webContents.send(IPC.panelPointerOutside)
    }, 16)
    this.pointerWatch.unref()
  }

  private stopPointerWatch(): void {
    if (this.pointerWatch) clearInterval(this.pointerWatch)
    this.pointerWatch = null
    if (this.gutterIgnored && !this.panel.isDestroyed()) this.panel.setIgnoreMouseEvents(false)
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
      Math.min(PANEL_WIDTH_DUAL, area.width - 2 * MARGIN - WORKSPACE_GUTTER - this.rightWireGutter),
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

  /** The renderer measures the required outside wire lanes; unused space is not reserved. */
  setWorkspaceWireGutter(value: unknown): { cardWidth: number } | null {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > WORKSPACE_GUTTER
    )
      return null
    if (value !== this.rightWireGutter) {
      this.rightWireGutter = value
      if (this.panelLayout === 'dual') this.placePanel(this.panel.getBounds().height)
    }
    return this.panelLayout === 'dual' ? { cardWidth: this.cardWidth() } : null
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
    if (this.dot.isDestroyed() || this.panel.isDestroyed()) return
    if (this.openMicLive === live) return
    this.openMicLive = live
    if (!live) {
      this.micOpenGraceUntil = 0
      this.micMenuShown = false
      this.replySize = { width: 92, height: 24 }
      this.setSpokenReply(null)
    }
    this.dot.setFocusable(live)
    this.dot.setSkipTaskbar(true)
    this.placeDot()
    this.syncIndicatorVisibility()
  }

  get attentionMotion(): AttentionMotion {
    return this.attentionState
  }
  setAttention(sessions: Session[]): void {
    this.attentionSessions = attentionThreads(sessions)
    this.syncAttention()
  }
  setAgentAttention(provider: AttentionMotion['provider'] | null) {
    if (this.agentAttention === provider || this.overlayClosed) return
    this.agentAttention = provider
    // Clearing an Agent question while composing must not dismiss the open panel.
    if (!provider && !this.indicatorAvailable && this.panel.isVisible()) {
      this.dot.hide()
      this.syncAttention()
    } else this.syncIndicatorVisibility()
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
  private syncAttention(panelVisible?: boolean): void {
    if (this.dot.isDestroyed() || this.panel.isDestroyed()) return
    if (this.attentionWindow?.isDestroyed()) return
    panelVisible ??= this.panel.isVisible()
    const providers = this.attentionSessions.map(attentionProvider)
    if (this.agentAttention) providers.unshift(this.agentAttention)
    providers.splice(MAX_ATTENTION_DRIPS)
    if (
      providers.length === 0 ||
      this.modifierStage !== 'normal' ||
      (!this.claudeRunning && !this.agentAttention) ||
      panelVisible ||
      this.openMicLive ||
      this.talking
    ) {
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
      provider: providers[0]!,
      providers,
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

  setMicMenu(open: boolean) {
    this.micMenuShown = open && this.openMicLive && this.dot.isVisible()
    if (this.micMenuShown) this.replySize = { width: 92, height: 24 }
    this.syncSpokenReply()
    if (!open || !this.openMicLive || !this.dot.isVisible()) {
      this.placeDot()
      return null
    }
    const area = this.workArea()
    const pill = micIndicatorBounds(this.dotPosition, area, true)
    const bounds = boundsAtDot(this.dotPosition, area, 148, 108)
    this.dot.setBounds(bounds)
    this.dot.focus()
    return {
      x: pill.x - bounds.x,
      y: pill.y - bounds.y,
      menuY: pill.y > bounds.y ? 2 : pill.height + 2,
    }
  }

  private placeDot(): void {
    if (this.micMenuShown) return
    const bounds = this.openMicLive
      ? spokenReplyBounds(
          this.dotPosition,
          this.workArea(),
          this.replySize.width,
          this.replySize.height,
        )
      : micIndicatorBounds(this.dotPosition, this.workArea(), false)
    const previous = this.dot.getBounds()
    if (
      bounds.x !== previous.x ||
      bounds.y !== previous.y ||
      bounds.width !== previous.width ||
      bounds.height !== previous.height
    )
      this.dot.setBounds(bounds)
    if (this.referenceReady) this.syncReference()
  }

  /**
   * The tallest the panel can be from where it starts (the dot) to the far edge of the screen's
   * work area, leaving the same gap at the far end as the dot has at its own edge (up to 8 px).
   */
  private maxPanelHeight(): number {
    const dot = this.dotBounds()
    const area = this.workArea()
    if (this.workspacePanel) return Math.max(40, area.height)
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
    let area = screen.getDisplayNearestPoint(target).workArea
    if (this.openMicLive && !this.panel.isVisible()) {
      // Use the visible pill, including its reply and any screen-edge clamping, as the drag origin.
      this.liveDragBounds ??= this.dot.getBounds()
      const center = this.liveDragBounds.x + this.liveDragBounds.width / 2 + dx
      const top = this.liveDragBounds.y + dy
      area = screen.getDisplayNearestPoint({ x: Math.round(center), y: Math.round(top) }).workArea
      const right = center > area.x + area.width / 2
      const bottom = top + MIC_PILL_HEIGHT / 2 > area.y + area.height / 2
      target.x = Math.round(center + (right ? MIC_PILL_WIDTH / 2 - DOT_SIZE : -MIC_PILL_WIDTH / 2))
      target.y = Math.round(top + (bottom ? MIC_PILL_HEIGHT - DOT_SIZE : 0))
    }
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
    if (this.liveDragBounds) this.liveDragEndedAt = Date.now()
    this.liveDragBounds = null
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
    if (this.canvasRestore && this.modifierStage !== 'peek') {
      const bounds = squareOverlay(this.workArea(), this.dotPosition)
      const before = this.panel.getBounds()
      this.panel.setBounds(bounds)
      if (before.width !== bounds.width || before.height !== bounds.height)
        this.panel.webContents.send(IPC.panelOpened, {
          maxHeight: bounds.height,
          opensDown: true,
          fresh: false,
          canvasSize: { width: bounds.width, height: bounds.height },
        })
      return
    }
    const dot = this.dotBounds()
    const area = this.workArea()
    const rightGutter = this.panelLayout === 'dual' ? this.rightWireGutter : 0
    const width = this.cardWidth() + WORKSPACE_GUTTER + rightGutter
    const x = clamp(dot.x + DOT_SIZE - width + rightGutter, area.x, area.x + area.width - width)
    const y = this.workspacePanel
      ? clamp(this.workspaceTop ?? dot.y, area.y, area.y + area.height - height)
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
