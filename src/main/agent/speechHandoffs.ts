import type { AgentItem } from '../../shared/agent'
import { matchesSpeech } from '../../shared/speechCaption'

type Origin = NonNullable<AgentItem['narrationOf']>
interface Handoff {
  origin: Origin
  text: string
  claimed?: string
  turns: Set<string>
  started: number
}

/** Native speech submissions have no provider-assigned playback ID. Keep the set of
 * submissions actually outstanding when each segment started, then require word evidence. */
export class SpeechHandoffs {
  private submissions = new Map<string, Handoff>()
  private eligible = new Map<string, string[]>()
  private confirmed = new Map<string, Handoff>()
  add(text: string, origin: Origin) {
    this.submissions.set(origin.requestId!, {
      text,
      origin,
      turns: new Set(),
      started: performance.now(),
    })
  }
  observe(id: string) {
    if (!this.eligible.has(id))
      this.eligible.set(
        id,
        [...this.submissions]
          .filter(([, h]) => !h.claimed && performance.now() - h.started <= 30000)
          .map(([key]) => key),
      )
  }
  boundary(turn: string) {
    for (const h of this.submissions.values()) h.turns.add(turn)
  }
  match(id: string, text: string, complete: boolean, nativeTurn?: string): Origin | undefined {
    const previous = this.confirmed.get(id)
    const pool = previous
      ? [previous]
      : (this.eligible.get(id) ?? []).flatMap((key) => this.submissions.get(key) ?? [])
    const hits = pool.filter(
      (h) =>
        (!h.claimed || h.claimed === id) &&
        (!nativeTurn || h.turns.has(nativeTurn)) &&
        matchesSpeech(h.text, text, !complete),
    )
    if (hits.length !== 1) {
      if (complete && previous) {
        previous.claimed = undefined
        this.confirmed.delete(id)
      }
      return
    }
    const h = hits[0]!
    if (complete) {
      h.claimed = id
      this.confirmed.set(id, h)
      this.eligible.delete(id)
    }
    return nativeTurn ? { ...h.origin, playbackTurnId: nativeTurn } : h.origin
  }
  fail(id: string) {
    this.submissions.delete(id)
    for (const [key, h] of this.confirmed) if (h.origin.requestId === id) this.confirmed.delete(key)
  }
  retire() {
    this.submissions.clear()
    this.eligible.clear()
  }
}
