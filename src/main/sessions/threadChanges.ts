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

type Entry = {
  checked: number
  running?: Promise<void>
  data: ThreadDiffData | null
  replay?: ClaudeDiffReplay
}
/** Independent cache per provider-qualified chat ID. Nothing is read from current worktree files. */
export class ThreadChanges {
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
  private entry(session: Session): Entry {
    let entry = this.entries.get(session.id)
    if (!entry) {
      entry = { checked: -Infinity, data: null }
      this.entries.set(session.id, entry)
      if (this.entries.size > 128) {
        const oldest = [...this.entries].find(([id, value]) => id !== session.id && !value.running)
        if (oldest) this.entries.delete(oldest[0])
      }
    }
    if (!entry.running && (this.options.now?.() ?? Date.now()) - entry.checked >= 5000)
      this.refresh(session, entry)
    return entry
  }
  private refresh(session: Session, entry: Entry) {
    entry.running = Promise.resolve()
      .then(async () => {
        let next: ThreadDiffData | null = null
        try {
          if (session.id.startsWith('codex:'))
            next =
              readCodexThreadDiff(this.options.history, session.id.slice(6), session.cwd)?.data(
                session.git?.root ?? null,
              ) ?? null
          else {
            const path = this.options.transcript(session.id)
            if (path) {
              if (!entry.replay || entry.replay.path !== path)
                entry.replay = new ClaudeDiffReplay(path, session.cwd)
              await entry.replay.update()
              next = entry.replay.reader.ledger.data(session.git?.root ?? null)
            }
          }
        } catch {
          entry.replay = undefined
        }
        const changed = next?.summary.revision !== entry.data?.summary.revision
        entry.data = next
        entry.checked = this.options.now?.() ?? Date.now()
        if (changed) this.options.changed()
      })
      .finally(() => {
        entry.running = undefined
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
    await entry.running
    return entry.data
  }
  annotate(snapshot: Snapshot): Snapshot {
    const cache = new Map<string, Session>()
    const attach = (session: Session): Session => {
      let result = cache.get(session.id)
      if (!result) {
        result = { ...session, threadDiff: this.summary(session) }
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
