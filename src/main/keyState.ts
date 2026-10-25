// Asks Windows whether one key is held down right now (user32 GetAsyncKeyState, through koffi).
// Press-and-hold only checks the talk hotkey's own key, only while it is held: no keyboard hook,
// so Threadlight never sees anything else you type.

type KeyReader = (virtualKey: number) => number

let reader: KeyReader | null | undefined

function load(): KeyReader | null {
  if (reader !== undefined) return reader
  try {
    // Loaded on first use, so a PC where it cannot load still runs everything else.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    reader = user32.func('short __stdcall GetAsyncKeyState(int vKey)') as KeyReader
  } catch (error) {
    console.error('Key state is unavailable; press-and-hold falls back to toggle.', error)
    reader = null
  }
  return reader
}

/** True while the key is down, false once released, or null if this PC cannot tell. */
export function isKeyDown(virtualKey: number): boolean | null {
  const read = load()
  return read ? (read(virtualKey) & 0x8000) !== 0 : null
}
