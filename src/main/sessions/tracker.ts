// Merges the three sources (hook state, transcripts, Claude app records) into what the UI shows:
// a flat list of recent sessions, and the same threads grouped by workspace like the Claude
// sidebar. Transcripts are only read for threads that can be seen, so hundreds of collapsed
// threads cost almost nothing. Keeps one TranscriptReader per session between calls.

import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  Attention,
  GitState,
  Session,
  SessionState,
  Snapshot,
  ThreadNode,
  TreeView,
  Workspace,
} from '../../shared/types'
import { AppRecordIndex, type AppRecord } from './appRecords'
import type { HeldCard } from '../holds'
import type { HookRecord, HookStateStore } from './hookState'
import { oneLine } from './json'
import { FILE_LANES, mapLimit } from './parallel'
import { liveSessionIds } from './liveSessions'
import type { ClaudePaths } from './paths'
import { TranscriptReader, type TranscriptSummary } from './transcript'
import { CompletionOrder } from './completionOrder'
import { compareSessionOrder, recentSessions } from '../../shared/sessionOrder'

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
  /** Threads working in this folder stay out of the lists (the agent's own, unless shown). */
  hiddenFolder?: () => string | null
  /** Where a folder's repository stands (gitDiff.ts); counted in the background. */
  gitFor?: (folder: string) => GitState | null
  /** A card Threadlight is holding for the user to answer here (holds.ts). */
  held?: (sessionId: string) => HeldPart | null
  /** Which threads keep their place in the recent list however old (default: any not idle). */
  pinned?: (session: Session) => boolean
  /**
   * The most threads one scan builds for the workspace tree. Turning the time window off must not
   * mean building every thread there has ever been; a workspace beyond this stays closed until
   * "Show more" is chosen for it.
   */
  treeBudget?: number
  /**
   * How many transcripts a scan may read for the first time, and for how long it keeps starting
   * new ones. A first read parses the whole file, so a long history read in one go would hold
   * every row back; the newest are read first and the rest follow on the next scans.
   */
  coldBuilds?: number
  coldMs?: number
}

/** Plenty for the Workspace list, and what a scan can build in well under a second. */
const DEFAULT_TREE_BUDGET = 300
/** Up to this many workspaces shown in full are exempt from the budget. */
const FULL_WORKSPACES = 8
const DEFAULT_COLD_BUILDS = 25
const DEFAULT_COLD_MS = 500
/** The recent list is cut to a few dozen, so only the newest transcripts are ever read for it. */
const RECENT_CANDIDATES = 120

interface TranscriptFile {
  path: string
  mtimeMs: number
}

const DEFAULT_VIEW: TreeView = { expanded: null, showAll: [] }

export class Tracker {
  private completionOrder = new CompletionOrder()
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
    const [files, apps, live] = await Promise.all([
      this.findTranscripts(),
      this.appRecords.refresh(),
      liveSessionIds(this.options.paths.liveSessionsDir),
    ])
    const hooks = new Map(this.options.hooks.all(now).map((h) => [h.sessionId, h]))
    const built = new Map<string, Session>() // full sessions, built once per scan
    // A thread whose transcript has never been read is dear to build, so those are rationed per
    // scan. Everything already read (or without a transcript) costs next to nothing.
    const started = performance.now()
    let cold = 0
    const affordable = (id: string): boolean => {
      if (built.has(id) || this.readers.has(id)) return true
      if (!(files.get(id)?.path ?? hooks.get(id)?.transcriptPath)) return true
      if (
        cold >= (this.options.coldBuilds ?? DEFAULT_COLD_BUILDS) ||
        performance.now() - started > (this.options.coldMs ?? DEFAULT_COLD_MS)
      )
        return false
      cold += 1
      return true
    }
    const build = async (id: string) => {
      let session = built.get(id)
      if (!session) {
        session = await this.build(id, files.get(id), hooks.get(id), apps.get(id), live, now)
        built.set(id, session)
      }
      return session
    }

    // Time-window membership follows live activity; order follows task completion.
    const cutoff = now - this.windowMs
    const recentIds = new Set(hooks.keys())
    const newest = [...files]
      .filter(([, file]) => file.mtimeMs > cutoff)
      .sort(([, a], [, b]) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(RECENT_CANDIDATES, this.maxSessions * 3))
    for (const [id] of newest) recentIds.add(id)
    const recent: Session[] = []
    const hidden = this.options.hiddenFolder?.()?.toLowerCase() ?? null
    for (const id of recentIds) {
      if (apps.get(id)?.archived) continue
      // Threads Threadlight is tracking live are always shown; the rest wait their turn.
      if (!hooks.has(id) && !affordable(id)) continue
      const session = await build(id)
      if (hidden && session.cwd.toLowerCase() === hidden) continue
      recent.push(session)
    }
    recent.sort(compareSessionOrder)

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
    const every = view.everything === true
    const isExpanded = (key: string) => every || expanded.has(key)

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
    // The most recently active workspaces are built first, so a budget runs out on the oldest.
    let budget = this.options.treeBudget ?? DEFAULT_TREE_BUDGET
    const newestFirst = [...groups].sort(
      ([, a], [, b]) => Math.max(...b.map(activity)) - Math.max(...a.map(activity)),
    )
    for (const [key, members] of newestFirst) {
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
        worktrees: 0,
      }
      // One workspace asked for in full is never cut; a list of everything (All drives) shares
      // the budget, newest workspaces first.
      const inFull = !every && showAll.has(key) && showAll.size <= FULL_WORKSPACES
      if (isExpanded(key) && (budget > 0 || inFull)) {
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
        const orderedAt = (app: AppRecord) =>
          this.completionOrder.time(app.cliSessionId, activity(app))
        roots.sort((a, b) => orderedAt(b) - orderedAt(a) || a.appId.localeCompare(b.appId))
        const shown = inFull
          ? roots
          : roots.slice(0, every || showAll.has(key) ? budget : this.maxSessions)
        workspace.hiddenCount = roots.length - shown.length
        budget -= shown.length
        const seen = new Set<string>()
        const node = async (app: AppRecord): Promise<ThreadNode> => {
          seen.add(app.appId)
          const kids = (childrenOf.get(app.appId) ?? [])
            .filter((kid) => !seen.has(kid.appId)) // guards against a loop in bad data
            .sort((a, b) => orderedAt(b) - orderedAt(a) || a.appId.localeCompare(b.appId))
            .filter((kid) => affordable(kid.cliSessionId))
          return {
            session: await build(app.cliSessionId),
            children: await Promise.all(kids.map(node)),
          }
        }
        for (const app of shown) {
          if (affordable(app.cliSessionId)) workspace.threads.push(await node(app))
        }
        workspace.worktrees = countWorktrees(workspace.threads)
      } else if (isExpanded(key)) {
        // Over budget: listed, but its threads load only when asked for.
        workspace.hiddenCount = members.filter((app) => !app.parentAppId).length
      }
      workspaces.push(workspace)
    }
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    workspaces.sort(byName)

    return {
      sessions: recentSessions(recent, this.maxSessions, this.options.pinned),
      workspaces,
      allWorkspaces: [...allWorkspaces.values()].sort(byName),
      currentWorkspace,
      currentThreadId: focused?.cliSessionId ?? null,
    }
  }

  private async build(
    id: string,
    file: TranscriptFile | undefined,
    hook: HookRecord | undefined,
    app: AppRecord | undefined,
    live: Set<string>,
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
    return this.completionOrder.observe(
      {
        id,
        appId: app?.appId ?? null,
        title: oneLine(app?.title ?? summary?.title ?? lastPathPart(cwd) ?? id.slice(0, 8)),
        state,
        tracked: hook !== undefined,
        cwd,
        lastActiveAt,
        focusedAt: app?.lastFocusedAt ?? 0,
        stage: stageLine(state, summary),
        thinking: isThinking(state, summary),
        lastPrompt: summary?.lastPrompt ?? null,
        plan: summary?.plan ?? [],
        currentStep: summary?.currentStep ?? null,
        recap: summary?.recap ?? null,
        lastReply: summary?.lastReply ?? null,
        lastAction: summary?.lastAction ?? null,
        // The Claude app's own turn timer when it tracks the thread; else the prompt's time.
        turnStartedAt: app?.lastTurnEdgeAt || summary?.turnStartedAt || null,
        // A task whose thread was closed never reports back; past a while, stop counting it.
        // A foreground command counts only while its thread works: one whose result never came
        // (the thread stopped) is not still running.
        backgroundTasks: (summary?.backgroundTasks ?? []).filter(
          (task) =>
            now - task.startedAt < TASK_GIVE_UP_MS && (!task.foreground || state === 'working'),
        ),
        git: this.options.gitFor?.(gitFolder(app, summary, cwd)) ?? null,
        gitFolders: [gitFolder(app, summary, cwd)],
        live: live.has(id),
        contextUsed: contextUsed(summary, app?.model ?? null),
        attention: attentionFor(state, summary, this.options.held?.(id) ?? null),
        permissionMode: app?.permissionMode ?? null,
        model: app?.model ?? null,
        pullRequests: app?.pullRequests ?? [],
      },
      hook?.completedAt,
    )
  }

  /** The transcript a session was last read from, if any. */
  transcriptPath(id: string): string | null {
    return this.readers.get(id)?.path ?? null
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
    const lists = await mapLimit(projects, FILE_LANES, async (project) => {
      try {
        const entries = await readdir(project, { withFileTypes: true })
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
          .map((entry) => ({ name: entry.name, path: join(project, entry.name) }))
      } catch {
        return []
      }
    })
    const stats = await mapLimit(lists.flat(), FILE_LANES, async ({ name, path }) => {
      try {
        return { name, path, mtimeMs: (await stat(path)).mtimeMs }
      } catch {
        return null // deleted between listing and stat
      }
    })
    for (const file of stats) {
      if (file)
        found.set(file.name.slice(0, -'.jsonl'.length), { path: file.path, mtimeMs: file.mtimeMs })
    }
    return found
  }
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

/**
 * Context windows, in tokens. Measured against the Claude app's own Context %: current models
 * have a 1M window (threads compact at about 96.6%); older Claude 3 and Haiku 4 models 200k.
 */
const CONTEXT_WINDOW = 1_000_000
const SMALL_WINDOW = 200_000
const SMALL_WINDOW_MODELS = /^claude-(3|haiku-4)/

export function contextUsed(
  summary: TranscriptSummary | null,
  appModel: string | null,
): number | null {
  if (!summary?.contextTokens) return null
  const model = summary.model ?? appModel ?? ''
  const window = SMALL_WINDOW_MODELS.test(model) ? SMALL_WINDOW : CONTEXT_WINDOW
  return Math.min(1, summary.contextTokens / window)
}

/**
 * The folder whose git state a thread shows: the worktree the Claude app made for it; else the
 * folder of the last file it read or changed (a thread working in a parent of several
 * repositories really works in one of them); else its working folder.
 */
export function gitFolder(
  app: AppRecord | undefined,
  summary: TranscriptSummary | null,
  cwd: string,
): string {
  if (app?.worktreePath) return app.worktreePath
  if (summary?.lastTouchedPath) return dirname(summary.lastTouchedPath)
  return cwd
}

/** Worktrees across every repository a workspace's listed threads work in. */
function countWorktrees(nodes: ThreadNode[]): number {
  const seen = new Set<string>()
  const walk = (list: ThreadNode[]) => {
    for (const node of list) {
      for (const path of node.session.git?.worktrees ?? []) seen.add(path.toLowerCase())
      walk(node.children)
    }
  }
  walk(nodes)
  return seen.size
}

/** What the tracker needs of a held card (holds.ts). */
export type HeldPart = Pick<HeldCard, 'kind' | 'releasesAt'> & Partial<HeldCard>

/**
 * Whether the thread is waiting on the user, and with which card. A card Threadlight holds for
 * a tool's approval or a session offer comes first, since Claude shows nothing while it is held;
 * then a question it asked mid-turn, a tool waiting for approval in Claude, and the question its
 * last turn ended on.
 */
export function attentionFor(
  state: SessionState,
  summary: TranscriptSummary | null,
  held: HeldPart | null = null,
): Attention | null {
  const until = (kind: HeldCard['kind']) => (held?.kind === kind ? held.releasesAt : null)
  if (held?.kind === 'offer' && held.detail) {
    return { kind: 'offer', title: held.detail, answerableUntil: held.releasesAt, holdId: held.id }
  }
  if (held?.kind === 'approval') {
    return {
      kind: 'approval',
      action: held.detail ?? summary?.lastAction ?? null,
      tool: held.tool ?? null,
      answerableUntil: held.releasesAt,
      holdId: held.id,
    }
  }
  if (!summary || summary.interrupted) return null
  if (summary.pendingQuestion) {
    return {
      kind: 'question',
      questions: summary.pendingQuestion,
      answerableUntil: until('question'),
      holdId: held?.kind === 'question' ? held.id : undefined,
    }
  }
  if (state === 'waiting') {
    return { kind: 'approval', action: summary.lastAction, tool: null, answerableUntil: null }
  }
  if (state === 'idle' && summary.nextStep) {
    return {
      kind: 'next-step',
      ...summary.nextStep,
      answerableUntil: until('next-step'),
      holdId: held?.kind === 'next-step' ? held.id : undefined,
    }
  }
  return null
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

/** Working with nothing to show yet but thought: the row shows Thinking, turning. */
export function isThinking(state: SessionState, summary: TranscriptSummary | null): boolean {
  return state === 'working' && !summary?.currentStep && summary?.activity === 'thinking'
}

/**
 * One line for the row: the current step while working (or what it is saying, or Thinking,
 * for a turn with no plan), the result once done.
 */
export function stageLine(state: SessionState, summary: TranscriptSummary | null): string {
  if (!summary) return state === 'working' ? 'Working' : 'Idle'
  if (state === 'idle') return oneLine(summary.recap ?? summary.lastReply) || 'Idle'
  const prefix = state === 'waiting' ? 'Needs approval · ' : ''
  const step = summary.currentStep
  if (step) return `${prefix}${step.index}/${step.total} · ${step.content}`
  if (state === 'working' && summary.activity === 'thinking') return 'Thinking'
  if (state === 'working' && summary.activity === 'replying' && summary.lastReply) {
    return oneLine(summary.lastReply)
  }
  return prefix + (summary.lastAction ?? 'Working')
}

function lastPathPart(path: string): string | null {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? null
}
