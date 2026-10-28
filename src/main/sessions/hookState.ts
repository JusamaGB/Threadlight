// Live session state from Claude Code hook events (the hook server feeds apply()).
// Hooks are the only exact source of "working" vs "idle"; transcripts fill in the rest.

import type { SessionState } from '../../shared/types'
import { isObject, str } from './json'

export interface HookRecord {
  sessionId: string
  state: SessionState
  cwd: string | null
  transcriptPath: string | null
  updatedAt: number
  completedAt?: number
  compacting?: boolean
  beforeCompact?: SessionState
}

/** Records older than this are dropped: the session is long gone. */
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000

export class HookStateStore {
  private records = new Map<string, HookRecord>()

  /** Applies one hook payload (the JSON Claude Code sends on stdin). Unknown events are ignored. */
  apply(payload: unknown, now = Date.now()): void {
    if (!isObject(payload)) return
    const sessionId = str(payload['session_id'])
    const event = str(payload['hook_event_name'])
    if (!sessionId || !event) return
    if (['PreCompact', 'PostCompact'].includes(event) && payload['agent_id']) return

    const previous = this.records.get(sessionId)
    const compactFinished =
      event === 'PostCompact' || (event === 'SessionStart' && payload['source'] === 'compact')
    const state = compactFinished
      ? (previous?.beforeCompact ?? previous?.state ?? 'idle')
      : stateForEvent(event, payload)
    if (!state) return
    this.records.set(sessionId, {
      sessionId,
      state,
      compacting: event === 'PreCompact',
      beforeCompact:
        event === 'PreCompact' ? (previous?.beforeCompact ?? previous?.state ?? 'idle') : undefined,
      cwd: str(payload['cwd']) ?? previous?.cwd ?? null,
      transcriptPath: str(payload['transcript_path']) ?? previous?.transcriptPath ?? null,
      updatedAt: now,
      completedAt:
        event === 'Stop' || (event === 'SessionEnd' && previous?.state !== 'idle')
          ? now
          : previous?.completedAt,
    })
  }

  get(sessionId: string): HookRecord | undefined {
    return this.records.get(sessionId)
  }

  all(now = Date.now()): HookRecord[] {
    for (const [id, record] of this.records) {
      if (now - record.updatedAt > FORGET_AFTER_MS) this.records.delete(id)
    }
    return [...this.records.values()]
  }
}

function stateForEvent(event: string, payload: Record<string, unknown>): SessionState | null {
  switch (event) {
    // SessionEnd means the process ended, not the thread: a background reply or a closed app
    // window ends it too. Keep the record as idle, or the transcript guess says "working".
    case 'SessionStart':
    case 'Stop':
    case 'SessionEnd':
      return 'idle'
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PreCompact':
      return 'working'
    case 'Notification': {
      // Permission prompts block the session on the user; the "waiting for input"
      // reminder after a reply is just idle.
      const text = `${str(payload['message']) ?? ''} ${str(payload['notification_type']) ?? ''}`
      return text.toLowerCase().includes('permission') ? 'waiting' : 'idle'
    }
    default:
      return null
  }
}
