// The system-wide talk hotkey. Talk is a toggle (press to start, press again to stop), so key-down
// is all that is needed and Electron's built-in globalShortcut is enough.

import { globalShortcut } from 'electron'

import { acceleratorLabel } from '../shared/accelerator'

export class TalkHotkey {
  private current: string | null = null
  private paused = false

  constructor(private readonly onPress: () => void) {}

  get accelerator(): string | null {
    return this.current
  }

  get isPaused(): boolean {
    return this.paused
  }

  /**
   * Switches to `accelerator`. Returns a problem to show the user, or null on success. On failure
   * the previous hotkey stays registered, so a bad choice never leaves you without one.
   */
  set(accelerator: string): string | null {
    if (accelerator === this.current) return null
    if (this.paused) {
      this.current = accelerator // takes effect when resumed
      return null
    }
    const label = acceleratorLabel(accelerator)
    let registered: boolean
    try {
      registered = globalShortcut.register(accelerator, this.onPress)
    } catch {
      return `${label} is not a valid shortcut.`
    }
    if (!registered) return `${label} is already used by another app. Pick another.`
    if (this.current) globalShortcut.unregister(this.current)
    this.current = accelerator
    return null
  }

  /** Turns the hotkey off without forgetting it (tray → Pause). */
  setPaused(paused: boolean): string | null {
    if (paused === this.paused) return null
    this.paused = paused
    if (!this.current) return null
    if (paused) {
      globalShortcut.unregister(this.current)
      return null
    }
    const wanted = this.current
    this.current = null
    return this.set(wanted)
  }

  dispose(): void {
    globalShortcut.unregisterAll()
  }
}
