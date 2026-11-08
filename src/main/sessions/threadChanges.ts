import { setImmediate as yieldToEvents } from 'node:timers/promises'
import { stat } from 'node:fs/promises'
import { ThreadReconciliation } from './threadReconciliation'
import { dirname } from 'node:path'
import { gitPathKey, findGitRepository, type GitRepository } from './gitRepository'
import type {
  Changes,
  FileDiff,
  Session,
  Snapshot,
  ThreadDiffSummary,
  ThreadNode,
} from '../../shared/types'
import { ClaudeDiffReplay, readCodexThreadDiff } from './threadDiffSources'
import type { ThreadDiffData, ThreadDiffLedger } from './threadDiff'
import { UncommittedThreads } from './threadUncommitted'
import { digest, coverage, within, type LocalComparison } from '../changes/git'
import type { ChangeRootGroup, CoverageReason } from '../../shared/changes'

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
  private revisions = new Map<
    string,
    { sessionId: string; root: string | null; at: number; data: ThreadDiffData }
  >()
  private uncommitted = new UncommittedThreads()
  private reconciliation = new ThreadReconciliation()
  private repositories = new Map<string, GitRepository>()
  private entries = new Map<string, Entry>()
  private listed = new Map<string, Session>()
  constructor(
    private readonly options: {
      history: string
      transcript: (id: string) => string | null
      changed: () => void
      now?: () => number
      recordEvidence?: (session: Session, ledger: ThreadDiffLedger) => Promise<void>
      recordedEvidence?: (session: Session) => Promise<ThreadDiffLedger | null>
      folderComparison?: (session: Session) => Promise<LocalComparison | null>
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
    this.reconciliation.invalidate()
    for (const session of this.listed.values()) {
      const entry = this.entries.get(session.id)
      if (
        root &&
        gitPathKey(root) !== gitPathKey(session.git?.root ?? session.cwd) &&
        !entry?.data?.summary.groups?.some((group) => gitPathKey(group.root) === gitPathKey(root))
      )
        continue
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
    const root = session.git?.root ?? (this.options.folderComparison ? session.cwd : null)
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
          if (!session.git?.root && !this.options.folderComparison) {
            // Wait for root discovery; it invalidates this entry immediately when available.
          } else if (session.id.startsWith('codex:')) {
            const ledger = readCodexThreadDiff(
              this.options.history,
              session.id.slice(6),
              session.cwd,
            )
            if (ledger) {
              await this.options.recordEvidence?.(session, ledger).catch(() => {})
              next = await this.project(session, ledger)
            }
          } else {
            const path = this.options.transcript(session.id)
            if (path) {
              if (!entry.replay || entry.replay.path !== path)
                entry.replay = new ClaudeDiffReplay(path, session.cwd)
              await entry.replay.update()
              await this.options
                .recordEvidence?.(session, entry.replay.reader.ledger)
                .catch(() => {})
              next = await this.project(session, entry.replay.reader.ledger)
            }
          }
        } catch {
          entry.replay = undefined
        }
        if (!next && (session.git?.root || session.cwd)) {
          const retained = await this.options.recordedEvidence?.(session).catch(() => null)
          if (retained) next = await this.project(session, retained)
        }
        if (version !== entry.version) return
        if (next && entry.data && next.summary.groups?.some((group) => !group.available)) {
          // Recovered history does not turn a failed current read into an exact zero.
          const unavailable = new Set(
            next.summary.groups.filter((group) => !group.available).map((group) => group.rootId),
          )
          const retained = entry.data.files.filter(
            (file) => file.file.rootId && unavailable.has(file.file.rootId),
          )
          if (retained.length) {
            next.files.push(...retained)
            next.summary = {
              ...next.summary,
              files: next.files.length,
              added: next.summary.mixedLenses
                ? 0
                : next.files.reduce((n, file) => n + file.file.added, 0),
              removed: next.summary.mixedLenses
                ? 0
                : next.files.reduce((n, file) => n + file.file.removed, 0),
              complete: false,
              stale: true,
              coverage: coverage(
                [...(next.summary.coverage?.reasons ?? []), 'git-read-failed'],
                true,
              ),
              revision: digest(JSON.stringify([next.summary.revision, retained])),
            }
          }
        }
        // A failed provider/Git read is not evidence that recorded edits vanished.
        // A successful empty projection still replaces the previous counts.
        if (next) {
          entry.data = next
          this.revisions.set(next.summary.revision, {
            sessionId: session.id,
            root: entry.root,
            at: Date.now(),
            data: next,
          })
          for (const [id, revision] of this.revisions) {
            if (Date.now() - revision.at > 15 * 60_000 || this.revisions.size > 128)
              this.revisions.delete(id)
          }
        } else if (entry.data) {
          entry.data = {
            ...entry.data,
            summary: {
              ...entry.data.summary,
              complete: false,
              stale: true,
              coverage: { state: 'partial', stale: true, reasons: ['git-read-failed'] },
              revision: `${entry.data.summary.revision.replace(/:stale$/, '')}:stale`,
            },
          }
        }
        entry.settled = true
        entry.checked = entry.dirty ? -Infinity : (this.options.now?.() ?? Date.now())
      })
      .finally(() => {
        entry.running = undefined
        if (entry.root && (version !== entry.version || entry.dirty))
          this.refresh(entry.latest, entry)
        if (first || before !== entry.data?.summary.revision) this.options.changed()
      })
  }
  /** Provider-recorded bindings and the session checkout define the permitted review roots. */
  async workflowRoots(session: Session): Promise<string[]> {
    const data = await this.read(session)
    return [
      ...new Set([
        session.git?.root ?? session.cwd,
        ...(data?.files.map((file) => file.root) ?? []),
        ...(data?.summary.groups
          ?.filter((group) => group.lens === 'git-current')
          .map((group) => group.root) ?? []),
      ]),
    ].filter((root): root is string => !!root)
  }
  async changes(session: Session): Promise<Changes | null> {
    const entry = this.entry(session)
    const firstRead = !entry.data
    const pending = entry.running
    await pending
    if (!firstRead && !pending) {
      entry.checked = -Infinity
      this.uncommitted.invalidate(entry.root ?? undefined)
    }
    // Any pending read has already completed above. Do not wait on a newer
    // background observation, which can remain busy while the chat is active.
    const data = pending ? entry.data : await this.read(session)
    return data
      ? {
          branch:
            data.summary.groups && data.summary.groups.length > 1
              ? null
              : (session.git?.branch ?? null),
          files: data.files.map((item) => item.file),
          complete: data.summary.complete,
          revision: data.summary.revision,
          lens: data.summary.lens ?? 'git-current',
          stale: data.summary.stale,
          hasOtherLensChanges: data.summary.hasOtherLensChanges,
          attributionCoverage: data.summary.coverage,
          groups: data.summary.groups,
        }
      : null
  }
  async file(session: Session, path: string, revision?: string): Promise<FileDiff> {
    if (revision) {
      const found = this.revisions.get(revision)
      if (
        !found ||
        found.sessionId !== session.id ||
        found.root !==
          (session.git?.root ?? (this.options.folderComparison ? session.cwd : null)) ||
        Date.now() - found.at > 15 * 60_000
      )
        return { kind: 'unavailable', reason: 'This revision is no longer available; refresh.' }
      found.at = Date.now()
      return (
        found.data.files.find((item) => item.file.path === path)?.diff ?? { kind: 'unavailable' }
      )
    }
    return (
      (await this.read(session))?.files.find((item) => item.file.path === path)?.diff ?? {
        kind: 'unavailable',
      }
    )
  }
  async absolute(session: Session, path: string, revision?: string): Promise<string | null> {
    if (revision) {
      const found = this.revisions.get(revision)
      if (
        !found ||
        found.sessionId !== session.id ||
        found.root !== (session.git?.root ?? session.cwd) ||
        Date.now() - found.at > 15 * 60_000
      )
        return null
      return found.data.files.find((item) => item.file.path === path)?.absolute ?? null
    }
    return (
      (await this.read(session))?.files.find((item) => item.file.path === path)?.absolute ?? null
    )
  }
  async sourceRoot(session: Session, path: string, revision?: string): Promise<string | null> {
    const absolute = await this.absolute(session, path, revision)
    if (!absolute) return null
    const data = revision ? this.revisions.get(revision)?.data : await this.read(session)
    return (
      data?.files.find((item) => item.file.path === path)?.root ?? session.git?.root ?? session.cwd
    )
  }
  async roots(session: Session): Promise<{ rootId: string; root: string }[]> {
    const data = await this.read(session)
    const primary = session.git?.root ?? session.cwd
    return data?.summary.groups ?? (primary ? [{ rootId: digest(primary), root: primary }] : [])
  }
  forget(root: string): void {
    this.repositories.delete(gitPathKey(root))
    this.reconciliation.invalidate()
    for (const [id, value] of this.revisions)
      if (
        (value.root && gitPathKey(value.root) === gitPathKey(root)) ||
        value.data.files.some((file) => file.root && gitPathKey(file.root) === gitPathKey(root))
      )
        this.revisions.delete(id)
    for (const entry of this.entries.values())
      if (
        (entry.root && gitPathKey(entry.root) === gitPathKey(root)) ||
        entry.data?.summary.groups?.some((group) => gitPathKey(group.root) === gitPathKey(root))
      ) {
        entry.data = null
        entry.version++
        entry.checked = -Infinity
      }
  }
  private async read(session: Session): Promise<ThreadDiffData | null> {
    const entry = this.entry(session)
    // Wait for this observation, not an unbounded chain of background follow-ups.
    await entry.running
    return entry.data
  }
  private async project(
    session: Session,
    ledger: ThreadDiffLedger,
  ): Promise<ThreadDiffData | null> {
    const primary = session.git?.root ?? session.cwd
    const roots = new Map<string, { path: string; git: boolean; historyRoot?: string }>()
    if (primary) roots.set(gitPathKey(primary), { path: primary, git: !!session.git?.root })
    if (session.git?.root) {
      const repository = await findGitRepository(primary)
      if (repository) this.repositories.set(gitPathKey(repository.root), repository)
    }
    // Successful structured file mutations may establish additional bindings. Prose
    // and shell command strings never broaden this read scope or enable recording.
    const folders = [
      ...new Set(
        ledger
          .evidence()
          .flatMap((file) => file.paths)
          .map((path) => dirname(path)),
      ),
    ]
    let limited = false
    for (const folder of folders.slice(0, 32)) {
      const repository = await findGitRepository(folder)
      if (repository) {
        this.repositories.set(gitPathKey(repository.root), repository)
        roots.set(gitPathKey(repository.root), { path: repository.root, git: true })
      } else if (
        !roots.has(gitPathKey(folder)) &&
        ![...roots.values()].some((root) => !root.git && within(root.path, folder))
      )
        roots.set(gitPathKey(folder), { path: folder, git: false })
    }
    // Recover only a previously observed Git common-directory binding. Names and patch
    // similarity alone cannot establish that a vanished checkout belonged to a repository.
    for (const [key, root] of [...roots]) {
      if (await stat(root.path).catch(() => null)) continue
      const binding = [...this.repositories.values()]
        .sort((a, b) => b.root.length - a.root.length)
        .find((repo) => within(repo.root, root.path))
      if (!binding) continue
      const peers = [...this.repositories.values()].filter(
        (repo) => gitPathKey(repo.commonDir) === gitPathKey(binding.commonDir),
      )
      for (const peer of peers) {
        const current = await findGitRepository(peer.root)
        if (!current || gitPathKey(current.commonDir) !== gitPathKey(binding.commonDir)) continue
        roots.delete(key)
        roots.set(gitPathKey(binding.root), {
          path: binding.root,
          git: true,
          historyRoot: current.root,
        })
        break
      }
    }
    if (folders.length > 32) limited = true
    if (
      !session.git?.root &&
      roots.size > 1 &&
      !ledger.evidence().some((file) => file.paths.some((path) => within(primary, path)))
    )
      roots.delete(gitPathKey(primary))
    const files: ThreadDiffData['files'] = [],
      groups: ChangeRootGroup[] = []
    const revisions: string[] = [],
      reasons: CoverageReason[] = []
    let stale = false,
      hasOtherLensChanges: boolean | null = false
    for (const root of roots.values()) {
      const selected = {
        ...session,
        cwd: root.path,
        git: root.git && session.git ? { ...session.git, root: root.path } : null,
      }
      if (gitPathKey(root.path) !== gitPathKey(primary))
        await this.options.recordEvidence?.(selected, ledger).catch(() => {})
      const folder = root.git
        ? undefined
        : await this.options.folderComparison?.(selected).catch(() => null)
      const data =
        root.git || folder
          ? await this.uncommitted.project(
              ledger,
              root.path,
              this.options.now?.() ?? Date.now(),
              folder ?? undefined,
            )
          : null
      const rootId = digest(root.path)
      const lens = root.git ? ('git-current' as const) : ('folder-baseline' as const)
      const recorded = await this.reconciliation.read(
        ledger,
        root.path,
        root.git,
        this.options.now?.() ?? Date.now(),
        root.historyRoot,
      )
      // A missing historical match is ordinary for pending work, not a recovery failure.
      const currentPaths = new Set(data?.files.map((file) => file.file.path) ?? [])
      const reconciled = recorded.map((edit) =>
        edit.state === 'unresolved' && currentPaths.has(edit.path)
          ? {
              ...edit,
              state: 'current' as const,
              explanation:
                'Provider-recorded edits match pending changes in this checkout. Counts and diffs are shown in the current comparison.',
            }
          : edit,
      )
      const rootReasons =
        data?.summary.coverage?.reasons ??
        ([
          (await stat(root.path).catch(() => null))
            ? root.git
              ? 'git-read-failed'
              : 'baseline-incomplete'
            : 'root-unavailable',
        ] as CoverageReason[])
      groups.push({
        recorded: reconciled,
        recoveredFrom: root.historyRoot,
        reasons: rootReasons,
        rootId,
        root: root.path,
        lens,
        files: data?.summary.files ?? 0,
        added: data?.summary.added ?? 0,
        removed: data?.summary.removed ?? 0,
        complete: data?.summary.complete ?? false,
        available: !!data,
      })
      if (!data) {
        reasons.push(...rootReasons)
        continue
      }
      revisions.push(data.summary.revision)
      reasons.push(...(data.summary.coverage?.reasons ?? []))
      stale ||= !!data.summary.stale
      if (data.summary.hasOtherLensChanges) hasOtherLensChanges = true
      else if (data.summary.hasOtherLensChanges == null && !hasOtherLensChanges)
        hasOtherLensChanges = null
      files.push(
        ...data.files.map((file) => ({
          ...file,
          root: root.path,
          file: {
            ...file.file,
            displayPath: file.file.path,
            rootId,
            path: roots.size === 1 ? file.file.path : `${rootId}/${file.file.path}`,
          },
        })),
      )
    }
    if (!groups.some((group) => group.available || group.recorded?.length)) return null
    if (limited) reasons.push('inventory-limit')
    const complete = !limited && groups.every((group) => group.complete)
    const sameLens = groups.every((group) => group.lens === groups[0]!.lens)
    if (!sameLens) reasons.push('mixed-lenses')
    return {
      files,
      summary: {
        files: files.length,
        added: sameLens ? files.reduce((sum, file) => sum + file.file.added, 0) : 0,
        removed: sameLens ? files.reduce((sum, file) => sum + file.file.removed, 0) : 0,
        complete: complete && sameLens,
        lens: sameLens ? groups[0]!.lens : undefined,
        groups,
        mixedLenses: !sameLens,
        revision: digest(JSON.stringify([revisions, groups, reasons])),
        coverage: coverage(complete && sameLens ? [] : reasons, stale),
        stale,
        hasOtherLensChanges,
        evidenceScope: 'available-recorded-operations',
      },
    }
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
