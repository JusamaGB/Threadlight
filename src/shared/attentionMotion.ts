import { sessionProvider } from './providers'
import { MAX_ATTENTION_DRIPS } from './dripSchedule'
import { compareSessionOrder } from './sessionOrder'
import type { Provider, Session } from './types'

export const WORKSPACE_GUTTER = 16
export interface AttentionMotion {
  active: boolean
  /** The provider of the first waiting thread (kept for single-drip consumers). */
  provider: Provider
  /** One entry per waiting thread, in the order the panel lists them, at most ten. */
  providers: Provider[]
  width: number
  height: number
  x: number
  y: number
  floor: number
}
export const NO_ATTENTION: AttentionMotion = {
  active: false,
  provider: 'claude',
  providers: [],
  width: 140,
  height: 40,
  x: 70,
  y: 11,
  floor: 40,
}
/** Every thread waiting for input, in the order the panel lists them, capped at ten drips. */
export function attentionThreads(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => s.state === 'waiting' || s.attention != null)
    .sort(compareSessionOrder)
    .slice(0, MAX_ATTENTION_DRIPS)
}
export function attentionProvider(session: Session): Provider {
  return sessionProvider(session.id)
}
