// Tracks each relayed message through sending → sent (✓) → replied (✓✓) or failed,
// and allows one message in flight per session.

import type { RelayStatus } from '../shared/types'
import { relayMessage, type RelayDeps, type RelayTarget } from './relay'

export type SendResult = { ok: true } | { ok: false; reason: string }

export class RelayService {
  private statuses = new Map<string, RelayStatus>()

  constructor(
    private readonly deps: () => Promise<RelayDeps>,
    /** Looks the session up in Threadlight's own scan: the UI only ever supplies an id. */
    private readonly lookup: (sessionId: string) => RelayTarget | undefined,
    private readonly onChange: (statuses: RelayStatus[]) => void,
  ) {}

  list(): RelayStatus[] {
    return [...this.statuses.values()]
  }

  /** Starts a send and returns at once; progress arrives through onChange. */
  send(sessionId: string, text: string): SendResult {
    const target = this.lookup(sessionId)
    if (!target) return { ok: false, reason: 'That session is no longer listed.' }
    const current = this.statuses.get(sessionId)?.state
    if (current === 'sending' || current === 'sent') {
      return { ok: false, reason: 'Still waiting for the last reply.' }
    }
    this.update(sessionId, 'sending', '')
    void this.run(target, text)
    return { ok: true }
  }

  private async run(target: RelayTarget, text: string): Promise<void> {
    try {
      const result = await relayMessage(target, text, await this.deps(), () =>
        this.update(target.id, 'sent', ''),
      )
      if (result.ok) this.update(target.id, 'replied', result.reply)
      else this.update(target.id, 'failed', result.reason)
    } catch (error) {
      this.update(target.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private update(sessionId: string, state: RelayStatus['state'], detail: string): void {
    this.statuses.set(sessionId, { sessionId, state, detail, at: Date.now() })
    this.onChange(this.list())
  }
}
