import { describe, expect, it, vi } from 'vitest'
import { micIndicatorBounds } from '../src/shared/micIndicator'
import { IPC } from '../src/shared/ipc'

const { events, handles } = vi.hoisted(() => ({
  events: new Map<string, (...args: unknown[]) => void>(),
  handles: new Map<string, () => unknown>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    on: (key: string, fn: (...args: unknown[]) => void) => events.set(key, fn),
    handle: (key: string, fn: () => unknown) => handles.set(key, fn),
  },
}))
import { registerMicIndicator } from '../src/main/micIndicator'
import type { WindowManager } from '../src/main/windows'

describe('floating microphone indicator', () => {
  it.each([
    { x: 8, y: 8 },
    { x: 1890, y: 8 },
    { x: 8, y: 1050 },
    { x: 1890, y: 1050 },
    { x: -1912, y: 8 },
  ])('grows inward and restores its anchor at %j', (anchor) => {
    const area = { x: anchor.x < 0 ? -1920 : 0, y: 0, width: 1920, height: 1080 }
    const pill = micIndicatorBounds(anchor, area, true)
    expect(pill.width).toBe(92)
    expect(pill.height).toBe(32)
    expect(pill.x).toBeGreaterThanOrEqual(area.x)
    expect(pill.x + pill.width).toBeLessThanOrEqual(area.x + area.width)
    expect(pill.y + pill.height).toBeLessThanOrEqual(area.height)
    expect(micIndicatorBounds(anchor, area, false)).toEqual({ ...anchor, width: 22, height: 22 })
  })

  it('relays bounded levels, closes only an open mic and clears stale state on reload', () => {
    const reload = new Map<string, () => void>()
    const panel = { send: vi.fn(), on: (name: string, fn: () => void) => reload.set(name, fn) }
    const dot = { send: vi.fn() }
    const windows = {
      panel: { webContents: panel },
      dot: { webContents: dot },
      setOpenMicLive: vi.fn(),
    }
    registerMicIndicator(windows as unknown as WindowManager)
    const emit = (name: string, sender: unknown, value?: unknown) =>
      events.get(name)!({ sender }, value)
    emit(IPC.openMicLive, dot, true)
    expect(handles.get(IPC.openMicIndicator)!()).toEqual({ live: false, level: 0 })
    emit(IPC.openMicLive, panel, true)
    expect(windows.setOpenMicLive).toHaveBeenLastCalledWith(true)
    emit(IPC.openMicLevel, panel, 3)
    expect(dot.send).toHaveBeenLastCalledWith(IPC.openMicLevel, 1)
    emit(IPC.openMicLevel, panel, NaN)
    expect(handles.get(IPC.openMicIndicator)!()).toEqual({ live: true, level: 1 })
    emit(IPC.stopOpenMic, dot)
    expect(panel.send).toHaveBeenCalledExactlyOnceWith(IPC.stopOpenMic)
    emit(IPC.openMicLive, panel, false)
    emit(IPC.stopOpenMic, dot)
    expect(panel.send).toHaveBeenCalledTimes(1)
    emit(IPC.openMicLive, panel, true)
    reload.get('did-start-loading')!()
    expect(handles.get(IPC.openMicIndicator)!()).toEqual({ live: false, level: 0 })
    expect(windows.setOpenMicLive).toHaveBeenLastCalledWith(false)
  })
})
