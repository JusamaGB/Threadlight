import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDotPosition } from '../src/main/windowState'
import { IPC } from '../src/shared/ipc'
import type { Session } from '../src/shared/types'

const state = vi.hoisted(() => ({
  saved: { x: 1200, y: 200 },
  cursor: { x: 1205, y: 205 },
  held: true,
  primary: { x: 0, y: 0, width: 1920, height: 1040 },
  secondary: { x: -1280, y: 0, width: 1280, height: 720 },
  nativeWindows: [] as { visible: boolean; setIgnoreMouseEvents: (ignore: boolean) => void }[],
}))
vi.mock('../src/main/windowState', () => ({
  loadDotPosition: () => state.saved,
  saveDotPosition: vi.fn(),
}))
vi.mock('electron', () => {
  const display = (point: { x: number }) => ({
    bounds: point.x < 0 ? state.secondary : state.primary,
    workArea: point.x < 0 ? state.secondary : state.primary,
  })
  return {
    screen: {
      on: vi.fn(),
      off: vi.fn(),
      getCursorScreenPoint: () => state.cursor,
      getPrimaryDisplay: () => ({ workArea: state.primary }),
      getDisplayMatching: display,
      getDisplayNearestPoint: display,
    },
    shell: {},
    BrowserWindow: class {
      bounds: { x: number; y: number; width: number; height: number }
      visible = false
      webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), send: vi.fn() }
      constructor(size: { width: number; height: number }) {
        this.bounds = { x: 0, y: 0, width: size.width, height: size.height }
        state.nativeWindows.push(this)
      }
      on = vi.fn()
      setAlwaysOnTop = vi.fn()
      moveTop = vi.fn()
      setIgnoreMouseEvents = vi.fn()
      setFocusable = vi.fn()
      setSkipTaskbar = vi.fn()
      loadFile = vi.fn(async () => {})
      focus = vi.fn()
      hide() {
        this.visible = false
      }
      show() {
        this.visible = true
      }
      showInactive() {
        this.visible = true
      }
      getBounds() {
        return this.bounds
      }
      getContentBounds() {
        return this.bounds
      }
      setContentBounds(bounds: typeof this.bounds) {
        this.setBounds(bounds)
      }
      setBounds(bounds: typeof this.bounds) {
        this.bounds = bounds
      }
      isVisible() {
        return this.visible
      }
      isDestroyed() {
        return false
      }
    },
  }
})
vi.mock('../src/main/keyState', () => ({ isKeyDown: () => state.held }))
import {
  PANEL_WIDTH,
  PANEL_WIDTH_DUAL,
  spokenReplyBounds,
  WindowManager,
} from '../src/main/windows'
import { WORKSPACE_GUTTER } from '../src/shared/attentionMotion'

describe('panel movement and available height', () => {
  it('resizes the live dot and suspends its reply for menu, panel and call end', () => {
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    const reply = { id: 'one', text: 'A caption', blocks: [] }
    windows.setSpokenReply(reply)
    const dot = windows.dot
    const sender = dot.webContents
    expect(windows.getSpokenReply(sender)).toEqual(reply)
    expect(windows.getSpokenReply(windows.panel.webContents)).toBeNull()
    windows.setSpokenReplySize(windows.panel.webContents, 296, 200)
    expect(dot.getBounds().width).toBe(92)
    for (const [width, height] of [
      [180, 24],
      [296, 24],
      [296, 200],
      [296, 24],
      [180, 24],
      [92, 24],
    ] as const) {
      windows.setSpokenReplySize(sender, width, height)
      expect(dot.getBounds()).toMatchObject({ width, height })
    }
    windows.setMicMenu(true)
    windows.setSpokenReplySize(sender, 296, 200)
    expect(dot.getBounds().width).toBe(148)
    expect(windows.getSpokenReply(sender)).toBeNull()
    windows.setMicMenu(false)
    expect(windows.getSpokenReply(sender)).toEqual(reply)
    windows.openPanel({ focus: false, fresh: false })
    expect(windows.getSpokenReply(sender)).toBeNull()
    windows.closePanel()
    expect(windows.getSpokenReply(sender)).toEqual(reply)
    windows.setSpokenReply(null)
    expect(windows.getSpokenReply(sender)).toBeNull()
    windows.setOpenMicLive(false)
    windows.setSpokenReplySize(sender, 296, 200)
    expect(dot.getBounds().width).toBe(32)
  })

  it.each([
    { x: -1272, y: 8 },
    { x: -640, y: 300 },
    { x: -104, y: 685 },
    { x: -8, y: 710 },
  ])('unfolds within the work area at %j', (anchor) => {
    const area = state.secondary
    const rest = spokenReplyBounds(anchor, area, 92, 24)
    for (const [width, height] of [
      [92, 56],
      [137, 56],
      [221, 56],
      [296, 24],
      [296, 256],
    ] as const) {
      const box = spokenReplyBounds(anchor, area, width, height)
      expect(box.x).toBe(
        Math.max(
          area.x,
          Math.min(area.x + area.width - width, Math.round(rest.x + (rest.width - width) / 2)),
        ),
      )
      expect(box.x).toBeGreaterThanOrEqual(area.x)
      expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width)
      expect(box.y).toBe(Math.min(rest.y, area.y + area.height - height))
      expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height)
    }
  })

  it('accepts non-focusing hover only over the waveform and outside an active press, drag or menu', () => {
    state.held = false
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    windows.setSpokenReplySize(windows.dot.webContents, 296, 200)
    const bounds = windows.dot.getBounds()
    state.cursor = { x: bounds.x + 20, y: bounds.y + 60 }
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
    state.cursor.y = bounds.y + 10
    state.held = true
    windows.openFromDot(true)
    state.held = false
    expect(windows.panel.isVisible()).toBe(false)
    windows.setMicMenu(true)
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
    windows.setMicMenu(false)
    windows.setSpokenReplySize(windows.dot.webContents, 296, 200)
    windows.dragDot(6, 0)
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
    windows.endDrag()
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
    vi.advanceTimersByTime(240)
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(true)
    expect(windows.panel.focus).not.toHaveBeenCalled()
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(
      IPC.panelOpened,
      expect.objectContaining({ fresh: false, fromMic: true }),
    )
  })

  it.each([
    { x: 720, y: 410, width: 92 },
    { x: 1000, y: 600, width: 296 },
    { x: -650, y: 300, width: 296 },
    { x: 0, y: 0, width: 92 },
    { x: 1888, y: 1008, width: 296 },
  ])('keeps a stationary waveform pointer across the panel handoff at %j', ({ x, y, width }) => {
    state.saved = { x, y }
    state.held = false
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    windows.setSpokenReplySize(windows.dot.webContents, width, width === 92 ? 24 : 138)
    const wave = windows.dot.getBounds()
    const display = x < 0 ? state.secondary : state.primary
    state.cursor = { x: wave.x + 2, y: wave.y + 12 }
    windows.openFromDot(true)
    for (const height of [120, 320, 205]) {
      windows.resizePanel(height)
      const b = windows.panel.getBounds()
      const centerX = wave.x + wave.width / 2
      const centerY = wave.y + 12
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
      expect(b.x).toBe(
        clamp(
          Math.round(centerX - PANEL_WIDTH / 2) - WORKSPACE_GUTTER,
          display.x,
          display.x + display.width - b.width,
        ),
      )
      expect(b.y).toBe(
        clamp(Math.round(centerY - height / 2), display.y, display.y + display.height - height),
      )
      vi.advanceTimersByTime(550)
      windows.closeOnPointerLeave()
      expect(windows.panel.isVisible()).toBe(true)
      expect(windows.panel.webContents.send).not.toHaveBeenCalledWith(IPC.panelPointerOutside)
      expect(windows.panel.setIgnoreMouseEvents).not.toHaveBeenCalledWith(true, { forward: true })
    }
    expect(
      vi.mocked(windows.panel.webContents.send).mock.calls.filter(([c]) => c === IPC.panelOpened),
    ).toHaveLength(1)
    state.cursor = { x: display.x + display.width + 40, y: display.y + display.height + 40 }
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(false)
  })

  it('moves the expanded reply from a clamped edge and saves the resting anchor on release', () => {
    vi.mocked(saveDotPosition).mockClear()
    state.saved = { x: 8, y: 8 }
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    windows.setSpokenReplySize(windows.dot.webContents, 296, 200)
    const before = windows.dot.getBounds()
    windows.dragDot(36, 18)
    expect(windows.dot.getBounds()).toEqual({ ...before, x: before.x + 36, y: before.y + 18 })
    windows.dragDot(70, 25)
    expect(windows.dot.getBounds()).toEqual({ ...before, x: before.x + 70, y: before.y + 25 })
    expect(windows.panel.isVisible()).toBe(false)
    windows.dragDot(-500, 1000)
    const final = windows.dot.getBounds()
    expect(final.x).toBeGreaterThanOrEqual(state.secondary.x)
    expect(final.x + final.width).toBeLessThanOrEqual(state.secondary.x + state.secondary.width)
    expect(final.y + final.height).toBeLessThanOrEqual(state.secondary.y + state.secondary.height)
    windows.endDrag()
    expect(saveDotPosition).toHaveBeenCalledTimes(1)
    state.saved = vi.mocked(saveDotPosition).mock.calls.at(-1)![0]
    const restored = new WindowManager()
    restored.setOpenMicLive(true)
    restored.setSpokenReplySize(restored.dot.webContents, 296, 200)
    expect(restored.dot.getBounds()).toEqual(final)
  })

  it('routes waveform clicks to the live conversation, then collapses back to the still-live pill', () => {
    const windows = new WindowManager()
    windows.setClaudeRunning(true)
    windows.setOpenMicLive(true)
    state.cursor = { x: 400, y: 400 }
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
    windows.openFromDot()
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(
      IPC.panelOpened,
      expect.objectContaining({ fresh: false, fromMic: true }),
    )
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    vi.advanceTimersByTime(350)
    windows.setStayOpen(true)
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    windows.setStayOpen(false)
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(false)
    expect(windows.dot.isVisible()).toBe(true)
    windows.openFromDot()
    expect(windows.panel.isVisible()).toBe(true)
    windows.setOpenMicLive(false)
  })

  it.each([
    { x: 8, y: 8 },
    { x: 1878, y: 994 },
    { x: -1250, y: 675 },
  ])('keeps the live waveform anchored and menu visible at %j', (anchor) => {
    state.saved = anchor
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    const pill = windows.dot.getBounds()
    const placement = windows.setMicMenu(true)!
    const bounds = windows.dot.getBounds()
    const screen = anchor.x < 0 ? state.secondary : state.primary
    expect(bounds.x + placement.x).toBe(pill.x)
    expect(bounds.y + placement.y).toBe(pill.y)
    expect(bounds.x).toBeGreaterThanOrEqual(screen.x)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(screen.y + screen.height)
    expect(placement.menuY + 74).toBeLessThanOrEqual(bounds.height)
    windows.setMicMenu(false)
    expect(windows.dot.getBounds()).toEqual(pill)
    expect(windows.panel.isVisible()).toBe(false)
  })

  it('keeps the call menu available while listening independently of provider-window polling', () => {
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    expect(windows.dot.isVisible()).toBe(true)
    expect(windows.dot.setFocusable).toHaveBeenLastCalledWith(true)
    expect(windows.dot.focus).not.toHaveBeenCalled()
    windows.setClaudeRunning(true)
    windows.setClaudeRunning(false)
    expect(windows.dot.isVisible()).toBe(true)
    windows.setOpenMicLive(false)
    expect(windows.dot.setFocusable).toHaveBeenLastCalledWith(false)
    expect(windows.dot.isVisible()).toBe(false)
  })

  it.each(['dot', 'panel'] as const)(
    'ignores a delayed panel leave or close when the %s closes first',
    (target) => {
      const windows = new WindowManager()
      windows.setClaudeRunning(true)
      windows.openPanel()
      const bounds = windows.panel.getBounds()
      state.cursor = { x: bounds.x + 1, y: bounds.y + 1 }
      vi.advanceTimersByTime(16)
      expect(windows.panel.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
      state.cursor = { x: 0, y: 0 }
      vi.spyOn(windows[target], 'isDestroyed').mockReturnValue(true)
      const destroyed = () => {
        throw new Error('Object has been destroyed')
      }
      vi.spyOn(windows[target], 'getBounds').mockImplementation(destroyed)
      vi.spyOn(windows[target], 'isVisible').mockImplementation(destroyed)
      vi.spyOn(windows[target], 'showInactive').mockImplementation(destroyed)
      vi.spyOn(windows[target], 'setIgnoreMouseEvents').mockImplementation(destroyed)
      expect(() => windows.closeOnPointerLeave()).not.toThrow()
      expect(() => vi.advanceTimersByTime(16)).not.toThrow()
      expect(() => windows.closePanel()).not.toThrow()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each(['dot', 'panel'] as const)(
    'ignores queued callbacks after the %s is destroyed during restart',
    (target) => {
      const windows = new WindowManager()
      windows.setClaudeRunning(true)
      windows.keepOnTop()
      expect(windows.dot.moveTop).toHaveBeenCalledOnce()
      vi.spyOn(windows[target], 'isDestroyed').mockReturnValue(true)
      vi.spyOn(windows[target], 'isVisible').mockImplementation(() => {
        throw new Error('Object has been destroyed')
      })
      vi.mocked(windows.dot.moveTop).mockClear()
      vi.mocked(windows.dot.setAlwaysOnTop).mockClear()
      expect(() => windows.keepOnTop()).not.toThrow()
      expect(() => windows.setClaudeRunning(false)).not.toThrow()
      expect(() => windows.setClaudeRunning(true)).not.toThrow()
      expect(() => windows.openFromDot()).not.toThrow()
      expect(() => windows.setAttention([])).not.toThrow()
      expect(windows.dot.moveTop).not.toHaveBeenCalled()
      expect(windows.dot.setAlwaysOnTop).not.toHaveBeenCalled()
    },
  )
  it('expands temporarily within the work area and restores single and dual geometry', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.resizePanel(400)
    const before = windows.panel.getBounds()
    expect(windows.setCanvasExpanded(true)).toEqual({ width: 900, height: 900 })
    windows.resizePanel(200)
    expect(windows.panel.getBounds().height).toBe(900)
    windows.setCanvasExpanded(false)
    expect(windows.panel.getBounds()).toEqual(before)
    windows.setPanelLayout('dual')
    const dual = windows.panel.getBounds()
    windows.setCanvasExpanded(true)
    windows.setCanvasExpanded(false)
    expect(windows.panel.getBounds()).toEqual(dual)
    expect(windows.setCanvasExpanded('yes')).toBeNull()
  })
  it('fits a constrained secondary display without changing the saved panel layout', () => {
    state.saved = { x: -300, y: 600 }
    const windows = new WindowManager()
    windows.openPanel()
    const before = windows.panel.getBounds()
    expect(windows.setCanvasExpanded(true)).toEqual({ width: 720, height: 720 })
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 720 })
    windows.setCanvasExpanded(false)
    expect(windows.panel.getBounds()).toEqual(before)
  })

  it('does not mount renderers before backend registration and loads each only once', async () => {
    const windows = new WindowManager()
    expect(windows.panel.loadFile).not.toHaveBeenCalled()
    expect(windows.dot.loadFile).not.toHaveBeenCalled()
    const first = windows.loadRenderers()
    expect(windows.loadRenderers()).toBe(first)
    await first
    expect(windows.panel.loadFile).toHaveBeenCalledTimes(1)
    expect(windows.dot.loadFile).toHaveBeenCalledTimes(1)
  })
  it('uses the full work area for Workspace, keeps its top fixed on resize, and restores normal layout', () => {
    const windows = new WindowManager()
    windows.openPanel()
    expect(windows.setWorkspacePanel(true)).toEqual({
      maxHeight: 1040,
      opensDown: true,
      fresh: false,
    })
    windows.resizePanel(1040)
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 1040 })
    windows.resizePanel(540)
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 540 })
    windows.dragDot(0, 50)
    expect(windows.panel.getBounds()).toMatchObject({ y: 50, height: 540 })
    windows.endDrag()
    expect(windows.setWorkspacePanel(false)).toEqual({
      maxHeight: 782,
      opensDown: true,
      fresh: false,
    })
    expect(windows.panel.getBounds()).toMatchObject({ y: 250, height: 540 })
  })

  it('keeps Workspace inside a smaller display and resets the layout on a fresh Active open', () => {
    state.saved = { x: -300, y: 600 }
    const windows = new WindowManager()
    windows.openPanel()
    expect(windows.setWorkspacePanel(true).maxHeight).toBe(720)
    windows.resizePanel(2000)
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 720 })
    windows.resizePanel(400)
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 400 })
    windows.openPanel({ fresh: true })
    expect(windows.panel.getBounds()).toMatchObject({ y: 232, height: 400 })
  })

  beforeEach(() => {
    vi.useFakeTimers()
    state.saved = { x: 1200, y: 200 }
    state.cursor = { x: 1205, y: 205 }
    state.nativeWindows = []
    state.held = true
  })
  afterEach(() => vi.useRealTimers())

  it('retains a code pan outside the panel and continues scrolling at a stationary screen edge until release', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.codePan('grab', true)
    state.cursor = { x: 300, y: 500 }
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    vi.advanceTimersByTime(16)
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.codePanMotion, {
      id: 'grab',
      dx: 905,
      dy: -295,
    })
    state.cursor = { x: -1280, y: 500 }
    vi.advanceTimersByTime(48)
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.codePanMotion, {
      id: 'grab',
      dx: 4,
      dy: 0,
    })
    state.held = false
    vi.advanceTimersByTime(16)
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.codePanMotion, {
      id: 'grab',
      end: true,
      dx: 0,
      dy: 0,
    })
  })

  it('keeps the external wire gutter click-through while the card remains interactive', () => {
    const windows = new WindowManager()
    windows.openPanel()
    const bounds = windows.panel.getBounds()
    expect(bounds.width).toBe(PANEL_WIDTH + WORKSPACE_GUTTER)
    state.cursor = { x: bounds.x + 8, y: bounds.y + 30 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor.x = bounds.x + 25
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
  })

  it('keeps the outside video corner interactive and protects manual sizing from card measurements', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.resizePanel(290)
    const original = windows.panel.getBounds()
    const sizing = windows.videoSizing
    sizing.active = true
    state.cursor = { x: original.x + 8, y: original.y + 30 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor.y = original.y + original.height - 2
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    const guest = { x: 13, y: 32, width: 236, height: 236 }
    const card = { x: 12, y: 0, width: 238, height: 286 }
    sizing.gesture({ phase: 'begin', edge: 'left', card }, guest, 16 / 9)
    sizing.gesture({ phase: 'move', dx: -5000, dy: 5000 }, guest, 16 / 9)
    const enlarged = windows.panel.getBounds()
    expect(enlarged.x + enlarged.width).toBe(original.x + original.width)
    expect(enlarged.x).toBeGreaterThanOrEqual(state.primary.x)
    expect(enlarged.height).toBeGreaterThan(original.height)
    expect(enlarged.y + enlarged.height).toBeLessThanOrEqual(state.primary.height)
    sizing.gesture({ phase: 'end' }, guest, 16 / 9)
    windows.resizePanel(290)
    expect(windows.panel.getBounds()).toEqual(enlarged)
    sizing.reset()
    expect(windows.panel.getBounds()).toEqual(original)
  })

  it('hides the dot for Control despite keep-on-top and restores it on release', () => {
    const windows = new WindowManager()
    windows.setClaudeRunning(true)
    expect(windows.dot.isVisible()).toBe(true)
    windows.setModifierStage('hidden')
    expect(windows.dot.isVisible()).toBe(false)
    windows.keepOnTop()
    windows.openFromDot()
    expect(windows.dot.isVisible()).toBe(false)
    expect(windows.panel.isVisible()).toBe(false)
    windows.setModifierStage('normal')
    expect(windows.dot.isVisible()).toBe(true)
  })

  it('shows an unfocused click-through peek until release, then restores the dot', () => {
    const windows = new WindowManager()
    windows.setClaudeRunning(true)
    windows.setModifierStage('hidden')
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.panelControlHeld, true)
    windows.setModifierStage('peek')
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.panelControlHeld, false)
    expect(windows.panel.isVisible()).toBe(true)
    expect(windows.dot.isVisible()).toBe(false)
    expect(windows.panel.focus).not.toHaveBeenCalled()
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor = { x: 10, y: 10 }
    vi.advanceTimersByTime(50)
    windows.closeOnPointerLeave()
    windows.closePanel()
    expect(windows.panel.isVisible()).toBe(true)
    windows.setModifierStage('hidden')
    expect(windows.panel.isVisible()).toBe(false)
    expect(windows.dot.isVisible()).toBe(false)
    windows.setModifierStage('normal')
    expect(windows.dot.isVisible()).toBe(true)
  })

  it('restores an existing pinned Workspace and dual bounds after a temporary peek', () => {
    const windows = new WindowManager()
    windows.setClaudeRunning(true)
    windows.openPanel()
    windows.setWorkspacePanel(true)
    windows.setPanelLayout('dual')
    windows.setWorkspaceWireGutter(10)
    windows.resizePanel(700)
    windows.setStayOpen(true)
    const before = windows.panel.getBounds()
    windows.setModifierStage('peek')
    windows.setPanelLayout('single')
    windows.setWorkspacePanel(false)
    windows.resizePanel(100)
    windows.setModifierStage('normal')
    expect(windows.panel.isVisible()).toBe(true)
    expect(windows.panel.getBounds()).toEqual(before)
    state.cursor = { x: 10, y: 10 }
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.panelPeek, false)
  })

  it('accepts clicks on the header wire clip while the rest of the gutter passes through', () => {
    const windows = new WindowManager()
    windows.openPanel()
    const bounds = windows.panel.getBounds()
    windows.setWorkspaceWireControl({ top: 1, height: 24 })
    state.cursor = { x: bounds.x + 8, y: bounds.y + 40 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor.y = bounds.y + 12
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    // An upward-opening popup can move the header down within its native window.
    windows.setWorkspaceWireControl({ top: 70, height: 24 })
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor.y = bounds.y + 80
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    windows.setWorkspaceWireControl(null)
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })

  it('accepts clicks on each wire but leaves the gaps between wires click-through', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.resizePanel(600)
    const bounds = windows.panel.getBounds()
    windows.setWorkspaceWireRegions([{ x: 8, y: 100, width: 8, height: 200 }])
    state.cursor = { x: bounds.x + 12, y: bounds.y + 40 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor = { x: bounds.x + 12, y: bounds.y + 150 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    state.cursor.y = bounds.y + 320
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor = { x: bounds.x + 2, y: bounds.y + 150 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    // Malformed regions from the page are ignored, not trusted.
    state.cursor = { x: bounds.x + 12, y: bounds.y + 150 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    windows.setWorkspaceWireRegions([{ x: -5, y: 0, width: 8, height: 8 }, 'bad', null])
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })

  it('widens the panel leftwards for dual view, keeps its right edge, and narrows it again', () => {
    const windows = new WindowManager()
    windows.setWorkspaceWireGutter(16)
    windows.openPanel()
    const single = windows.panel.getBounds()
    expect(windows.setPanelLayout('dual')).toEqual({ cardWidth: PANEL_WIDTH_DUAL })
    const dual = windows.panel.getBounds()
    expect(dual.width).toBe(PANEL_WIDTH_DUAL + 2 * WORKSPACE_GUTTER)
    expect(dual.x + dual.width - WORKSPACE_GUTTER).toBe(single.x + single.width)
    expect(dual.y).toBe(single.y)
    expect(windows.setPanelLayout('single')).toEqual({ cardWidth: PANEL_WIDTH })
    expect(windows.panel.getBounds()).toMatchObject({ x: single.x, width: single.width })
    // Anything else is refused and changes nothing.
    expect(windows.setPanelLayout('triple')).toBeNull()
    expect(windows.panel.getBounds().width).toBe(single.width)
  })

  it('can start the animation window without changing the width', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.setPanelLayout('dual')
    vi.advanceTimersByTime(1100)
    const wide = windows.panel.getBounds()
    state.cursor = { x: wide.x + 8, y: wide.y + 30 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    expect(windows.setPanelLayout('dual', true)).toEqual({ cardWidth: PANEL_WIDTH_DUAL })
    expect(windows.panel.getBounds()).toEqual(wide)
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    vi.advanceTimersByTime(1100)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })

  it('keeps dual view inside a narrow work area', () => {
    state.saved = { x: -300, y: 100 }
    state.secondary = { x: -1280, y: 0, width: 400, height: 720 }
    const windows = new WindowManager()
    windows.setWorkspaceWireGutter(10)
    windows.openPanel()
    const { cardWidth } = windows.setPanelLayout('dual')!
    expect(cardWidth).toBe(400 - 16 - WORKSPACE_GUTTER - 10)
    const bounds = windows.panel.getBounds()
    expect(bounds.x).toBeGreaterThanOrEqual(-1280)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(-880)
    state.secondary = { x: -1280, y: 0, width: 1280, height: 720 }
  })

  it('passes both dual gutters through, with the header clip intercepting only on the left', () => {
    const windows = new WindowManager()
    windows.setWorkspaceWireGutter(16)
    windows.openPanel()
    windows.setPanelLayout('dual')
    vi.advanceTimersByTime(1100)
    windows.setWorkspaceWireControl({ top: 1, height: 24 })
    const bounds = windows.panel.getBounds()
    state.cursor = { x: bounds.x + bounds.width - 8, y: bounds.y + 12 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor.x = bounds.x + 8
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    state.cursor.y = bounds.y + 40
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    state.cursor.x = bounds.x + bounds.width - WORKSPACE_GUTTER - 1
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    // Returning to single view removes the extra transparent right edge.
    windows.setPanelLayout('single')
    vi.advanceTimersByTime(1100)
    const single = windows.panel.getBounds()
    state.cursor = { x: single.x + single.width - 8, y: single.y + 40 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
  })

  it('keeps the right gutter on-screen when the dot is at the display edge', () => {
    state.saved = { x: 1888, y: 200 }
    const windows = new WindowManager()
    windows.setWorkspaceWireGutter(16)
    windows.openPanel()
    windows.setPanelLayout('dual')
    const dual = windows.panel.getBounds()
    expect(dual.x + dual.width).toBe(1920)
    expect(dual.width).toBe(PANEL_WIDTH_DUAL + 2 * WORKSPACE_GUTTER)
  })

  it('fits the right gutter to requested lanes and removes it when no wires remain', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.setWorkspacePanel(true)
    windows.setPanelLayout('dual')
    const empty = windows.panel.getBounds()
    expect(empty.width).toBe(PANEL_WIDTH_DUAL + WORKSPACE_GUTTER)
    windows.setWorkspaceWireGutter(6)
    expect(windows.panel.getBounds().width).toBe(empty.width + 6)
    expect(windows.panel.getBounds().x).toBe(empty.x)
    windows.setWorkspaceWireGutter(10)
    expect(windows.panel.getBounds().width).toBe(empty.width + 10)
    vi.advanceTimersByTime(1100)
    const bounds = windows.panel.getBounds()
    state.cursor = { x: bounds.x + bounds.width - 5, y: bounds.y + 50 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    windows.setWorkspaceWireGutter(0)
    expect(windows.panel.getBounds()).toEqual(empty)
    for (const invalid of [-1, 17, 1.5, NaN, Infinity, '6', null]) {
      expect(windows.setWorkspaceWireGutter(invalid)).toBeNull()
      expect(windows.panel.getBounds()).toEqual(empty)
    }
  })

  it('lets Workspace reach the work-area top and bottom after dragging and resizing', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.setWorkspacePanel(true)
    windows.resizePanel(500)
    windows.dragDot(0, -1000)
    windows.endDrag()
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 500 })
    windows.dragDot(0, 5000)
    windows.endDrag()
    expect(windows.panel.getBounds()).toMatchObject({ y: 540, height: 500 })
    windows.resizePanel(1040)
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 1040 })
  })

  it('takes the gutter out of click-through only while the layout animates', () => {
    const windows = new WindowManager()
    windows.openPanel()
    const bounds = windows.panel.getBounds()
    state.cursor = { x: bounds.x + 8, y: bounds.y + 80 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    windows.setPanelLayout('dual')
    const moved = windows.panel.getBounds()
    state.cursor = { x: moved.x + 8, y: moved.y + 80 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    vi.advanceTimersByTime(1100)
    expect(windows.panel.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })

  it('keeps attention painted but hidden behind the panel, with capture taking priority', () => {
    const windows = new WindowManager()
    const thread = {
      id: 'codex:needs-input',
      state: 'waiting',
      attention: null,
      lastActiveAt: 10,
    } as Session
    windows.setAttention([thread])
    expect(windows.attentionMotion.active).toBe(false)
    windows.setClaudeRunning(true)
    expect(windows.attentionMotion).toMatchObject({
      active: true,
      provider: 'codex',
      providers: ['codex'],
      floor: 840,
    })
    windows.openPanel()
    expect(windows.attentionMotion.active).toBe(false)
    expect(state.nativeWindows.at(-1)?.visible).toBe(false)
    windows.closePanel()
    expect(windows.attentionMotion.active).toBe(true)
    expect(state.nativeWindows.at(-1)?.visible).toBe(true)
    windows.setOpenMicLive(true)
    expect(windows.attentionMotion.active).toBe(false)
    windows.setOpenMicLive(false)
    windows.setTalking(true)
    expect(windows.attentionMotion.active).toBe(false)
    windows.setTalking(false)
    expect(windows.attentionMotion.active).toBe(true)
    windows.setAttention([])
    expect(windows.attentionMotion.active).toBe(false)
  })

  it('shows Agent question drips and keeps the panel open when the question clears', () => {
    const windows = new WindowManager()
    windows.setAgentAttention('codex')
    expect(windows.attentionMotion).toMatchObject({ active: true, providers: ['codex'] })
    windows.openPanel()
    windows.setAgentAttention(null)
    expect(windows.panel.isVisible()).toBe(true)
    expect(windows.attentionMotion.active).toBe(false)
    windows.setClaudeRunning(true)
    windows.closePanel()
    windows.setAttention([
      { id: 'claude-waiting', state: 'waiting', attention: null, lastActiveAt: 1 } as Session,
    ])
    windows.setAgentAttention('codex')
    expect(windows.attentionMotion.providers).toEqual(['codex', 'claude'])
    windows.setAgentAttention(null)
    expect(windows.attentionMotion.providers).toEqual(['claude'])
  })

  it('keeps the live pill lit through pending inputs and cools only after the last clears', () => {
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    const session = {
      id: 'claude-live',
      state: 'working',
      attention: null,
      lastActiveAt: 1,
    } as Session
    windows.setAttention([session])
    expect(windows.attentionMotion.pill).toBeUndefined()
    windows.setAgentAttention('codex')
    expect(windows.attentionMotion).toMatchObject({
      active: false,
      pill: { width: 92, waiting: true },
    })
    expect(state.nativeWindows.at(-1)?.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    windows.setAttention([{ ...session, state: 'waiting' }])
    windows.setAgentAttention(null)
    expect(windows.attentionMotion.pill?.waiting).toBe(true)
    windows.setAttention([])
    expect(windows.attentionMotion.pill?.waiting).toBe(false)
    windows.setAgentAttention('codex')
    vi.advanceTimersByTime(700)
    expect(windows.attentionMotion.pill?.waiting).toBe(true)
    windows.openPanel()
    expect(windows.attentionMotion.pill).toBeUndefined()
    windows.closePanel()
    expect(windows.attentionMotion.pill?.waiting).toBe(true)
    windows.setAgentAttention(null)
    vi.advanceTimersByTime(700)
    expect(windows.attentionMotion.pill).toBeUndefined()
    expect(state.nativeWindows.at(-1)?.visible).toBe(false)
  })

  it('drips once per waiting thread in the order the panel lists them, as threads are answered', () => {
    const windows = new WindowManager()
    windows.setClaudeRunning(true)
    const claude = {
      id: 'claude-waiting',
      state: 'waiting',
      attention: null,
      lastActiveAt: 10,
    } as Session
    const codex = { ...claude, id: 'codex:waiting', lastActiveAt: 20 } as Session
    windows.setAttention([claude])
    expect(windows.attentionMotion.providers).toEqual(['claude'])
    // Newest first, like the Active list: the Codex thread is listed above the Claude one.
    windows.setAttention([claude, codex])
    expect(windows.attentionMotion.providers).toEqual(['codex', 'claude'])
    expect(windows.attentionMotion.provider).toBe('codex')
    windows.setAttention([{ ...claude, state: 'idle' }, codex])
    expect(windows.attentionMotion.providers).toEqual(['codex'])
    windows.setAttention([
      { ...claude, state: 'idle' },
      { ...codex, state: 'idle' },
    ])
    expect(windows.attentionMotion.active).toBe(false)
    // Ten drips at most, however many threads are waiting.
    const crowd = Array.from(
      { length: 14 },
      (_, i) => ({ ...claude, id: `claude-${i}`, lastActiveAt: i }) as Session,
    )
    windows.setAttention(crowd)
    expect(windows.attentionMotion.providers).toHaveLength(10)
    windows.setClaudeRunning(false)
    expect(windows.attentionMotion.active).toBe(false)
  })

  it('refreshes room during each drag without resetting the expanded view', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.resizePanel(1000)
    expect(windows.panel.getBounds().height).toBe(832)
    windows.dragDot(0, -150)
    expect(windows.panel.webContents.send).toHaveBeenLastCalledWith(IPC.panelOpened, {
      maxHeight: 982,
      opensDown: true,
      fresh: false,
    })
    windows.resizePanel(960)
    expect(windows.panel.getBounds()).toMatchObject({ y: 50, height: 960 })
    windows.dragDot(0, 100)
    expect(windows.panel.getBounds()).toMatchObject({ y: 300, height: 732 })
  })

  it('opens once for duplicate hover/click events from the replaced dot', () => {
    const windows = new WindowManager()
    windows.dot.show()
    windows.openFromDot(true)
    windows.openFromDot(true)
    windows.openFromDot()
    expect(windows.panel.webContents.send).toHaveBeenCalledTimes(1)
    expect(windows.panel.isVisible()).toBe(true)
  })

  it('discards a queued hover once the mouse has left, while keyboard clicks still open', () => {
    const windows = new WindowManager()
    windows.dot.show()
    state.cursor = { x: 400, y: 400 }
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
    windows.openFromDot()
    expect(windows.panel.isVisible()).toBe(true)
  })

  it('rejects stale leave events inside the panel and closes immediately outside it', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    state.cursor = { x: 400, y: 400 }
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(false)
    windows.dot.show()
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(false)
  })

  it('waits for pointer re-entry after a shorter Live page moves away from Back', () => {
    state.saved = { x: 850, y: 460 }
    const windows = new WindowManager()
    windows.setOpenMicLive(true)
    windows.openFromDot()
    windows.resizePanel(400)
    const agent = windows.panel.getBounds()
    state.cursor = { x: agent.x + 48, y: agent.y + 14 }
    windows.resizePanel(100)
    const list = windows.panel.getBounds()
    expect(state.cursor.y).toBeLessThan(list.y)
    vi.mocked(windows.panel.webContents.send).mockClear()
    vi.advanceTimersByTime(3000)
    expect(windows.panel.webContents.send).not.toHaveBeenCalledWith(IPC.panelPointerOutside)
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    state.cursor = { x: list.x + 40, y: list.y + 10 }
    vi.advanceTimersByTime(16)
    state.cursor.y = list.y - 2
    vi.advanceTimersByTime(16)
    expect(windows.panel.webContents.send).toHaveBeenCalledWith(IPC.panelPointerOutside)
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(false)
  })

  it('holds a narrowing panel only when the resize moved it off the pointer', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.setPanelLayout('dual')
    const wide = windows.panel.getBounds()
    state.cursor = { x: wide.x + 40, y: wide.y + 15 }
    windows.setPanelLayout('single')
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    // An explicit close still works, and the next opening gets ordinary hover behaviour.
    windows.closePanel()
    expect(windows.panel.isVisible()).toBe(false)
    windows.openPanel()
    state.cursor = { x: 400, y: 400 }
    windows.resizePanel(50)
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(false)
  })

  it('ignores a delayed handoff blur while hovered, but still closes outside and honours pinning', () => {
    const windows = new WindowManager()
    const blur = vi
      .mocked(windows.panel.on as (event: string, listener: () => void) => void)
      .mock.calls.find(([event]) => event === 'blur')![1]
    windows.openPanel({ focus: false })
    blur()
    expect(windows.panel.isVisible()).toBe(true)
    state.cursor = { x: 400, y: 400 }
    windows.setStayOpen(true)
    blur()
    expect(windows.panel.isVisible()).toBe(true)
    windows.setStayOpen(false)
    blur()
    expect(windows.panel.isVisible()).toBe(false)
  })

  it('detects a native pointer exit even without a browser leave event', () => {
    const windows = new WindowManager()
    windows.openPanel()
    state.cursor = { x: 400, y: 400 }
    vi.advanceTimersByTime(16)
    expect(windows.panel.webContents.send).toHaveBeenLastCalledWith(IPC.panelPointerOutside)
    windows.closeOnPointerLeave()
    const calls = vi.mocked(windows.panel.webContents.send).mock.calls.length
    vi.advanceTimersByTime(100)
    expect(windows.panel.webContents.send).toHaveBeenCalledTimes(calls)
  })

  it('preserves pins, but a fresh hover clears an old pin without taking focus', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.setStayOpen(true)
    state.cursor = { x: 400, y: 400 }
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(true)
    windows.openPanel({ focus: false, fresh: true })
    windows.closeOnPointerLeave()
    expect(windows.panel.isVisible()).toBe(false)
    windows.dot.show()
    state.cursor = { x: 1205, y: 205 }
    vi.mocked(windows.panel.focus).mockClear()
    windows.openFromDot(true)
    expect(windows.panel.isVisible()).toBe(true)
    expect(windows.panel.focus).not.toHaveBeenCalled()
  })

  it('updates direction and clamps immediately on a shorter display', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.resizePanel(800)
    windows.dragDot(-1500, 400)
    expect(windows.panel.webContents.send).toHaveBeenLastCalledWith(IPC.panelOpened, {
      maxHeight: 624,
      opensDown: false,
      fresh: false,
    })
    expect(windows.panel.getBounds()).toMatchObject({ x: -522, y: 8, height: 624 })
    windows.endDrag()
    windows.dragDot(0, 98)
    expect(windows.panel.webContents.send).toHaveBeenLastCalledWith(IPC.panelOpened, {
      maxHeight: 720,
      opensDown: false,
      fresh: false,
    })
    windows.resizePanel(900)
    expect(windows.panel.getBounds()).toMatchObject({ y: 0, height: 720 })
  })

  it('refreshes upward room when moving towards the bottom edge', () => {
    state.saved.y = 800
    const windows = new WindowManager()
    windows.openPanel()
    windows.dragDot(0, 200)
    expect(windows.panel.webContents.send).toHaveBeenLastCalledWith(IPC.panelOpened, {
      maxHeight: 1024,
      opensDown: false,
      fresh: false,
    })
  })

  it('refreshes room when resetting the position', () => {
    const windows = new WindowManager()
    windows.openPanel()
    windows.resetDotPosition()
    expect(windows.panel.webContents.send).toHaveBeenLastCalledWith(IPC.panelOpened, {
      maxHeight: 1024,
      opensDown: true,
      fresh: false,
    })
  })

  it('does not send layout events or reveal a hidden panel while dragging the dot', () => {
    const windows = new WindowManager()
    windows.dragDot(0, -100)
    expect(windows.panel.webContents.send).not.toHaveBeenCalled()
    expect(windows.panel.isVisible()).toBe(false)
  })
})
