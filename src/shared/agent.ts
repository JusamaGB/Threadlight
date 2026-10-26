// What the panel shows of the agent: one conversation Threadlight hosts itself.
import type { ThreadToolReceipt } from './threadRead'

/** idle: no run. working: a turn is under way. waiting: it needs your approval. ready: done,
 * and listening for a follow-up. error: the run stopped unexpectedly. */
export type AgentStatus =
  'idle' | 'starting' | 'working' | 'waiting' | 'stopping' | 'ready' | 'interrupted' | 'error'

export type AgentProvider = 'claude' | 'codex'
export type AgentResult = { ok: true } | { ok: false; reason: string }
export interface AgentModel {
  id: string
  name: string
  hidden: boolean
  isDefault: boolean
  efforts: string[]
  defaultEffort: string | null
}
export interface AgentQuestion {
  id: string
  text: string
  options: string[]
  other: boolean
  secret?: boolean
}
export interface AgentRequest extends AgentApproval {
  kind: 'approval' | 'questions' | 'permissions' | 'elicitation'
  questions?: AgentQuestion[]
  canAllow: boolean
}
export type AgentResponse =
  { action: 'allow' | 'deny' } | { action: 'answer'; answers: Record<string, string> }
export interface AgentHistoryPage {
  items: AgentItem[]
  cursor: string | null
  error?: string
}

/** One line of the conversation: what you said, what it said, or a step it took. */
export interface AgentItem {
  source?: ThreadToolReceipt
  sourceHistorical?: boolean
  id?: string
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
  live?: 'connecting' | 'ready' | 'active' | null
  revision: number
  provider: AgentProvider | null
  model: string | null
  reasoning: string | null
  conversationId: string | null
  requests: AgentRequest[]
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
  costUsd: number | null
  /** Claude Code's id for this conversation, once it has started (or the one continued). */
  sessionId: string | null
}

/** A past conversation, listed under Earlier. */
export interface AgentConversation {
  id: string
  provider?: AgentProvider
  model?: string | null
  /** What you asked first. */
  title: string
  /** When it last changed, in ms since the epoch. */
  at: number
}

export const IDLE_AGENT: AgentState = {
  revision: 0,
  provider: null,
  model: null,
  reasoning: null,
  conversationId: null,
  requests: [],
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
  unavailable?: boolean
}

export const agentBusy = (state: AgentState) =>
  ['starting', 'working', 'waiting', 'stopping'].includes(state.status)
