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
        entry.version++
        entry.checked = -Infinity
      }
      this.summary(session)
    }
  }
  private entry(session: Session): Entry {
    let entry = this.entries.get(session.id)
    if (!entry) {
      entry = { checked: -Infinity, data: null, input: '', root: null, version: 0, latest: session }
      this.entries.set(session.id, entry)
      if (this.entries.size > 128) {
        const oldest = [...this.entries].find(([id, value]) => id !== session.id && !value.running)
        if (oldest) this.entries.delete(oldest[0])
      }
    }
    const root = session.git?.root ?? null
    const input = `${root ?? ''}\0${session.cwd}\0${session.lastActiveAt}`
    if (entry.input !== input) {
      if (entry.root !== root) entry.data = null
      entry.input = input
      entry.root = root
      entry.version++
      entry.checked = -Infinity
    }
    entry.latest = session
    if (!root) return entry
    if (!entry.running && (this.options.now?.() ?? Date.now()) - entry.checked >= 5000)
      this.refresh(session, entry)
    return entry
  }
  private refresh(session: Session, entry: Entry) {
    const version = entry.version
    const before = entry.data?.summary.revision
    const first = entry.checked === -Infinity
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
        entry.data = next
        entry.checked = this.options.now?.() ?? Date.now()
      })
      .finally(() => {
        entry.running = undefined
        if (version !== entry.version) this.refresh(entry.latest, entry)
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
    while (entry.running) await entry.running
    return entry.data
  }
  annotate(snapshot: Snapshot): Snapshot {
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
            : session.gitStatus === 'loading' || entry.running
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
    const listed = snapshot.sessions.map(attach)
    const workspaces = snapshot.workspaces.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map(node),
    }))
    this.listed = cache
    return {
      ...snapshot,
      sessions: listed,
      // Voice/search-only catalogue entries do not schedule thousands of background replays.
      lookupSessions: snapshot.lookupSessions?.map((session) => cache.get(session.id) ?? session),
      workspaces,
    }
  }
}
