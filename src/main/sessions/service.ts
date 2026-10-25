// Polls the tracker and reports the session list only when it actually changes.

import type { Session } from '../../shared/types'
import type { Tracker } from './tracker'

export class SessionService {
  private latest: Session[] = []
  private latestJson = '[]'
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly tracker: Tracker,
    private readonly onChange: (sessions: Session[]) => void,
  ) {}

  get sessions(): Session[] {
    return this.latest
  }

  start(intervalMs: number): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async refresh(): Promise<void> {
    if (this.running) return // a slow scan must not pile up behind itself
    this.running = true
    try {
      const sessions = await this.tracker.snapshot()
      const json = JSON.stringify(sessions)
      if (json !== this.latestJson) {
        this.latest = sessions
        this.latestJson = json
        this.onChange(sessions)
      }
    } catch (error) {
      console.error('Session scan failed', error)
    } finally {
      this.running = false
    }
  }
}
