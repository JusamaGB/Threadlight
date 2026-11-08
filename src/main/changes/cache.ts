type Entry<T> = { at: number; pending: boolean; dirty: boolean; value: Promise<T>; result?: T }
/** Coalesces one root/lens observation, but never answers fresh demand with invalidated work. */
export class CaptureCache<T> {
  private entries = new Map<string, Entry<T>>()
  invalidate(matches: (key: string) => boolean = () => true): void {
    for (const [key, entry] of this.entries)
      if (matches(key)) {
        entry.dirty = true
        if (!entry.pending) this.entries.delete(key)
      }
  }
  discard(matches: (result: T) => boolean): void {
    for (const [key, entry] of this.entries)
      if (!entry.pending && entry.result !== undefined && matches(entry.result))
        this.entries.delete(key)
  }
  get(key: string, read: () => Promise<T>, now = Date.now()): Promise<T> {
    const previous = this.entries.get(key)
    if (previous?.pending && previous.dirty)
      return previous.value.catch(() => undefined).then(() => this.get(key, read, now))
    if (previous && (previous.pending || now - previous.at < 1000)) return previous.value
    const entry: Entry<T> = {
      at: now,
      pending: true,
      dirty: false,
      value: Promise.resolve(undefined as T),
    }
    this.entries.set(key, entry)
    entry.value = read()
      .then((result) => {
        entry.result = result
        return result
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key)
        throw error
      })
      .finally(() => {
        entry.pending = false
        if (entry.dirty && this.entries.get(key) === entry) this.entries.delete(key)
        for (const [otherKey, other] of this.entries) {
          if (this.entries.size <= 32) break
          if (!other.pending) this.entries.delete(otherKey)
        }
      })
    return entry.value
  }
}
