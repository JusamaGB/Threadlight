import { sessionProvider } from './providers'
import type { Provider, Session } from './types'

export const WORKSPACE_GUTTER = 16
export interface AttentionMotion {
  active: boolean
  provider: Provider
  width: number
  height: number
  x: number
  y: number
  floor: number
}
export const NO_ATTENTION: AttentionMotion = {
  active: false,
  provider: 'claude',
  width: 140,
  height: 40,
  x: 70,
  y: 11,
  floor: 40,
}
/** Keep one provider's signal stable until its pending input is answered. */
export function attentionThread(sessions: Session[], previous?: string): Session | undefined {
  const waiting = sessions.filter((s) => s.state === 'waiting' || s.attention != null)
  return (
    waiting.find((s) => s.id === previous) ??
    waiting.sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.id.localeCompare(b.id))[0]
  )
}
export function attentionProvider(session: Session): Provider {
  return sessionProvider(session.id)
}
