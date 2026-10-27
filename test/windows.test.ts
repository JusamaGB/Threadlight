import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/shared/ipc'
import type { Session } from '../src/shared/types'

const state = vi.hoisted(() => ({
  saved: { x: 1200, y: 200 },
  cursor: { x: 1205, y: 205 },
  primary: { x: 0, y: 0, width: 1920, height: 1040 },
  secondary: { x: -1280, y: 0, width: 1280, height: 720 },
  nativeWindows: [] as { visible: boolean }[],
}))
vi.mock('../src/main/windowState', () => ({
  loadDotPosition: () => state.saved,
  saveDotPosition: vi.fn(),
}))
vi.mock('electron', () => {
  const display = (point: { x: number }) => ({
    workArea: point.x < 0 ? state.secondary : state.primary,
  })
  return {
    screen: {
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
      setIgnoreMouseEvents = vi.fn()
      loadFile = vi.fn()
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
      setBounds(bounds: typeof this.bounds) {
        this.bounds = bounds
      }
      isVisible() {
        return this.visible
      }
    },
  }
})
import { PANEL_WIDTH, PANEL_WIDTH_DUAL, WindowManager } from '../src/main/windows'
import { WORKSPACE_GUTTER } from '../src/shared/attentionMotion'

describe('panel movement and available height', () => {
  it('uses the full work area for Workspace, keeps its top fixed on resize, and restores normal layout', () => {
    const windows = new WindowManager()
    windows.openPanel()
    expect(windows.setWorkspacePanel(true)).toEqual({
      maxHeight: 1024,
      opensDown: true,
      fresh: false,
    })
    windows.resizePanel(1024)
    expect(windows.panel.getBounds()).toMatchObject({ y: 8, height: 1024 })
    windows.resizePanel(540)
    expect(windows.panel.getBounds()).toMatchObject({ y: 8, height: 540 })
    windows.dragDot(0, 50)
    expect(windows.panel.getBounds()).toMatchObject({ y: 58, height: 540 })
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
    expect(windows.setWorkspacePanel(true).maxHeight).toBe(704)
    windows.resizePanel(2000)
    expect(windows.panel.getBounds()).toMatchObject({ y: 8, height: 704 })
    windows.resizePanel(400)
    expect(windows.panel.getBounds()).toMatchObject({ y: 8, height: 400 })
    windows.openPanel({ fresh: true })
    expect(windows.panel.getBounds()).toMatchObject({ y: 232, height: 400 })
  })

  beforeEach(() => {
    vi.useFakeTimers()
    state.saved = { x: 1200, y: 200 }
    state.cursor = { x: 1205, y: 205 }
    state.nativeWindows = []
  })
  afterEach(() => vi.useRealTimers())

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
    windows.openPanel()
    const single = windows.panel.getBounds()
    expect(windows.setPanelLayout('dual')).toEqual({ cardWidth: PANEL_WIDTH_DUAL })
    const dual = windows.panel.getBounds()
    expect(dual.width).toBe(PANEL_WIDTH_DUAL + WORKSPACE_GUTTER)
    expect(dual.x + dual.width).toBe(single.x + single.width)
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
    windows.openPanel()
    const { cardWidth } = windows.setPanelLayout('dual')!
    expect(cardWidth).toBe(400 - 16 - WORKSPACE_GUTTER)
    const bounds = windows.panel.getBounds()
    expect(bounds.x).toBeGreaterThanOrEqual(-1280)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(-880)
    state.secondary = { x: -1280, y: 0, width: 1280, height: 720 }
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
