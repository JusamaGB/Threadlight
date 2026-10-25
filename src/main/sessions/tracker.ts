// Merges the three sources (hook state, transcripts, Claude app records) into what the UI shows:
// a flat list of recent sessions, and the same threads grouped by workspace like the Claude
// sidebar. Transcripts are only read for threads that can be seen, so hundreds of collapsed
// threads cost almost nothing. Keeps one TranscriptReader per session between calls.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  Session,
  SessionState,
  Snapshot,
  ThreadNode,
  TreeView,
  Workspace,
} from '../../shared/types'
import { AppRecordIndex, type AppRecord } from './appRecords'
import type { HookRecord, HookStateStore } from './hookState'
import { oneLine } from './json'
import type { ClaudePaths } from './paths'
import { TranscriptReader, type TranscriptSummary } from './transcript'

/** "Working" with no heartbeat for this long means the session crashed or was killed. */
export const STALE_MS = 10 * 60 * 1000
/** For sessions without hook events: a transcript this fresh counts as working. */
export const FALLBACK_ACTIVE_MS = 30 * 1000
/** A background task still unheard of after this long is assumed gone with its thread. */
export const TASK_GIVE_UP_MS = 12 * 60 * 60 * 1000

export interface TrackerOptions {
  paths: ClaudePaths
  hooks: HookStateStore
  /** Only sessions active within this window are in the recent list. */
  windowHours?: number
  /** The recent list's length, and how many threads an expanded workspace shows at first. */
  maxSessions?: number
  now?: () => number
}

interface TranscriptFile {
  path: string
  mtimeMs: number
}

const ORDER: Record<SessionState, number> = { working: 0, waiting: 1, idle: 2 }
const DEFAULT_VIEW: TreeView = { expanded: null, showAll: [] }

export class Tracker {
  private readers = new Map<string, TranscriptReader>()
  private appRecords: AppRecordIndex
  private windowMs = 0
  private maxSessions = 0
  private readonly now: () => number

  constructor(private readonly options: TrackerOptions) {
    this.appRecords = new AppRecordIndex(options.paths.appSessionsDir)
    this.configure(options.windowHours ?? 24, options.maxSessions ?? 10)
    this.now = options.now ?? Date.now
  }

  /** Applies the list settings; takes effect on the next scan. */
  configure(windowHours: number, maxSessions: number): void {
    this.windowMs = windowHours * 60 * 60 * 1000
    this.maxSessions = maxSessions
  }

  async snapshot(view: TreeView = DEFAULT_VIEW): Promise<Snapshot> {
    const now = this.now()
    const [files, apps] = await Promise.all([this.findTranscripts(), this.appRecords.refresh()])
    const hooks = new Map(this.options.hooks.all(now).map((h) => [h.sessionId, h]))
    const built = new Map<string, Session>() // full sessions, built once per scan
    const build = async (id: string) => {
      let session = built.get(id)
      if (!session) {
        session = await this.build(id, files.get(id), hooks.get(id), apps.get(id), now)
        built.set(id, session)
      }
      return session
    }

    // The recent list: everything active within the window, working first.
    const cutoff = now - this.windowMs
    const recentIds = new Set(hooks.keys())
    for (const [id, file] of files) if (file.mtimeMs > cutoff) recentIds.add(id)
    const recent: Session[] = []
    for (const id of recentIds) {
      if (apps.get(id)?.archived) continue
      recent.push(await build(id))
    }
    recent.sort(byStateThenActivity)

    // The workspace tree: every thread the Claude app has, grouped like its sidebar.
    const records = [...apps.values()].filter((app) => !app.archived && app.workspace)

    // Like the Claude sidebar, a side thread sits under the thread that started it, even when it
    // works in another folder: it belongs to its top-most ancestor's workspace.
    const recordsByAppId = new Map(records.map((app) => [app.appId, app]))
    const homeOf = (app: AppRecord): string => {
      let home = app
      const seen = new Set([app.appId])
      for (;;) {
        const parent = home.parentAppId ? recordsByAppId.get(home.parentAppId) : undefined
        if (!parent || seen.has(parent.appId)) return home.workspace!
        seen.add(parent.appId)
        home = parent
      }
    }
    const focused = latestFocused(records)
    const currentWorkspace = focused ? homeOf(focused) : null
    const expanded = new Set(
      (view.expanded ?? (currentWorkspace ? [currentWorkspace] : [])).map(workspaceKey),
    )
    const showAll = new Set(view.showAll.map(workspaceKey))

    // "Show sessions from the last …" applies here too. A thread outside the window stays only
    // when a side thread under it is inside, so the nesting still reads right.
    const activity = (app: AppRecord) =>
      Math.max(
        app.lastActivityAt,
        files.get(app.cliSessionId)?.mtimeMs ?? 0,
        hooks.get(app.cliSessionId)?.updatedAt ?? 0,
      )
    const kids = new Map<string, AppRecord[]>()
    for (const app of records) {
      if (app.parentAppId) kids.set(app.parentAppId, [...(kids.get(app.parentAppId) ?? []), app])
    }
    const kept = new Map<string, boolean>()
    const keep = (app: AppRecord): boolean => {
      const known = kept.get(app.appId)
      if (known !== undefined) return known
      kept.set(app.appId, false) // guards against a loop in bad data
      const result = activity(app) > cutoff || (kids.get(app.appId) ?? []).some(keep)
      kept.set(app.appId, result)
      return result
    }

    const allWorkspaces = new Map<string, { id: string; name: string }>()
    for (const app of records) {
      const home = homeOf(app)
      const key = workspaceKey(home)
      if (!allWorkspaces.has(key))
        allWorkspaces.set(key, { id: home, name: lastPathPart(home) ?? home })
    }

    const groups = new Map<string, AppRecord[]>()
    for (const app of records.filter(keep)) {
      const key = workspaceKey(homeOf(app))
      groups.set(key, [...(groups.get(key) ?? []), app])
    }

    const workspaces: Workspace[] = []
    for (const [key, members] of groups) {
      const path = homeOf(members[0]!)
      const states = members.map((app) =>
        lightState(hooks.get(app.cliSessionId), files.get(app.cliSessionId), now),
      )
      const workspace: Workspace = {
        id: path,
        name: lastPathPart(path) ?? path,
        threadCount: members.length,
        activeCount: states.filter((s) => s !== 'idle').length,
        anyWorking: states.includes('working'),
        threads: [],
        hiddenCount: 0,
      }
      if (expanded.has(key)) {
        // Side threads nest under the thread that started them, when it is in the same workspace.
        const byAppId = new Map(members.map((app) => [app.appId, app]))
        const childrenOf = new Map<string, AppRecord[]>()
        const roots: AppRecord[] = []
        for (const app of members) {
          if (app.parentAppId && byAppId.has(app.parentAppId) && app.parentAppId !== app.appId) {
            childrenOf.set(app.parentAppId, [...(childrenOf.get(app.parentAppId) ?? []), app])
          } else {
            roots.push(app)
          }
        }
        roots.sort((a, b) => activity(b) - activity(a))
        const shown = showAll.has(key) ? roots : roots.slice(0, this.maxSessions)
        workspace.hiddenCount = roots.length - shown.length
        const seen = new Set<string>()
        const node = async (app: AppRecord): Promise<ThreadNode> => {
          seen.add(app.appId)
          const kids = (childrenOf.get(app.appId) ?? [])
            .filter((kid) => !seen.has(kid.appId)) // guards against a loop in bad data
            .sort((a, b) => activity(b) - activity(a))
          return {
            session: await build(app.cliSessionId),
            children: await Promise.all(kids.map(node)),
          }
        }
        for (const app of shown) workspace.threads.push(await node(app))
      }
      workspaces.push(workspace)
    }
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    workspaces.sort(byName)

    return {
      sessions: recent.slice(0, this.maxSessions),
      workspaces,
      allWorkspaces: [...allWorkspaces.values()].sort(byName),
      currentWorkspace,
    }
  }

  private async build(
    id: string,
    file: TranscriptFile | undefined,
    hook: HookRecord | undefined,
    app: AppRecord | undefined,
    now: number,
  ): Promise<Session> {
    const path = file?.path ?? hook?.transcriptPath
    const summary = path ? await this.read(id, path) : null
    const lastActiveAt = Math.max(
      file?.mtimeMs ?? 0,
      hook?.updatedAt ?? 0,
      app?.lastActivityAt ?? 0,
    )
    const state = resolveState({
      hookState: hook?.state ?? null,
      lastActiveAt: Math.max(file?.mtimeMs ?? 0, hook?.updatedAt ?? 0),
      transcriptChangedAt: file?.mtimeMs ?? 0,
      interrupted: summary?.interrupted ?? false,
      now,
    })
    const cwd = hook?.cwd ?? app?.cwd ?? summary?.cwd ?? ''
    return {
      id,
      appId: app?.appId ?? null,
      title: oneLine(app?.title ?? summary?.title ?? lastPathPart(cwd) ?? id.slice(0, 8)),
      state,
      tracked: hook !== undefined,
      cwd,
      lastActiveAt,
      stage: stageLine(state, summary),
      lastPrompt: summary?.lastPrompt ?? null,
      plan: summary?.plan ?? [],
      currentStep: summary?.currentStep ?? null,
      recap: summary?.recap ?? null,
      lastReply: summary?.lastReply ?? null,
      lastAction: summary?.lastAction ?? null,
      // A task whose thread was closed never reports back; past a while, stop counting it.
      backgroundTasks: (summary?.backgroundTasks ?? []).filter(
        (task) => now - task.startedAt < TASK_GIVE_UP_MS,
      ),
      permissionMode: app?.permissionMode ?? null,
      model: app?.model ?? null,
      pullRequests: app?.pullRequests ?? [],
    }
  }

  private async read(id: string, path: string): Promise<TranscriptSummary> {
    let reader = this.readers.get(id)
    if (!reader || reader.path !== path) {
      reader = new TranscriptReader(path)
      this.readers.set(id, reader)
    }
    await reader.update()
    return reader.summary()
  }

  /** Every `<projectsDir>/<project>/<sessionId>.jsonl`, with when it last changed. */
  private async findTranscripts(): Promise<Map<string, TranscriptFile>> {
    const found = new Map<string, TranscriptFile>()
    let projects: string[]
    try {
      const entries = await readdir(this.options.paths.projectsDir, { withFileTypes: true })
      projects = entries
        .filter((e) => e.isDirectory())
        .map((e) => join(this.options.paths.projectsDir, e.name))
    } catch {
      return found
    }
    for (const project of projects) {
      let entries
      try {
        entries = await readdir(project, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        const path = join(project, entry.name)
        try {
          const { mtimeMs } = await stat(path)
          found.set(entry.name.slice(0, -'.jsonl'.length), { path, mtimeMs })
        } catch {
          // deleted between listing and stat
        }
      }
    }
    return found
  }
}

function byStateThenActivity(a: Session, b: Session): number {
  return ORDER[a.state] - ORDER[b.state] || b.lastActiveAt - a.lastActiveAt
}

/** State without reading the transcript, for collapsed workspaces' header dots. */
function lightState(
  hook: HookRecord | undefined,
  file: TranscriptFile | undefined,
  now: number,
): SessionState {
  return resolveState({
    hookState: hook?.state ?? null,
    lastActiveAt: Math.max(file?.mtimeMs ?? 0, hook?.updatedAt ?? 0),
    transcriptChangedAt: file?.mtimeMs ?? 0,
    interrupted: false,
    now,
  })
}

/** The thread most recently in front of the user. */
function latestFocused(records: AppRecord[]): AppRecord | null {
  let best: AppRecord | null = null
  for (const app of records) if (!best || app.lastFocusedAt > best.lastFocusedAt) best = app
  return best
}

/** Windows paths are case-insensitive, and may or may not end with a separator. */
export function workspaceKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase()
}

export interface StateInputs {
  hookState: SessionState | null
  lastActiveAt: number
  transcriptChangedAt: number
  interrupted: boolean
  now: number
}

/** The rules for what state a session is in. Pure, so it is easy to test. */
export function resolveState(input: StateInputs): SessionState {
  // Stop has no hook event; the transcript's interrupt marker is the only signal.
  if (input.interrupted) return 'idle'
  if (input.hookState !== null) {
    const active = input.hookState !== 'idle'
    return active && input.now - input.lastActiveAt > STALE_MS ? 'idle' : input.hookState
  }
  return input.now - input.transcriptChangedAt < FALLBACK_ACTIVE_MS ? 'working' : 'idle'
}

/** One line for the row: the current step while working, the result once done. */
export function stageLine(state: SessionState, summary: TranscriptSummary | null): string {
  if (!summary) return state === 'working' ? 'Working' : 'Idle'
  if (state === 'idle') return oneLine(summary.recap ?? summary.lastReply) || 'Idle'
  const prefix = state === 'waiting' ? 'Needs approval · ' : ''
  const step = summary.currentStep
  if (step) return `${prefix}${step.index}/${step.total} · ${step.content}`
  return prefix + (summary.lastAction ?? 'Working')
}

function lastPathPart(path: string): string | null {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? null
}
