// The system-wide talk hotkey. Electron's globalShortcut only reports the key going down, which is
// all toggle needs. Press-and-hold also needs the release: once the hotkey fires, the held key is
// checked every few milliseconds until it is let go (see keyState.ts).

import { globalShortcut } from 'electron'

import { acceleratorLabel, mainVirtualKey } from '../shared/accelerator'
import type { Settings } from '../shared/settings'
import { isKeyDown } from './keyState'

const RELEASE_CHECK_MS = 25

export type TalkMode = Settings['talkMode']

export interface TalkHotkeyEvents {
  /** Toggle mode: the hotkey was pressed (start, or stop and send). */
  toggle: () => void
  /** Hold mode: the hotkey went down, and later came back up. */
  hold: (phase: 'down' | 'up') => void
}

export class TalkHotkey {
  private current: string | null = null
  private paused = false
  private mode: TalkMode = 'toggle'
  private releaseWatch: NodeJS.Timeout | null = null

  constructor(private readonly events: TalkHotkeyEvents) {}

  get accelerator(): string | null {
    return this.current
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** Switches between toggle and press-and-hold. Returns a problem if hold cannot work here. */
  setMode(mode: TalkMode): string | null {
    this.stopWatching(true)
    if (mode === 'hold' && isKeyDown(0x10) === null) {
      this.mode = 'toggle'
      return 'Press and hold is not available on this PC, so the talk hotkey toggles instead.'
    }
    this.mode = mode
    return null
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
      registered = globalShortcut.register(accelerator, () => this.pressed())
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
      this.stopWatching(true)
      globalShortcut.unregister(this.current)
      return null
    }
    const wanted = this.current
    this.current = null
    return this.set(wanted)
  }

  dispose(): void {
    this.stopWatching(false)
    globalShortcut.unregisterAll()
  }

  private pressed(): void {
    if (this.mode === 'toggle') return this.events.toggle()
    // Windows repeats a held hotkey; while already holding, those repeats are ignored.
    if (this.releaseWatch) return
    const key = this.current ? mainVirtualKey(this.current) : null
    if (key === null) return this.events.toggle() // a key we cannot watch: behave as toggle
    this.events.hold('down')
    this.releaseWatch = setInterval(() => {
      if (isKeyDown(key) === false) this.stopWatching(true)
    }, RELEASE_CHECK_MS)
  }

  /** Ends a hold in progress; `report` sends the release so the recording is sent. */
  private stopWatching(report: boolean): void {
    if (!this.releaseWatch) return
    clearInterval(this.releaseWatch)
    this.releaseWatch = null
    if (report) this.events.hold('up')
  }
}
