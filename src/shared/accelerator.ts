// Converting a key press into an Electron accelerator ("Control+Alt+Q") and back into a label.

export interface KeyPress {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
}

/** The non-modifier key, by its physical position (so Shift+1 is "1", not "!"). */
function mainKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return NAMED[code] ?? null
}

/**
 * The accelerator for a key press, or null while only modifiers are held. A global hotkey needs
 * Ctrl, Alt or Win (Shift alone is not enough), except for the function keys F1–F24.
 */
export type HotkeyProblem = 'needs-modifier' | 'unsupported'

export function acceleratorFrom(
  press: KeyPress,
): { accelerator: string } | { problem: HotkeyProblem } | null {
  const key = mainKey(press.code)
  if (!key)
    return ['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(press.key)
      ? null
      : { problem: 'unsupported' }
  const strong = press.ctrlKey || press.altKey || press.metaKey
  if (!strong && !/^F\d+$/.test(key)) return { problem: 'needs-modifier' }
  const parts = [
    press.ctrlKey && 'Control',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    press.metaKey && 'Super',
    key,
  ].filter(Boolean)
  return { accelerator: parts.join('+') }
}

const VIRTUAL_KEYS: Record<string, number> = {
  Space: 0x20,
  Enter: 0x0d,
  Tab: 0x09,
  Backspace: 0x08,
  Delete: 0x2e,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  Left: 0x25,
  Up: 0x26,
  Right: 0x27,
  Down: 0x28,
  '`': 0xc0,
  '-': 0xbd,
  '=': 0xbb,
  '[': 0xdb,
  ']': 0xdd,
  '\\': 0xdc,
  ';': 0xba,
  "'": 0xde,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
}

/**
 * The Windows virtual-key code of an accelerator's main key (the Q in "Control+Alt+Q"), so
 * press-and-hold can tell when it is let go. Null for a key it does not know.
 */
export function mainVirtualKey(accelerator: string): number | null {
  const key = accelerator.split('+').pop() ?? ''
  if (/^[A-Z]$/.test(key) || /^[0-9]$/.test(key)) return key.charCodeAt(0)
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key)
  if (fn) return 0x70 + Number(fn[1]) - 1
  return VIRTUAL_KEYS[key] ?? null
}

/** "Control+Alt+Q" → "Ctrl+Alt+Q" for display. */
export function acceleratorLabel(accelerator: string): string {
  return accelerator.replace('Control', 'Ctrl').replace('Super', 'Win')
}
