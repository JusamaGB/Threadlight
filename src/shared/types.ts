/** What a session is doing right now. */
export type SessionState = 'working' | 'waiting' | 'idle'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanItem {
  content: string
  status: PlanStatus
}

export interface CurrentStep {
  /** 1-based position in the plan. */
  index: number
  total: number
  content: string
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
  permissionMode: string | null
  model: string | null
}
