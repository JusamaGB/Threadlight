// What the panel shows of the agent: one conversation Threadlight hosts itself.

/** idle: no run. working: a turn is under way. waiting: it needs your approval. ready: done,
 * and listening for a follow-up. error: the run stopped unexpectedly. */
export type AgentStatus = 'idle' | 'starting' | 'working' | 'waiting' | 'ready' | 'error'

/** One line of the conversation: what you said, what it said, or a step it took. */
export interface AgentItem {
  kind: 'you' | 'agent' | 'step'
  text: string
}

/** A tool call that changes something, paused until you allow or deny it. */
export interface AgentApproval {
  id: string
  /** e.g. "Gmail · send message" */
  title: string
  /** The call's input, readable: who it goes to, what it says. */
  detail: string
}

export interface AgentState {
  status: AgentStatus
  items: AgentItem[]
  approval: AgentApproval | null
  /** What it is doing right now, from Claude Code's own progress line. */
  progress: string | null
  /** Why the run stopped, when it stopped on its own. */
  error: string | null
  /** Its time ran out (settings): the next message starts a fresh conversation. */
  ended: boolean
  /** Spent so far in this conversation, in US dollars. */
  costUsd: number
  /** Claude Code's id for this conversation, once it has started (or the one continued). */
  sessionId: string | null
}

/** A past conversation, listed under Earlier. */
export interface AgentConversation {
  id: string
  /** What you asked first. */
  title: string
  /** When it last changed, in ms since the epoch. */
  at: number
}

export const IDLE_AGENT: AgentState = {
  status: 'idle',
  items: [],
  approval: null,
  progress: null,
  error: null,
  ended: false,
  costUsd: 0,
  sessionId: null,
}

/** A connected app the agent can use (an MCP server Claude Code sees). */
export interface AgentApp {
  name: string
  /** "connected", "needs sign-in", or why it failed. */
  status: string
}
