import type { BrowserWindow } from 'electron'
import { windowsMuteKeys } from '../src/main/windowsMuteKeys'
import { afterEach, expect, it, vi } from 'vitest'
const shortcuts = vi.hoisted(() => new Map<string, () => void>())
vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn((key: string, callback: () => void) => {
      if (shortcuts.has(key)) return false
      shortcuts.set(key, callback)
      return true
    }),
    unregister: vi.fn((key: string) => shortcuts.delete(key)),
  },
}))
vi.mock('../src/main/keyState', () => ({ isKeyDown: () => false }))
import { BRAINSTORM_HOTKEY, TalkHotkey, LiveMuteShortcut } from '../src/main/hotkeys'
afterEach(() => {
  shortcuts.clear()
  vi.clearAllMocks()
})
it('registers Brainstorm as an independent toggle and releases only its own shortcut', () => {
  const talk = vi.fn(),
    brainstorm = vi.fn()
  const regular = new TalkHotkey({ toggle: talk, hold: vi.fn() })
  const project = new TalkHotkey({ toggle: brainstorm, hold: vi.fn() })
  expect(regular.set('Control+Alt+Q')).toBeNull()
  expect(project.set(BRAINSTORM_HOTKEY)).toBeNull()
  shortcuts.get('Control+Alt+B')!()
  expect(brainstorm).toHaveBeenCalledOnce()
  expect(talk).not.toHaveBeenCalled()
  expect(project.setPaused(true)).toBeNull()
  expect(shortcuts.has(BRAINSTORM_HOTKEY)).toBe(false)
  expect(shortcuts.has('Control+Alt+Q')).toBe(true)
  expect(project.setPaused(false)).toBeNull()
  regular.dispose()
  expect(shortcuts.has(BRAINSTORM_HOTKEY)).toBe(true)
  project.dispose()
  expect(shortcuts.size).toBe(0)
})
it('routes owned Win32 messages and requests repeat suppression for both mute keys', () => {
  const register = vi.fn(() => 1),
    unregister = vi.fn(() => 1)
  const panel = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    hookWindowMessage: vi.fn(),
    unhookWindowMessage: vi.fn(),
  }
  const clicked = vi.fn()
  const mute = new LiveMuteShortcut(
    clicked,
    windowsMuteKeys(panel as unknown as BrowserWindow, () => ({ register, unregister })),
  )
  expect(mute.update(false, false, 'F8')).toBeNull()
  expect(register).not.toHaveBeenCalled()
  expect(mute.update(true, false, 'F8')).toBeNull()
  const first = 0x5400
  expect(register.mock.calls).toEqual([
    [1n, first, 0x4000, 0x13],
    [1n, first + 1, 0x4003, 0x4d],
  ])
  const [message, deliver] = panel.hookWindowMessage.mock.calls[0]!
  expect(message).toBe(0x312)
  const press = (id: number) => {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(id)
    deliver(b)
  }
  press(first)
  press(first + 1)
  press(7)
  expect(clicked).toHaveBeenCalledTimes(2)
  mute.update(true, false, 'F8')
  expect(register).toHaveBeenCalledTimes(2)
  expect(mute.update(true, false, 'Alt+Ctrl+M')).toContain('assigned to Talk')
  press(first + 1)
  press(first)
  expect(clicked).toHaveBeenCalledTimes(3)
  mute.update(true, true, 'F8')
  press(first)
  expect(clicked).toHaveBeenCalledTimes(3)
  expect(panel.unhookWindowMessage).toHaveBeenCalledWith(message)
  mute.update(true, false, 'F8')
  press(first)
  press(first + 2)
  expect(clicked).toHaveBeenCalledTimes(4)
  mute.update(false, false, 'F8')
  press(first + 2)
  expect(clicked).toHaveBeenCalledTimes(4)
  expect(unregister).toHaveBeenCalledTimes(4)
  mute.dispose()
})

it('reports each unavailable key while preserving the other shortcut', () => {
  for (const unavailable of ['Pause', 'Control+Alt+M']) {
    const callbacks = new Map<string, () => void>(),
      clicked = vi.fn()
    const mute = new LiveMuteShortcut(clicked, (key, fn) => {
      if (key === unavailable) return null
      callbacks.set(key, fn)
      return () => {
        callbacks.delete(key)
      }
    })
    expect(mute.update(true, false, 'F8')).toContain('unavailable')
    expect(callbacks.size).toBe(1)
    for (const fn of callbacks.values()) fn()
    expect(clicked).toHaveBeenCalledOnce()
    mute.dispose()
    expect(callbacks.size).toBe(0)
  }
})
it('reports when another app owns the Brainstorm shortcut', () => {
  shortcuts.set(BRAINSTORM_HOTKEY, () => {})
  const project = new TalkHotkey({ toggle: vi.fn(), hold: vi.fn() })
  expect(project.set(BRAINSTORM_HOTKEY)).toContain('already used')
  expect(project.accelerator).toBeNull()
})
