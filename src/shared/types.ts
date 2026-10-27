/** What a session is doing right now. */
export type SessionState = 'working' | 'waiting' | 'idle'
export type Provider = 'claude' | 'codex'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanItem {
  content: string
  status: PlanStatus
  /** The files the thread says the step will create or change, when it says (PLAN_CONTEXT). */
  files?: string[]
  /** What the step does and why, in a sentence, when the thread says. */
  why?: string
}

/** What a thread did while one of its plan steps was in progress, read from its transcript. */
export interface StepActivity {
  /** When the step was started and finished; null if it never was (or is still going). */
  startedAt: number | null
  endedAt: number | null
  /** Files it edited or wrote, with lines added and removed (approximate, from the edits). */
  files: { path: string; added: number; removed: number }[]
  /** Shell commands, in order; `failed` is null while one has no result yet. */
  commands: { label: string; command: string; failed: boolean | null }[]
  /** Every other tool it used, by name, with how often. */
  tools: { name: string; count: number }[]
  /** What it said to the user while on the step, in order. */
  said: string[]
}

/** A background shell command or agent a session started and has not heard back from yet. */
export interface BackgroundTask {
  /** The tool call that started it. */
  id: string
  label: string
  /** When it started, in milliseconds since the epoch. */
  startedAt: number
  /**
   * A command still running in the foreground (the Claude app lists these with its background
   * tasks too). It ends with its result, so it only counts while the thread is working.
   */
  foreground?: true
}

/** One question from a question card (Claude's AskUserQuestion). */
export interface CardQuestion {
  /** A short chip, e.g. "Auth method". */
  header: string
  question: string
  /** Several options may be picked. */
  multiSelect: boolean
  /** The recommended option, when there is one, comes first. */
  options: { label: string; description: string; recommended: boolean }[]
}

/** A button in a next-step box: sends `message`, or is one of the app's own actions. */
export interface NextStepAction {
  label: string
  /** What clicking it sends to the thread; null for an app action (commit, open a PR…). */
  message: string | null
  /** The app action's name (commit, create_pr…), or null for a reply. */
  appAction: string | null
}

/**
 * Why a thread is waiting on the user, with what its card shows. A question card pauses the
 * turn until it is answered in Claude; a next-step box comes after the turn has ended.
 */
export type Attention =
  | {
      kind: 'question'
      holdId?: string
      questions: CardQuestion[]
      /**
       * Set while Threadlight holds the card so it can be answered here: when the hold ends and
       * the Claude app shows its own card instead. Null means answer it in Claude.
       */
      answerableUntil: number | null
    }
  | {
      kind: 'approval'
      action: string | null
      /** The tool asking (Bash, ExitPlanMode…), known while Threadlight holds it. */
      tool: string | null
      /** Set while Threadlight holds the approval so it can be allowed or denied here. */
      answerableUntil: number | null
      /** A Codex approval's hold, answered through Codex's own route (codex/holds.ts). */
      holdId?: string
    }
  | {
      /** A New session / Do it here offer, only ever seen while Threadlight holds it. */
      kind: 'offer'
      holdId?: string
      title: string
      answerableUntil: number
    }
  | {
      kind: 'next-step'
      recap: string | null
      ask: string
      actions: NextStepAction[]
      /** Set while Threadlight holds the turn's end so it can be answered here; as above. */
      answerableUntil: number | null
      holdId?: string
    }

export interface CurrentStep {
  /** 1-based position in the plan. */
  index: number
  total: number
  content: string
}

/** Line additions and removals within the stated repository or thread scope. */
export interface DiffStat {
  added: number
  removed: number
}

/** Where a thread's git folder stands (see gitDiff.ts). */
export interface GitState extends DiffStat {
  /** Root/branch are ready; repository counts have not completed yet. */
  pending?: boolean
  /** The repository's top folder. */
  root: string
  /** Files changed since the last commit, and of those, new files git does not track yet. */
  files: number
  newFiles: number
  /** Null when no branch is checked out. */
  branch: string | null
  /** Commits waiting to be pushed: ahead of its upstream, or of main if never pushed. */
  ahead: number
  /** Commits on the local main branch that this branch does not have yet. */
  behind: number
  /** Every worktree of its repository, the main checkout first. */
  worktrees: string[]
}

/** One file in the Changes view. */
export interface ChangedFile {
  /** Relative to the repository's top folder, with forward slashes. */
  path: string
  status: 'added' | 'modified' | 'deleted'
  added: number
  removed: number
  binary: boolean
}

/** One line of a drawn diff: a hunk's separator, or a context, added or removed line. */
export interface DiffLine {
  type: 'hunk' | 'context' | 'add' | 'remove'
  text: string
  oldLine?: number
  newLine?: number
}

/** A file's diff, or why it is not drawn. */
export type FileDiff =
  | { kind: 'text'; lines: DiffLine[] }
  | { kind: 'binary' }
  | { kind: 'too-big'; lines: number }
  | { kind: 'unavailable' }

/** What the Changes view lists for a thread. */
export interface Changes {
  branch: string | null
  files: ChangedFile[]
  /** False when recorded ownership cannot cover all potentially relevant pending edits. */
  complete?: boolean
}

/** Uncommitted Git changes attributable to this chat's recorded edits. */
export interface ThreadDiffSummary extends DiffStat {
  files: number
  revision: string
  complete: boolean
}

/** A linked pull request; Codex attachments do not expose its current remote state. */
export interface PullRequest {
  number: number
  state: 'open' | 'draft' | 'merged' | 'closed' | 'unknown'
}

/** One Claude Code session as Threadlight shows it. Plain data, safe to send over IPC. */
export interface Session {
  /** Absent on existing Claude records for backwards compatibility. */
  provider?: Provider
  /** Claude Code session id (the transcript's file name). */
  id: string
  /** The Claude app's own thread id (`local_…`), used for "Open in Claude". */
  appId: string | null
  title: string
  state: SessionState
  /** State verified by a hook or Codex turn status (plus a live writer for active turns). */
  tracked: boolean
  cwd: string
  /** Last activity, in milliseconds since the epoch. */
  lastActiveAt: number
  /** Position timestamp: held during work and advanced when a task finishes. */
  orderAt?: number
  /** When the Claude app last had this thread in front; 0 when unknown. */
  focusedAt: number
  /** One line describing where the session is. */
  stage: string
  /** The line is the Thinking placeholder: drawn turning, as the agent's progress line is. */
  thinking: boolean
  lastPrompt: string | null
  plan: PlanItem[]
  /** Codex's proposed plan in plan mode, separate from explicitly tracked step progress. */
  planText?: string | null
  currentStep: CurrentStep | null
  /** The session's own summary of its last finished turn. */
  recap: string | null
  lastReply: string | null
  lastAction: string | null
  /** When the current turn began, for the Now line's timer (it runs until the turn ends). */
  turnStartedAt: number | null
  /** Running background tasks, oldest first. They can outlive the turn that started them. */
  backgroundTasks: BackgroundTask[]
  /** A Claude Code process has it open now (the Claude app, or a terminal): no background sends. */
  live: boolean
  /** Its git folder's state; null outside git, or before the first count. */
  git: GitState | null
  /** Ordered provider-backed candidates; only displayed chats schedule Git work. */
  gitFolders?: string[]
  gitStatus?: 'loading' | 'ready' | 'unavailable'
  /** Null/absent means recorded ownership or current Git changes are unavailable. */
  threadDiff?: ThreadDiffSummary | null
  threadDiffStatus?: 'loading' | 'ready' | 'unavailable'
  /** How full its context is, 0 to 1, as the Claude app's Context ring shows; null if unknown. */
  contextUsed: number | null
  /** Set while the thread is waiting on the user; its card replaces the usual details. */
  attention: Attention | null
  /**
   * The user set this thread's pending request aside in Threadlight: its tag is toned down, it
   * is not held in Recent and it does not drip. Nothing changes in Claude or Codex.
   */
  ignored?: boolean
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
  /** Worktrees across the repositories its listed threads work in; 0 when unknown. */
  worktrees: number
}

/** Which workspaces the UI has open. `expanded: null` means "just the current workspace". */
export interface TreeView {
  expanded: string[] | null
  showAll: string[]
}

/** Everything one scan produces. */
export interface Snapshot {
  /** Latest read-only Codex quota observation, independent of the displayed chat's context. */
  codexUsage?: import('./usage').Usage | null
  provider?: Provider
  providers?: Provider[]
  /** Retained for an open composer when the combined list's limit hides its row. */
  lookupSessions?: Session[]
  /** Recent sessions in completion order: the Active list and the counts. */
  sessions: Session[]
  workspaces: Workspace[]
  /**
   * Every workspace, ignoring the time window, for choosing one to focus on. (`workspaces` only
   * has those with threads inside the window.)
   */
  allWorkspaces: { id: string; name: string }[]
  /** The workspace of the thread last open in Claude. */
  currentWorkspace: string | null
  /** The thread last open in Claude (its Claude Code session id): the one Claude shows now. */
  currentThreadId: string | null
}

/**
 * A message relayed to a session in the background.
 * sending → sent (✓, handed to the session) → replied (✓✓, the session answered), or failed.
 */
export type RelayState = 'sending' | 'sent' | 'replied' | 'failed'

export interface RelayStatus {
  attemptId?: string
  sessionId: string
  state: RelayState
  /** The reply when replied, the reason when failed. */
  detail: string
  /** When the state last changed, in milliseconds since the epoch. */
  at: number
}
