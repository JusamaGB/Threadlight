import type {
  ThreadTimeline,
  TimelineItem,
  TimelineReply,
  TimelineRequest,
} from '../shared/threadTimeline'
import { mergeTimeline } from '../shared/threadTimeline'
import type { AdapterRead, HistoryCursor } from './threadRead/types'
import type { StreamUpdate } from './codex/threadStream'

export interface TimelineDependencies {
  allowed(id: string): boolean
  read(id: string, cursor?: HistoryCursor): Promise<AdapterRead>
  follow(id: string, changed: (update: StreamUpdate) => void): () => void
  changed(timeline: ThreadTimeline): void
}
interface Entry {
  value: ThreadTimeline
  subscriptions: Set<string>
  older: TimelineItem[]
  latest: TimelineItem[]
  cursor?: HistoryCursor
  cursorReady: boolean
  read?: Promise<void>
  stop?: () => void
  poll?: NodeJS.Timeout
  expiry?: NodeJS.Timeout
  generation: number
}

/** Working rows and expanded cards share a feed; cached history survives collapsing. */
export class ThreadTimelineService {
  private entries = new Map<string, Entry>()
  private revision = 0
  constructor(private deps: TimelineDependencies) {}

  /** Resolve only recorded image events in an actively subscribed, allowed thread. */
  imagePath(threadId: string, itemId: string): string | null {
    const entry = this.entries.get(threadId)
    if (!this.deps.allowed(threadId) || !entry?.subscriptions.size) return null
    const item = entry.value.items.find((item) => item.id === itemId)
    return item?.activity === 'image' && item.role === 'activity' ? (item.detail ?? null) : null
  }

  private publish(entry: Entry) {
    const items = mergeTimeline(entry.older, entry.latest)
    // Keep renderer payloads bounded. Older pages stop explicitly at this session-local limit.
    let bytes = 0
    const bounded: TimelineItem[] = []
    for (const item of items.toReversed()) {
      bytes +=
        item.text.length +
        (item.detail?.length ?? 0) +
        (item.fileChanges?.reduce(
          (total, file) => total + file.path.length + (file.diff?.length ?? 0),
          0,
        ) ?? 0)
      if (bounded.length >= 2000 || bytes > 2_000_000) break
      bounded.push(item)
    }
    if (bounded.length < items.length) {
      entry.value.notice = 'History limit reached. Open the thread in its app for earlier messages.'
      entry.cursor = undefined
      entry.older = []
      entry.latest = bounded.reverse()
    }
    entry.value = {
      ...entry.value,
      items: bounded.length === items.length ? items : entry.latest,
      hasMore: !!entry.cursor,
      revision: ++this.revision,
    }
    if (entry.subscriptions.size) this.deps.changed(entry.value)
  }

  async request(input: TimelineRequest): Promise<TimelineReply> {
    const { threadId: id, subscriptionId: token, action } = input
    let entry = this.entries.get(id)
    if (action === 'close') {
      if (!entry) return { ok: false, reason: 'Thread view already closed.' }
      entry.subscriptions.delete(token)
      if (!entry.subscriptions.size) this.suspend(id, entry)
      return { ok: true, timeline: entry.value }
    }
    if (!this.deps.allowed(id))
      return { ok: false, reason: 'Thread is unavailable or monitoring is disabled.' }
    if (action === 'open') {
      if (!entry) {
        if (this.entries.size >= 24) {
          const idle = [...this.entries].find(([, e]) => !e.subscriptions.size)
          if (idle) {
            clearTimeout(idle[1].expiry)
            this.entries.delete(idle[0])
          } else return { ok: false, reason: 'Too many open thread views.' }
        }
        entry = {
          value: {
            threadId: id,
            revision: 0,
            connection: 'connecting',
            items: [],
            hasMore: false,
            loadingOlder: false,
          },
          subscriptions: new Set(),
          older: [],
          latest: [],
          cursorReady: false,
          generation: 0,
        }
        this.entries.set(id, entry)
      }
      if (entry.subscriptions.size >= 8 && !entry.subscriptions.has(token))
        return { ok: false, reason: 'Too many subscriptions.' }
      clearTimeout(entry.expiry)
      const first = entry.subscriptions.size === 0
      entry.subscriptions.add(token)
      if (first) this.start(id, entry)
      return { ok: true, timeline: entry.value }
    }
    if (!entry?.subscriptions.has(token))
      return { ok: false, reason: 'Open this thread before loading history.' }
    if (entry.value.loadingOlder || !entry.cursor) return { ok: true, timeline: entry.value }
    entry.value.loadingOlder = true
    this.publish(entry)
    const generation = entry.generation
    try {
      const page = await this.deps.read(id, entry.cursor)
      if (generation !== entry.generation) return { ok: true, timeline: entry.value }
      if (page.sources.every((source) => source.health === 'unavailable'))
        throw Error('Unavailable')
      entry.older = mergeTimeline(page.items, entry.older)
      entry.cursor = page.cursor
      entry.value.notice = page.coverage.length
        ? 'Some history is unavailable in the provider transcript.'
        : undefined
    } catch (error) {
      if (generation !== entry.generation) return { ok: true, timeline: entry.value }
      entry.value.notice =
        (error as Error).message === 'cursor_expired'
          ? 'History moved. Reopen the thread to refresh earlier messages.'
          : 'Earlier messages could not be read. Try again.'
      if ((error as Error).message === 'cursor_expired') {
        entry.cursorReady = false
        entry.cursor = undefined
      }
    } finally {
      if (generation === entry.generation) {
        entry.value.loadingOlder = false
        this.publish(entry)
      }
    }
    return { ok: true, timeline: entry.value }
  }

  private start(id: string, entry: Entry) {
    const generation = ++entry.generation
    entry.value.connection = 'connecting'
    const valid = () => entry.generation === generation && entry.subscriptions.size > 0
    const refresh = () => {
      if (!valid()) return
      if (!this.deps.allowed(id)) {
        this.suspend(id, entry)
        entry.value.connection = 'unavailable'
        entry.value.notice = 'Thread monitoring is no longer available.'
        this.publish(entry)
        return
      }
      if (entry.read || entry.value.connection === 'live') return
      entry.read = this.deps
        .read(id)
        .then((page) => {
          if (!valid()) return
          if (page.sources.every((source) => source.health === 'unavailable'))
            throw Error('History unavailable')
          if (!entry.cursorReady) {
            entry.cursor = page.cursor
            entry.cursorReady = true
          }
          if (entry.value.connection !== 'live') {
            // Keep the loaded prefix if the provider's bounded recent window has advanced.
            const overlap = entry.latest.findIndex((item) =>
              page.items.some((next) => next.id === item.id),
            )
            if (overlap > 0)
              entry.older = mergeTimeline(entry.older, entry.latest.slice(0, overlap))
            // Keep confirmed content while the disk projection catches up.
            if (page.items.length || !entry.latest.length) entry.latest = page.items
            if (!id.startsWith('codex:')) {
              entry.value.connection = 'history'
              entry.value.notice = page.coverage.length
                ? 'Some history is unavailable in the provider transcript.'
                : undefined
            }
          }
          this.publish(entry)
        })
        .catch(() => {
          if (!valid() || entry.value.connection === 'live') return
          entry.value.connection = entry.value.items.length ? 'reconnecting' : 'unavailable'
          entry.value.notice = 'History is temporarily unavailable. Previous messages are retained.'
          this.publish(entry)
        })
        .finally(() => {
          entry.read = undefined
        })
    }
    refresh()
    if (id.startsWith('codex:'))
      entry.stop = this.deps.follow(id.slice(6), (update) => {
        if (!valid()) return
        entry.value.connection = update.connection
        if (update.connection === 'live') {
          entry.latest = update.items
          entry.value.notice = undefined
        } else entry.value.notice = update.notice
        this.publish(entry)
      })
    entry.poll = setInterval(() => {
      // Authorization is checked even while a native stream is healthy.
      if (!this.deps.allowed(id)) refresh()
      else if (entry.value.connection !== 'live') refresh()
    }, 1500)
  }

  private suspend(id: string, entry: Entry) {
    entry.generation++
    entry.stop?.()
    entry.stop = undefined
    clearInterval(entry.poll)
    clearTimeout(entry.expiry)
    entry.value.loadingOlder = false
    entry.expiry = setTimeout(() => {
      if (!entry.subscriptions.size) this.entries.delete(id)
    }, 5 * 60_000)
    entry.expiry.unref()
  }

  close() {
    for (const [id, entry] of this.entries) {
      this.suspend(id, entry)
      clearTimeout(entry.expiry)
    }
    this.entries.clear()
  }
}
