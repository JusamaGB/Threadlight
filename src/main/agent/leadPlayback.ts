/** Wait for the submitted opening's words and a completed playback turn before
 * offering the rest. A competing direct utterance cannot open this gate. */
export class LeadPlayback {
  private current?: string
  private done = new Set<string>()
  private segmentTurns = new Map<string, string | undefined>()
  private partials = new Set<string>()
  private conflicts = new Map<string, string | undefined>()
  private matched = false
  private owner?: string
  private stopped = false
  private timedOut = false
  private notify?: () => void
  onUncertain?: () => void
  get awaitingMatchedTurn() {
    return this.matched && !this.owner && !this.timedOut
  }
  get uncertain() {
    return (
      !this.current &&
      this.done.size > 0 &&
      !this.finished &&
      !this.stopped &&
      (this.timedOut || !this.partials.size)
    )
  }
  observe(segment: string, native?: string) {
    this.segmentTurns.set(segment, native ?? this.current)
    this.partials.add(segment)
  }
  start(id: string) {
    this.current = id
    for (const [segment, turn] of this.segmentTurns) if (!turn) this.segmentTurns.set(segment, id)
    for (const [segment, turn] of this.conflicts) if (!turn) this.conflicts.set(segment, id)
    if (this.matched && !this.owner && !this.foreign(id)) this.owner = id
  }
  end(id: string) {
    if (id !== this.current) return
    this.done.add(id)
    this.current = undefined
    if (this.uncertain) this.onUncertain?.()
    this.notify?.()
  }
  caption(segment: string, matching: boolean, complete: boolean, native?: string) {
    if (complete) this.partials.delete(segment)
    else this.partials.add(segment)
    const turn = native ?? this.segmentTurns.get(segment) ?? this.current
    if (turn) this.segmentTurns.set(segment, turn)
    if (matching && complete) {
      // A streamed prefix can be revised. Only that segment can clear its own
      // conflict; a separate direct reply still owns its playback.
      this.conflicts.delete(segment)
      this.matched = true
      if (turn && !this.foreign(turn)) this.owner = turn
    } else if (!matching && (!this.conflicts.has(segment) || native)) {
      const competing = turn ?? [...this.done].at(-1)
      this.conflicts.set(segment, competing)
      if (this.owner === competing) this.owner = undefined
    }
    this.notify?.()
  }
  private foreign(turn: string) {
    for (const conflict of this.conflicts.values()) if (conflict === turn) return true
    return false
  }
  get ownedSpeaker() {
    return this.matched &&
      this.current &&
      !this.foreign(this.current) &&
      this.current === this.owner
      ? this.current
      : undefined
  }
  private get finished() {
    return (
      this.matched &&
      !this.current &&
      !!this.owner &&
      this.done.has(this.owner) &&
      !this.foreign(this.owner)
    )
  }
  retire() {
    this.stopped = true
    this.notify?.()
  }
  wait(): Promise<boolean> {
    if (this.stopped || this.finished) return Promise.resolve(!this.stopped)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timedOut = true
        this.onUncertain?.()
      }, 30000)
      timer.unref?.()
      this.notify = () => {
        if (!this.stopped && !this.finished) return
        clearTimeout(timer)
        this.notify = undefined
        resolve(!this.stopped)
      }
    })
  }
}
