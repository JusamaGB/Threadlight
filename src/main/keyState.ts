// Asks Windows whether one key is held down right now (user32 GetAsyncKeyState, through koffi),
// and which window is in front (for letting a held question card go, see questionHolds.ts).
// Talk hold checks its own key while held; the modifier stepper checks Control and Alt.
// Neither installs a keyboard hook or reads typed characters.

interface User32 {
  cursorInfo: (info: Buffer) => number
  loadCursor: (instance: null, id: number) => unknown
  keyState: (virtualKey: number) => number
  foregroundWindow: () => unknown
  windowText: (window: unknown, text: Buffer, length: number) => number
  windowProcess: (window: unknown, pid: Buffer) => number
  openProcess: (access: number, inherit: number, pid: number) => unknown
  imageName: (handle: unknown, flags: number, path: Buffer, length: Buffer) => number
  closeHandle: (handle: unknown) => number
}

let user32: User32 | null | undefined

function load(): User32 | null {
  if (user32 !== undefined) return user32
  try {
    // Loaded on first use, so a PC where it cannot load still runs everything else.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const lib = koffi.load('user32.dll')
    const kernel = koffi.load('kernel32.dll')
    user32 = {
      cursorInfo: lib.func('int __stdcall GetCursorInfo(void *info)'),
      loadCursor: lib.func('void * __stdcall LoadCursorW(void *instance, uintptr_t id)'),
      keyState: lib.func('short __stdcall GetAsyncKeyState(int vKey)'),
      foregroundWindow: lib.func('void * __stdcall GetForegroundWindow()'),
      windowText: lib.func('int __stdcall GetWindowTextW(void *hWnd, void *text, int n)'),
      windowProcess: lib.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, void *pid)'),
      openProcess: kernel.func(
        'void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)',
      ),
      imageName: kernel.func(
        'int __stdcall QueryFullProcessImageNameW(void *handle, uint32 flags, void *path, void *length)',
      ),
      closeHandle: kernel.func('int __stdcall CloseHandle(void *handle)'),
    } as User32
  } catch (error) {
    console.error('user32 is unavailable; press-and-hold falls back to toggle.', error)
    user32 = null
  }
  return user32
}

export interface ForegroundApp {
  handle: string
  pid: number
  title: string
  executable: string
}

/** Read the title and process from the same HWND; never infer identity from the title alone. */
export function foregroundApp(): ForegroundApp | null {
  const lib = load()
  const win = lib?.foregroundWindow()
  if (!lib || !win) return null
  const pidBytes = Buffer.alloc(4)
  if (!lib.windowProcess(win, pidBytes)) return null
  const pid = pidBytes.readUInt32LE()
  const title = Buffer.alloc(2048)
  const length = lib.windowText(win, title, 1024)
  const processHandle = lib.openProcess(0x1000, 0, pid)
  let executable = ''
  if (processHandle) {
    try {
      const path = Buffer.alloc(65536),
        size = Buffer.alloc(4)
      size.writeUInt32LE(path.length / 2)
      if (lib.imageName(processHandle, 0, path, size))
        executable =
          path
            .toString('utf16le', 0, size.readUInt32LE() * 2)
            .split('\\')
            .at(-1) ?? ''
    } finally {
      lib.closeHandle(processHandle)
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const handle = (require('koffi') as typeof import('koffi')).address(win).toString()
  return { handle, pid, title: title.toString('utf16le', 0, length * 2), executable }
}

/** True while the key is down, false once released, or null if this PC cannot tell. */
export function isKeyDown(virtualKey: number): boolean | null {
  const lib = load()
  return lib ? (lib.keyState(virtualKey) & 0x8000) !== 0 : null
}

// VS Code uses the standard arrow over line numbers. Ordinary text selections
// (including triple-click line selections) normally use the editing cursor.
export function walkthroughPointer() {
  const lib = load()
  if (!lib) return null
  const pointerBytes = process.arch === 'ia32' ? 4 : 8
  const info = Buffer.alloc(16 + pointerBytes)
  info.writeUInt32LE(info.length)
  if (!lib.cursorInfo(info) || !(info.readUInt32LE(4) & 1)) return null
  const handle = pointerBytes === 8 ? info.readBigUInt64LE(8) : BigInt(info.readUInt32LE(8))
  const arrow = lib.loadCursor(null, 32512) // IDC_ARROW
  if (!arrow) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const address = (require('koffi') as typeof import('koffi')).address(arrow)
  return {
    arrow: handle === address,
    x: info.readInt32LE(8 + pointerBytes),
    y: info.readInt32LE(12 + pointerBytes),
  }
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
