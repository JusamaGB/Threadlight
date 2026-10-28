import type { ArtifactReply } from './artifacts'

type Catalog = Omit<Extract<ArtifactReply, { ok: true }>, 'content'>
type Entry = {
  value?: Catalog
  checked: number
  revision: number
  pending?: Promise<ArtifactReply>
  listeners: Set<() => void>
}

/** Metadata only: keep original files in place and read/execute content only when opened. */
export class ArtifactCatalog {
  private entries = new Map<string, Entry>()
  private active = 0
  private queue: (() => void)[] = []
  constructor(
    private readonly fetch: (id: string) => Promise<ArtifactReply>,
    private readonly now = Date.now,
    private readonly limit = 500,
  ) {}

  get(id: string): Catalog | undefined {
    return this.entries.get(id)?.value
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { checked: -Infinity, revision: 0, listeners: new Set() }
      this.entries.set(id, entry)
    }
    return entry
  }

  subscribe(id: string, listener: () => void): () => void {
    const entry = this.entry(id)
    entry.listeners.add(listener)
    void this.refresh(id)
    return () => {
      entry.listeners.delete(listener)
      this.prune()
    }
  }

  accept(id: string, reply: ArtifactReply): void {
    if (!reply.ok) return
    const entry = this.entry(id)
    entry.revision++
    entry.checked = this.now()
    // Never retain the bytes supplied by a read/copy response in the catalog.
    const value: Catalog = { ok: true, items: reply.items, notice: reply.notice }
    if (JSON.stringify(entry.value) !== JSON.stringify(value)) {
      entry.value = value
      for (const listener of entry.listeners) listener()
    }
    this.prune()
  }

  refresh(id: string, ttl = 3000): Promise<ArtifactReply> {
    const entry = this.entry(id)
    if (entry.pending) return entry.pending
    if (this.now() - entry.checked < ttl)
      return Promise.resolve(entry.value ?? { ok: false, reason: 'Could not load artifacts.' })
    entry.pending = new Promise<ArtifactReply>((resolve) => {
      this.queue.push(() => {
        this.active++
        const revision = entry.revision
        void this.fetch(id)
          .catch((): ArtifactReply => ({ ok: false, reason: 'Could not load artifacts.' }))
          .then((reply) => {
            if (revision === entry.revision) {
              entry.checked = this.now()
              this.accept(id, reply)
            }
            resolve(entry.value ?? reply)
          })
          .finally(() => {
            entry.pending = undefined
            this.active--
            this.prune()
            this.drain()
          })
      })
    })
    this.drain()
    return entry.pending
  }

  /** Visible rows first, then a small slice of hidden rows; never scan an entire history at once. */
  tick(warm: string[]): void {
    for (const [id, entry] of this.entries) if (entry.listeners.size) void this.refresh(id)
    const candidates = warm
      .filter((id) => {
        const entry = this.entries.get(id)
        return !entry?.pending && (!entry || this.now() - entry.checked >= 30000)
      })
      .sort(
        (a, b) =>
          (this.entries.get(a)?.checked ?? -Infinity) - (this.entries.get(b)?.checked ?? -Infinity),
      )
    for (const id of candidates.slice(0, 12)) void this.refresh(id, 30000)
  }

  private drain(): void {
    while (this.active < 4 && this.queue.length) this.queue.shift()!()
  }

  private prune(): void {
    if (this.entries.size <= this.limit) return
    const idle = [...this.entries]
      .filter(([, entry]) => !entry.pending && !entry.listeners.size)
      .sort(([, a], [, b]) => a.checked - b.checked)
    for (const [id] of idle) {
      if (this.entries.size <= this.limit) break
      this.entries.delete(id)
    }
  }
}
