import type { Provider } from './types'

/**
 * Seconds for one lap of the needs-input drips: with N drips waiting, one leaves every
 * ATTENTION_CYCLE / N seconds, so more waiting threads means a faster drip, towards a flow.
 */
export const ATTENTION_CYCLE = 6
export const MAX_ATTENTION_DRIPS = 10

export interface Drip {
  /** When this drip began forming, in seconds. */
  start: number
  /** The provider of the thread this drip stands for; it colours only the liquid. */
  provider: Provider
  /** How much faster than normal this drip forms (1 is the unhurried 1.5 s formation). */
  scale: number
}

const clampCount = (count: number) => Math.max(1, Math.min(MAX_ATTENTION_DRIPS, count))
export const dripSpacing = (count: number) => ATTENTION_CYCLE / clampCount(count)

/**
 * Forming runs faster as drips get closer, so each drop has released before the next begins.
 * A lone drip forms at the normal pace; the fall itself always obeys real gravity.
 */
export const formingScale = (count: number, forming: number) =>
  Math.max(0.2, Math.min(1, (0.92 * dripSpacing(count)) / forming))

/** A drip's clock in unhurried seconds: forming is stretched back out, the fall is real time. */
export function dripClock(age: number, scale: number, forming: number): number {
  const formingTime = forming * scale
  return age < formingTime ? age / scale : forming + (age - formingTime)
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * Keeps the drips in flight. A frame at any time can be rebuilt from scratch (so a given clock
 * always shows the same drips), but after that drips are only added as they fall due, so
 * answering a thread never makes the drops already falling jump or vanish.
 */
export class DripSchedule {
  private drips: Drip[] = []
  private nextAt = 0
  private cursor = 0
  private ready = false

  /**
   * @param forming seconds one drop takes to form at normal speed
   * @param life how long a drip stays on screen (forming, fall and splash) at a given scale
   */
  constructor(
    private readonly forming: number,
    private readonly life: (scale: number) => number,
  ) {}

  reset(): void {
    this.drips = []
    this.ready = false
  }

  update(now: number, providers: readonly Provider[]): readonly Drip[] {
    if (providers.length === 0) {
      this.reset()
      return this.drips
    }
    const list = providers.slice(0, MAX_ATTENTION_DRIPS)
    const spacing = dripSpacing(list.length)
    const scale = formingScale(list.length, this.forming)
    const stale =
      !this.ready || now < this.nextAt - ATTENTION_CYCLE - 1 || now - this.nextAt > 3 * spacing
    if (stale) {
      // Rebuild what the clock says should be on screen right now.
      const slot = Math.floor(now / spacing)
      const life = this.life(scale)
      const rebuilt: Drip[] = []
      for (let k = slot; k * spacing > now - life; k--)
        rebuilt.unshift({ start: k * spacing, provider: list[mod(k, list.length)]!, scale })
      this.drips = rebuilt
      this.cursor = slot + 1
      this.nextAt = (slot + 1) * spacing
      this.ready = true
    } else {
      // More threads waiting than before: the next drip is due sooner than the old pace said.
      const last = this.drips.at(-1)
      if (last) this.nextAt = Math.min(this.nextAt, last.start + spacing)
      while (this.nextAt <= now) {
        this.drips.push({
          start: this.nextAt,
          provider: list[mod(this.cursor, list.length)]!,
          scale,
        })
        this.cursor++
        this.nextAt += spacing
      }
    }
    this.drips = this.drips.filter((drip) => now - drip.start < this.life(drip.scale))
    return this.drips
  }
}
