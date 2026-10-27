import type { Session } from './types'

/** Live activity remains available for time windows and hover details. */
export const sessionOrderAt = (session: Session) => session.orderAt ?? session.lastActiveAt
export const compareSessionOrder = (a: Session, b: Session) =>
  sessionOrderAt(b) - sessionOrderAt(a) || a.id.localeCompare(b.id)

/** Reserve the limited list's places for active threads, preserving completion order. */
export function recentSessions(sessions: Session[], max: number): Session[] {
  const ranked = [...sessions].sort(compareSessionOrder)
  const chosen = new Set(ranked.filter((session) => session.state !== 'idle').slice(0, max))
  for (const session of ranked) {
    if (chosen.size >= max) break
    chosen.add(session)
  }
  return ranked.filter((session) => chosen.has(session))
}
