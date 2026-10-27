import type { Attention, SessionState } from '../../shared/types'

/** A held writer alone means the chat is loaded, not that a turn is running. */
export function codexState(
  turnStatus: unknown,
  live: boolean,
  attention: Attention | null,
  hook: { state: SessionState } | null,
): { state: SessionState; tracked: boolean } {
  if (hook) {
    if (hook.state === 'working' && !live) return { state: 'idle', tracked: false }
    return { state: hook.state, tracked: true }
  }
  if (['inProgress', 'in_progress'].includes(String(turnStatus)) && live)
    return { state: 'working', tracked: true }
  if (attention) return { state: 'waiting', tracked: live && attention.kind === 'question' }
  return {
    state: 'idle',
    tracked: ['completed', 'failed', 'interrupted'].includes(String(turnStatus)),
  }
}
