import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/shared/ipc'
import type { Session } from '../src/shared/types'

const state = vi.hoisted(() => ({
  saved: { x: 1200, y: 200 },
  cursor: { x: 1205, y: 205 },
  primary: { x: 0, y: 0, width: 1920, height: 1040 },
  secondary: { x: -1280, y: 0, width: 1280, height: 720 },
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
import { WindowManager } from '../src/main/windows'

describe('panel movement and available height', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.saved = { x: 1200, y: 200 }
    state.cursor = { x: 1205, y: 205 }
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the external wire gutter click-through while the card remains interactive', () => {
    const windows = new WindowManager()
    windows.openPanel()
    const bounds = windows.panel.getBounds()
    expect(bounds.width).toBe(316)
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

  it('shows provider-coloured attention only while minimised, with capture taking priority', () => {
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
    expect(windows.attentionMotion).toMatchObject({ active: true, provider: 'codex', floor: 840 })
    windows.openPanel()
    expect(windows.attentionMotion.active).toBe(false)
    windows.closePanel()
    expect(windows.attentionMotion.active).toBe(true)
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

  it('keeps one waiting provider stable, then switches when that thread is answered', () => {
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
    windows.setAttention([claude, codex])
    expect(windows.attentionMotion.provider).toBe('claude')
    windows.setAttention([{ ...claude, state: 'idle' }, codex])
    expect(windows.attentionMotion.provider).toBe('codex')
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
      maxHeight: 614,
      opensDown: false,
      fresh: false,
    })
    expect(windows.panel.getBounds()).toMatchObject({ x: -594, y: 8, height: 614 })
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
      maxHeight: 1014,
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
