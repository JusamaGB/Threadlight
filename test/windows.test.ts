import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/shared/ipc'

const state = vi.hoisted(() => ({
  saved: { x: 1200, y: 200 },
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
      loadFile = vi.fn()
      focus = vi.fn()
      hide() {
        this.visible = false
      }
      show() {
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
    state.saved = { x: 1200, y: 200 }
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
    expect(windows.panel.getBounds()).toMatchObject({ x: -620, y: 8, height: 614 })
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
