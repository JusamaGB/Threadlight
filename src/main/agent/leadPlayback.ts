/** Wait for the submitted opening's words and a completed playback turn before
 * offering the rest. A competing direct utterance cannot open this gate. */
export class LeadPlayback {
  private current?: string
  private done = new Set<string>()
  private foreign = new Set<string>()
  private competingSegments = new Set<string>()
  private foreignBeforeStart = false
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
    return !this.current && this.done.size > 0 && !this.finished && !this.stopped
  }
  start(id: string) {
    this.current = id
    if (this.foreignBeforeStart) {
      this.foreign.add(id)
      this.foreignBeforeStart = false
    }
    if (this.matched && !this.owner && !this.foreign.has(id)) this.owner = id
  }
  end(id: string) {
    if (id !== this.current) return
    this.done.add(id)
    this.current = undefined
    if (this.uncertain) this.onUncertain?.()
    this.notify?.()
  }
  caption(segment: string, matching: boolean, complete: boolean, native?: string) {
    if (matching && complete) {
      this.matched = true
      this.owner =
        native ??
        this.owner ??
        (this.current && !this.foreign.has(this.current) ? this.current : undefined)
    } else if (!matching && (!this.competingSegments.has(segment) || native)) {
      // A partial can already contradict the opening. Its later completion must
      // not transfer the same conflict onto a new, unrelated playback turn.
      this.competingSegments.add(segment)
      const competing = native ?? this.current
      if (competing) {
        this.foreign.add(competing)
        if (this.owner === competing) this.owner = undefined
      } else if (!this.done.size) this.foreignBeforeStart = true
      else this.foreign.add([...this.done].at(-1)!)
    }
    this.notify?.()
  }
  get ownedSpeaker() {
    return this.matched &&
      this.current &&
      !this.foreign.has(this.current) &&
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
      !this.foreign.has(this.owner)
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
