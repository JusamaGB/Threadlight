import { isKeyDown } from './keyState'

export type ModifierStage = 'normal' | 'hidden' | 'peek'

/** Observe modifier holds without registering or swallowing another application's shortcuts. */
export class ModifierStepper {
  private timer: NodeJS.Timeout | null = null
  private stage: ModifierStage = 'normal'
  private paused = false
  private talkOwnsChord = false
  constructor(
    private change: (stage: ModifierStage) => void,
    private read = isKeyDown,
  ) {}
  start(): void {
    if (this.timer) return
    this.poll()
    this.timer = setInterval(() => this.poll(), 25)
    this.timer.unref?.()
  }
  setPaused(paused: boolean): void {
    this.paused = paused
    this.poll()
  }
  /** The talk shortcut can share this prefix (the default is Ctrl+Alt+Q). */
  yieldToTalk(): void {
    this.talkOwnsChord = true
    this.poll()
  }
  private poll(): void {
    const control = this.read(0x11)
    const alt = this.read(0x12)
    if (control !== true) this.talkOwnsChord = false
    const next =
      this.paused || this.talkOwnsChord || control !== true
        ? 'normal'
        : alt === true
          ? 'peek'
          : 'hidden'
    if (next === this.stage) return
    this.stage = next
    this.change(next)
  }
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.stage !== 'normal') this.change('normal')
    this.stage = 'normal'
  }
}
