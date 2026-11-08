import { isObject } from '../sessions/json'
import { answeredQuestionIds } from './questionLifecycle'
import { followCodexState } from './threadStream'
import { streamTurns } from './threadStreamState'

/** Observe only turns with pending projected cards. A disconnect is never evidence of an answer. */
export class QuestionObserver {
  private watches = new Map<
    string,
    { turn: string; answered: Set<string>; ended: boolean; stop: () => void }
  >()
  private closed = false
  constructor(
    private changed: () => void,
    private follow = followCodexState,
  ) {}

  state(id: string, turn: string) {
    const watch = this.watches.get(id)
    return watch?.turn === turn ? watch : undefined
  }

  confirm(id: string, turn: string, ids: Iterable<string>) {
    const watch = this.state(id, turn)
    if (!watch) return
    const previous = watch.answered.size
    for (const key of ids) watch.answered.add(key)
    if (watch.answered.size !== previous) this.changed()
  }

  sync(active: Map<string, string>) {
    if (this.closed) return
    for (const [id, watch] of this.watches) {
      if (active.get(id) === watch.turn) continue
      this.watches.delete(id)
      watch.stop()
    }
    for (const [id, turn] of active) {
      if (this.watches.has(id)) continue
      const watch = { turn, answered: new Set<string>(), ended: false, stop: () => {} }
      this.watches.set(id, watch)
      watch.stop = this.follow(
        id,
        (state) => {
          if (this.watches.get(id) !== watch) return
          const current = streamTurns(state).find((t) => t.turnId === turn)
          if (!current) return
          const ended = ['completed', 'failed', 'interrupted'].includes(String(current.status))
          if (ended && !watch.ended) {
            watch.ended = true
            this.changed()
            return
          }
          if (!Array.isArray(current.items)) return
          this.confirm(id, turn, answeredQuestionIds(current.items.filter(isObject)))
        },
        () => {},
      )
    }
  }

  close() {
    this.sync(new Map())
    this.closed = true
  }
}
