import { createHash } from 'node:crypto'
import type { AgentResult } from '../shared/agent'
import type { ScreenImage } from './liveScreen'

export type RegionResult = AgentResult & { uncertain?: boolean; notice?: string }
type Receipt = { status: 'pending' | 'sent' | 'uncertain'; until: number }
/** Retain only hashes while pending and for five seconds after a receipt. */
export class RegionReceipts {
  private entries = new Map<string, Receipt>()
  claim(image: ScreenImage): { key: string; skip?: RegionResult } {
    const key = createHash('sha256').update(image.jpeg, 'base64').digest('hex')
    const now = Date.now()
    for (const [k, r] of this.entries) if (r.until <= now) this.entries.delete(k)
    const r = this.entries.get(key)
    if (r?.status === 'uncertain')
      return {
        key,
        skip: {
          ok: false,
          uncertain: true,
          reason: 'Delivery of this region is unconfirmed. Check the conversation before retrying.',
        },
      }
    if (r)
      return {
        key,
        skip: {
          ok: true,
          notice:
            r.status === 'pending'
              ? 'This region is already queued or sending.'
              : 'This region was already sent.',
        },
      }
    if (this.entries.size >= 64)
      return {
        key,
        skip: { ok: false, reason: 'Too many recent captures. Try again in a few seconds.' },
      }
    this.entries.set(key, { status: 'pending', until: Infinity })
    return { key }
  }
  finish(key: string, result: RegionResult) {
    if (!result.ok && !result.uncertain) this.entries.delete(key)
    else
      this.entries.set(key, { status: result.ok ? 'sent' : 'uncertain', until: Date.now() + 5000 })
  }
  discard(key: string) {
    this.entries.delete(key)
  }
}
