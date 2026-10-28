// Asks Windows whether one key is held down right now (user32 GetAsyncKeyState, through koffi),
// and which window is in front (for letting a held question card go, see questionHolds.ts).
// Talk hold checks its own key while held; the modifier stepper checks Control and Alt.
// Neither installs a keyboard hook or reads typed characters.

interface User32 {
  keyState: (virtualKey: number) => number
  foregroundWindow: () => unknown
  windowText: (window: unknown, text: Buffer, length: number) => number
}

let user32: User32 | null | undefined

function load(): User32 | null {
  if (user32 !== undefined) return user32
  try {
    // Loaded on first use, so a PC where it cannot load still runs everything else.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const lib = koffi.load('user32.dll')
    user32 = {
      keyState: lib.func('short __stdcall GetAsyncKeyState(int vKey)'),
      foregroundWindow: lib.func('void * __stdcall GetForegroundWindow()'),
      windowText: lib.func('int __stdcall GetWindowTextW(void *hWnd, void *text, int n)'),
    } as User32
  } catch (error) {
    console.error('user32 is unavailable; press-and-hold falls back to toggle.', error)
    user32 = null
  }
  return user32
}

/** True while the key is down, false once released, or null if this PC cannot tell. */
export function isKeyDown(virtualKey: number): boolean | null {
  const lib = load()
  return lib ? (lib.keyState(virtualKey) & 0x8000) !== 0 : null
}

/**
 * Which window is in front, as a number that changes whenever another window comes forward;
 * null if this PC cannot tell.
 */
export function foregroundWindowId(): bigint | null {
  const lib = load()
  if (!lib) return null
  const window = lib.foregroundWindow()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return window ? (require('koffi') as typeof import('koffi')).address(window) : 0n
}

/** The title of the window in front, or null if this PC cannot tell. */
export function foregroundTitle(): string | null {
  const lib = load()
  if (!lib) return null
  const window = lib.foregroundWindow()
  if (!window) return ''
  const text = Buffer.alloc(512)
  const length = lib.windowText(window, text, 256)
  return text.toString('utf16le', 0, Math.max(0, length) * 2)
}
