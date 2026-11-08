import type { BrowserWindow } from 'electron'
import type { LiveMuteKey } from '../shared/accelerator'

const WM_HOTKEY = 0x0312
const MOD_NOREPEAT = 0x4000
const virtualKeys = {
  Pause: { modifiers: 0, vk: 0x13 },
  'Control+Alt+M': { modifiers: 0x0002 | 0x0001, vk: 0x4d },
} satisfies Record<LiveMuteKey, { modifiers: number; vk: number }>

interface WinHotkeys {
  register(hwnd: bigint | number, id: number, modifiers: number, vk: number): number
  unregister(hwnd: bigint | number, id: number): number
}

function loadUser32(): WinHotkeys {
  // Load only for a live call. Keep an unavailable native dependency local to the shortcut.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const user32 = (require('koffi') as typeof import('koffi')).load('user32.dll')
  return {
    register: user32.func(
      'int __stdcall RegisterHotKey(uintptr_t, int, unsigned int, unsigned int)',
    ),
    unregister: user32.func('int __stdcall UnregisterHotKey(uintptr_t, int)'),
  }
}

export type RegisterMuteKey = (key: LiveMuteKey, toggle: () => void) => (() => void) | null

/** Window-owned WM_HOTKEY works even while hidden. Windows suppresses repeats before delivery. */
export function windowsMuteKeys(panel: BrowserWindow, load = loadUser32): RegisterMuteKey {
  const owned = new Map<number, () => void>()
  let nextId = 0x5400
  let api: WinHotkeys | undefined
  return (key, toggle) => {
    if (panel.isDestroyed()) return null
    api ??= load()
    const bytes = panel.getNativeWindowHandle()
    const hwnd = bytes.length === 8 ? bytes.readBigUInt64LE() : bytes.readUInt32LE()
    while (owned.has(nextId)) nextId = nextId < 0xbfff ? nextId + 1 : 0x5400
    const id = nextId
    nextId = nextId < 0xbfff ? nextId + 1 : 0x5400
    const { modifiers, vk } = virtualKeys[key]
    if (!api.register(hwnd, id, modifiers | MOD_NOREPEAT, vk)) return null
    try {
      if (!owned.size)
        panel.hookWindowMessage(WM_HOTKEY, (param) => owned.get(param.readUInt32LE())?.())
      owned.set(id, toggle)
    } catch (error) {
      api.unregister(hwnd, id)
      throw error
    }
    return () => {
      if (!owned.delete(id) || panel.isDestroyed()) return
      api!.unregister(hwnd, id)
      if (!owned.size) panel.unhookWindowMessage(WM_HOTKEY)
    }
  }
}
