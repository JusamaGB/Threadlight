/** What a session is doing right now. */
export type SessionState = 'working' | 'waiting' | 'idle'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanItem {
  content: string
  status: PlanStatus
}

/** A background shell command or agent a session started and has not heard back from yet. */
export interface BackgroundTask {
  /** The tool call that started it. */
  id: string
  label: string
  /** When it started, in milliseconds since the epoch. */
  startedAt: number
}

export interface CurrentStep {
  /** 1-based position in the plan. */
  index: number
  total: number
  content: string
}

/** A pull request the Claude app linked to a thread, shown as the branch icon in its sidebar. */
export interface PullRequest {
  number: number
  state: 'open' | 'draft' | 'merged' | 'closed'
}

/** One Claude Code session as Threadlight shows it. Plain data, safe to send over IPC. */
export interface Session {
  /** Claude Code session id (the transcript's file name). */
  id: string
  /** The Claude app's own thread id (`local_…`), used for "Open in Claude". */
  appId: string | null
  title: string
  state: SessionState
  /** True when the state came from a hook event; false when it was inferred. */
  tracked: boolean
  cwd: string
  /** Last activity, in milliseconds since the epoch. */
  lastActiveAt: number
  /** One line describing where the session is. */
  stage: string
  lastPrompt: string | null
  plan: PlanItem[]
  currentStep: CurrentStep | null
  /** The session's own summary of its last finished turn. */
  recap: string | null
  lastReply: string | null
  lastAction: string | null
  /** When the current turn began, for the Now line's timer (it runs until the turn ends). */
  turnStartedAt: number | null
  /** Running background tasks, oldest first. They can outlive the turn that started them. */
  backgroundTasks: BackgroundTask[]
  permissionMode: string | null
  model: string | null
  /** Oldest first, so the last one is the latest. */
  pullRequests: PullRequest[]
}

/** A thread in the workspace tree, with the side threads it started nested under it. */
export interface ThreadNode {
  session: Session
  children: ThreadNode[]
}

/** One workspace folder, as the Claude sidebar groups threads. */
export interface Workspace {
  /** The folder path; also the key for expanding it. */
  id: string
  name: string
  threadCount: number
  /** Threads working or waiting right now, shown as a dot on the collapsed header. */
  activeCount: number
  anyWorking: boolean
  /** Only filled in while the workspace is expanded; collapsed ones cost nothing to scan. */
  threads: ThreadNode[]
  /** Top-level threads not shown yet ("Show N more"). */
  hiddenCount: number
}

/** Which workspaces the UI has open. `expanded: null` means "just the current workspace". */
export interface TreeView {
  expanded: string[] | null
  showAll: string[]
}

/** Everything one scan produces. */
export interface Snapshot {
  /** Recent sessions, working first: the Active list and the counts. */
  sessions: Session[]
  workspaces: Workspace[]
  /**
   * Every workspace, ignoring the time window, for choosing one to focus on. (`workspaces` only
   * has those with threads inside the window.)
   */
  allWorkspaces: { id: string; name: string }[]
  /** The workspace of the thread last open in Claude. */
  currentWorkspace: string | null
}

/**
 * A message relayed to a session in the background.
 * sending → sent (✓, handed to the session) → replied (✓✓, the session answered), or failed.
 */
export type RelayState = 'sending' | 'sent' | 'replied' | 'failed'

export interface RelayStatus {
  sessionId: string
  state: RelayState
  /** The reply when replied, the reason when failed. */
  detail: string
  /** When the state last changed, in milliseconds since the epoch. */
  at: number
}
