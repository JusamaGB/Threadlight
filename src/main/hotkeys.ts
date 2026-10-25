// System-wide shortcuts. Talk is a toggle (press to start, press again to stop), so key-down
// is all that is needed and Electron's built-in globalShortcut is enough.

import { globalShortcut } from 'electron'

export const DEFAULT_TALK_HOTKEY = 'Control+Alt+Q'

/**
 * Registers the talk hotkey. Returns a problem to show the user, or null on success.
 * Registration fails when another app already owns the combination.
 */
export function registerTalkHotkey(accelerator: string, onPress: () => void): string | null {
  try {
    if (globalShortcut.register(accelerator, onPress)) return null
    return `${humanise(accelerator)} is already used by another app, so the talk hotkey is off.`
  } catch {
    return `${humanise(accelerator)} is not a valid shortcut.`
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll()
}

function humanise(accelerator: string): string {
  return accelerator.replace('Control', 'Ctrl')
}
