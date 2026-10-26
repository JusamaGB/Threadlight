import { watch, type FSWatcher } from 'node:fs'
import type { GitState, Session, Snapshot, ThreadNode } from '../../shared/types'
import { readGitState } from './gitDiff'
import { findGitRepository, gitPathKey, type GitRepository } from './gitRepository'
import { WorkQueue } from './gitProcess'

type Entry = {
  repository: GitRepository
  state: GitState | null
  checked: number
  version: number
  running: boolean
  task?: Promise<void>
  touched: number
  watchers: FSWatcher[]
  debounce?: NodeJS.Timeout
}
type Folder = { repository: GitRepository | null; checked: number; running?: Promise<void> }

/** Only displayed chats demand work. Folders resolve to one shared entry per actual worktree. */
export class GitStates {
  private folders = new Map<string, Folder>()
  private roots = new Map<string, Entry>()
  private listed: Session[] = []
  private discoveries = new WorkQueue(4)
  private closed = false
  constructor(
    private readonly changed: (root?: string, invalidated?: boolean) => void,
    private readonly now = Date.now,
    private readonly count = readGitState,
    private readonly locate = findGitRepository,
  ) {}

  /** Trackers can use already-known metadata without scheduling hidden chats. */
  peek(folder: string): GitState | null {
    const repository = folder && this.folders.get(gitPathKey(folder))?.repository
    return repository ? (this.roots.get(gitPathKey(repository.root))?.state ?? null) : null
  }

  get(folder: string): GitState | null {
    if (!folder || this.closed) return null
    const key = gitPathKey(folder)
    let found = this.folders.get(key)
    if (!found) {
      found = { repository: null, checked: -Infinity }
      this.folders.set(key, found)
    }
    // Periodically rediscover aliases too: nested repos and worktrees can be created/removed.
    if (!found.running && this.now() - found.checked >= 30_000) {
      const target = found
      target.running = this.discoveries
        .run(async () => {
          target.repository = await this.locate(folder).catch(() => null)
          target.checked = this.now()
          if (this.closed) return
          if (target.repository) this.demand(target.repository)
        })
        .finally(() => {
          target.running = undefined
          if (!this.closed) this.changed()
        })
    }
    if (found.repository) this.demand(found.repository)
    return this.peek(folder)
  }

  private demand(repository: GitRepository) {
    const key = gitPathKey(repository.root)
    let entry = this.roots.get(key)
    if (!entry) {
      entry = {
        repository,
        state: null,
        checked: -Infinity,
        version: 0,
        running: false,
        touched: this.now(),
        watchers: [],
      }
      this.roots.set(key, entry)
      this.watch(entry)
    }
    entry.touched = this.now()
    if (!entry.running && this.now() - entry.checked >= 5000) this.refresh(entry)
  }

  private refresh(entry: Entry) {
    entry.running = true
    const version = entry.version
    const publish = (state: GitState) => {
      if (this.closed || entry.version !== version) return
      // Keep a previously verified count until its replacement arrives.
      if (state.pending && entry.state && entry.state.branch === state.branch) return
      if (JSON.stringify(entry.state) !== JSON.stringify(state)) {
        entry.state = state
        this.changed(entry.repository.root)
      }
    }
    entry.task = this.count(entry.repository.root, publish)
      .then((state) => {
        if (state) publish(state)
      })
      .catch(() => {
        /* Keep the last observation; a failed scan is not a clean worktree. */
      })
      .finally(() => {
        entry.running = false
        entry.checked = version === entry.version ? this.now() : -Infinity
        if (!entry.state && !this.closed) this.changed(entry.repository.root)
        if (!this.closed && version !== entry.version && this.now() - entry.touched < 30_000)
          this.refresh(entry)
      })
  }

  invalidate(root?: string) {
    if (this.closed) return
    for (const entry of this.roots.values()) {
      if (root && gitPathKey(root) !== gitPathKey(entry.repository.root)) continue
      if (entry.debounce) continue
      entry.debounce = setTimeout(() => {
        entry.debounce = undefined
        entry.version++
        entry.checked = -Infinity
        this.changed(entry.repository.root, true)
        if (!entry.running && this.now() - entry.touched < 30_000) this.refresh(entry)
      }, 100)
      entry.debounce.unref()
    }
  }

  private watch(entry: Entry) {
    const { root, gitDir, commonDir } = entry.repository
    const add = (path: string, metadata: boolean) => {
      try {
        const watcher = watch(path, { recursive: true, persistent: false }, (_event, name) => {
          const file = String(name ?? '').replace(/\\/g, '/')
          if (
            metadata
              ? !/^(HEAD|index|packed-refs|commondir|refs\/)/.test(file)
              : /(^|\/)(\.git|node_modules|\.cache)(\/|$)/.test(file)
          )
            return
          if (file.endsWith('.lock')) return
          this.invalidate(root)
        })
        watcher.on('error', () => watcher.close()) // Polling remains the fallback.
        entry.watchers.push(watcher)
      } catch {
        /* Filesystem may not support recursive watches. */
      }
    }
    add(root, false)
    add(gitDir, true)
    if (gitPathKey(commonDir) !== gitPathKey(gitDir)) add(commonDir, true)
  }

  refreshListed() {
    if (this.closed) return
    for (const session of this.listed) this.forSession(session)
    for (const [key, entry] of this.roots)
      if (!entry.running && this.now() - entry.touched > 30_000) {
        entry.watchers.forEach((watcher) => watcher.close())
        clearTimeout(entry.debounce)
        this.roots.delete(key)
      }
    if (this.folders.size > 512)
      for (const [key, folder] of this.folders) {
        if (!folder.running && this.now() - folder.checked > 30_000) this.folders.delete(key)
      }
  }

  private forSession(session: Session): Session {
    const folders = session.gitFolders ?? [session.git?.root || session.cwd]
    let pending = false
    for (const folder of folders) {
      if (!folder) continue
      const state = this.get(folder)
      const found = this.folders.get(gitPathKey(folder))!
      if (state) return { ...session, git: state, gitStatus: 'ready' }
      // Resolve candidates in precedence order, rather than scanning every fallback at startup.
      if (found.running || found.repository) {
        pending =
          !!found.running ||
          !!(found.repository && this.roots.get(gitPathKey(found.repository.root))?.running)
        break
      }
    }
    return { ...session, git: null, gitStatus: pending ? 'loading' : 'unavailable' }
  }

  annotate(snapshot: Snapshot): Snapshot {
    const seen = new Map<string, Session>()
    const attach = (session: Session) => {
      if (!seen.has(session.id)) seen.set(session.id, this.forSession(session))
      return seen.get(session.id)!
    }
    const node = (item: ThreadNode): ThreadNode => ({
      session: attach(item.session),
      children: item.children.map(node),
    })
    const sessions = snapshot.sessions.map(attach)
    const workspaces = snapshot.workspaces.map((workspace) => {
      const threads = workspace.threads.map(node)
      const worktrees = new Set<string>()
      const visit = (items: ThreadNode[]) =>
        items.forEach((item) => {
          item.session.git?.worktrees.forEach((path) => worktrees.add(gitPathKey(path)))
          visit(item.children)
        })
      visit(threads)
      return { ...workspace, threads, worktrees: worktrees.size }
    })
    this.listed = [...seen.values()]
    return {
      ...snapshot,
      sessions,
      workspaces,
      lookupSessions: snapshot.lookupSessions?.map((session) => seen.get(session.id) ?? session),
    }
  }

  async close() {
    this.closed = true
    for (const entry of this.roots.values()) {
      entry.watchers.forEach((watcher) => watcher.close())
      clearTimeout(entry.debounce)
    }
    await Promise.allSettled([...this.roots.values()].map((entry) => entry.task))
    await Promise.allSettled([...this.folders.values()].map((folder) => folder.running))
  }
}
