export type NavigationDirection = 'back' | 'forward'
export interface NavigationHandle {
  navigate: (direction: NavigationDirection) => boolean
}

/** UI locations only: moving through this history never replays a command or a mutation. */
export class NavigationHistory<T> {
  private entries: { key: string; value: T }[] = []
  private index = -1
  get current(): T | undefined {
    return this.entries[this.index]?.value
  }
  record(value: T): void {
    const key = JSON.stringify(value, (name, entry) => (name === 'scroll' ? undefined : entry))
    if (this.entries[this.index]?.key === key) {
      this.entries[this.index] = { key, value }
      return
    }
    // Existing on-screen Back controls also preserve the forward path.
    const earlier = this.entries.slice(0, this.index).findLastIndex((entry) => entry.key === key)
    if (earlier >= 0) {
      this.index = earlier
      this.entries[earlier] = { key, value }
      return
    }
    this.entries.splice(this.index + 1)
    this.entries.push({ key, value })
    if (this.entries.length > 64) this.entries.shift()
    this.index = this.entries.length - 1
  }
  travel(direction: NavigationDirection): T | undefined {
    const index = this.index + (direction === 'back' ? -1 : 1)
    if (index < 0 || index >= this.entries.length) return undefined
    this.index = index
    return this.entries[index]!.value
  }
  reset(value: T): void {
    this.entries = []
    this.index = -1
    this.record(value)
  }
}
