import { setImmediate as yieldToEvents } from 'node:timers/promises'
import { gitPathKey } from './gitRepository'
import type {
  Changes,
  FileDiff,
  Session,
  Snapshot,
  ThreadDiffSummary,
  ThreadNode,
} from '../../shared/types'
import { ClaudeDiffReplay, readCodexThreadDiff } from './threadDiffSources'
import type { ThreadDiffData } from './threadDiff'
import { UncommittedThreads } from './threadUncommitted'

type Entry = {
  checked: number
  input: string
  root: string | null
  version: number
  latest: Session
  dirty: boolean
  settled: boolean
  running?: Promise<void>
  data: ThreadDiffData | null
  replay?: ClaudeDiffReplay
}
/** Recorded ownership projected onto current uncommitted Git changes, per chat. */
export class ThreadChanges {
  private uncommitted = new UncommittedThreads()
  private entries = new Map<string, Entry>()
  private listed = new Map<string, Session>()
  constructor(
    private readonly options: {
      history: string
      transcript: (id: string) => string | null
      changed: () => void
      now?: () => number
    },
  ) {}

  summary(session: Session): ThreadDiffSummary | null {
    const entry = this.entry(session)
    return entry.data?.summary ?? null
  }
  /** Source edits can change without changing the repository/session presentation. */
  refreshListed(): void {
    for (const session of this.listed.values()) this.summary(session)
  }
  invalidate(root?: string): void {
    this.uncommitted.invalidate(root)
    for (const session of this.listed.values()) {
      if (root && (!session.git || gitPathKey(root) !== gitPathKey(session.git.root))) continue
      const entry = this.entries.get(session.id)
      if (entry) {
        // Filesystem activity may continue throughout a read. Publish that
        // observation and coalesce another read rather than starving the UI.
        entry.dirty = true
        entry.checked = -Infinity
      }
      this.summary(session)
    }
  }
  private entry(session: Session): Entry {
    let entry = this.entries.get(session.id)
    if (!entry) {
      entry = {
        checked: -Infinity,
        data: null,
        input: '',
        root: null,
        version: 0,
        latest: session,
        dirty: false,
        settled: false,
      }
      this.entries.set(session.id, entry)
      this.prune(session.id)
    }
    const root = session.git?.root ?? null
    const input = `${root ?? ''}\0${session.cwd}`
    if (entry.input !== input) {
      if (entry.root !== root) {
        entry.data = null
        entry.settled = false
      }
      entry.input = input
      entry.root = root
      entry.version++
      entry.checked = -Infinity
    }
    if (entry.latest.lastActiveAt !== session.lastActiveAt) {
      // Native activity can advance throughout a read, even without a file edit.
      // Publish that valid read and coalesce newer activity into one follow-up.
      entry.dirty = true
      entry.checked = -Infinity
    }
    entry.latest = session
    if (!root) return entry
    if (!entry.running && (this.options.now?.() ?? Date.now()) - entry.checked >= 5000)
      this.refresh(session, entry)
    return entry
  }
  private refresh(session: Session, entry: Entry) {
    entry.dirty = false
    const version = entry.version
    const before = entry.data?.summary.revision
    const first = !entry.settled
    entry.running = yieldToEvents()
      .then(async () => {
        let next: ThreadDiffData | null = null
        try {
          if (!session.git?.root) {
            // Wait for root discovery; it invalidates this entry immediately when available.
          } else if (session.id.startsWith('codex:')) {
            const ledger = readCodexThreadDiff(
              this.options.history,
              session.id.slice(6),
              session.cwd,
            )
            if (ledger)
              next = await this.uncommitted.project(
                ledger,
                session.git?.root ?? null,
                this.options.now?.() ?? Date.now(),
              )
          } else {
            const path = this.options.transcript(session.id)
            if (path) {
              if (!entry.replay || entry.replay.path !== path)
                entry.replay = new ClaudeDiffReplay(path, session.cwd)
              await entry.replay.update()
              next = await this.uncommitted.project(
                entry.replay.reader.ledger,
                session.git?.root ?? null,
                this.options.now?.() ?? Date.now(),
              )
            }
          }
        } catch {
          entry.replay = undefined
        }
        if (version !== entry.version) return
        // A failed provider/Git read is not evidence that recorded edits vanished.
        // A successful empty projection still replaces the previous counts.
        if (next) entry.data = next
        entry.settled = true
        entry.checked = entry.dirty ? -Infinity : (this.options.now?.() ?? Date.now())
      })
      .finally(() => {
        entry.running = undefined
        if (entry.latest.git?.root && (version !== entry.version || entry.dirty))
          this.refresh(entry.latest, entry)
        if (first || before !== entry.data?.summary.revision) this.options.changed()
      })
  }
  async changes(session: Session): Promise<Changes | null> {
    const data = await this.read(session)
    return data
      ? {
          branch: session.git?.branch ?? null,
          files: data.files.map((item) => item.file),
          complete: data.summary.complete,
        }
      : null
  }
  async file(session: Session, path: string): Promise<FileDiff> {
    return (
      (await this.read(session))?.files.find((item) => item.file.path === path)?.diff ?? {
        kind: 'unavailable',
      }
    )
  }
  async absolute(session: Session, path: string): Promise<string | null> {
    return (
      (await this.read(session))?.files.find((item) => item.file.path === path)?.absolute ?? null
    )
  }
  private async read(session: Session): Promise<ThreadDiffData | null> {
    const entry = this.entry(session)
    // Wait for this observation, not an unbounded chain of background follow-ups.
    await entry.running
    return entry.data
  }
  private prune(current?: string): void {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= 128) break
      if (id !== current && !this.listed.has(id) && !entry.running) this.entries.delete(id)
    }
  }
  annotate(snapshot: Snapshot): Snapshot {
    // Pin the new demand set before creating entries. Cache limits apply to idle
    // history, not to rows included in the current snapshot.
    const listed = new Map(snapshot.sessions.map((session) => [session.id, session]))
    const collect = (nodes: ThreadNode[]) => {
      for (const node of nodes) {
        listed.set(node.session.id, node.session)
        collect(node.children)
      }
    }
    for (const workspace of snapshot.workspaces) collect(workspace.threads)
    this.listed = listed
    this.prune()
    const cache = new Map<string, Session>()
    const attach = (session: Session): Session => {
      let result = cache.get(session.id)
      if (!result) {
        const summary = this.summary(session)
        const entry = this.entries.get(session.id)!
        result = {
          ...session,
          threadDiff: summary,
          threadDiffStatus: summary
            ? 'ready'
            : session.gitStatus === 'loading' || (!entry.settled && entry.running)
              ? 'loading'
              : 'unavailable',
        }
        cache.set(session.id, result)
      }
      return result
    }
    const node = (item: ThreadNode): ThreadNode => ({
      session: attach(item.session),
      children: item.children.map(node),
    })
    const sessions = snapshot.sessions.map(attach)
    const workspaces = snapshot.workspaces.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map(node),
    }))
    this.listed = cache
    return {
      ...snapshot,
      sessions,
      // Voice/search-only catalogue entries do not schedule thousands of background replays.
      lookupSessions: snapshot.lookupSessions?.map((session) => cache.get(session.id) ?? session),
      workspaces,
    }
  }
}
