import type { Session } from './types'
import type { ChatSource, ChatSummary } from './accountChats'

export type AccountThread = ChatSummary & { source: ChatSource }
export type RecentThread =
  | { kind: 'session'; key: string; at: number; session: Session }
  | { kind: 'chat'; key: string; at: number; chat: AccountThread }

/** One chronological list and one limit across enabled coding and chat sources. */
export function mergedRecentThreads(
  sessions: Session[],
  chats: AccountThread[],
  max: number,
): RecentThread[] {
  const ranked: RecentThread[] = [
    ...sessions.map((session) => ({
      kind: 'session' as const,
      key: `session:${session.id}`,
      at: sessionOrderAt(session),
      session,
    })),
    ...chats.map((chat) => ({
      kind: 'chat' as const,
      key: `${chat.source}:${chat.id}`,
      at: chat.updatedAt ?? 0,
      chat,
    })),
  ].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
  // Preserve the existing Recent rule: active work retains a place, but never a separate block.
  const pinned = ranked.filter((row) =>
    row.kind === 'session'
      ? row.session.state !== 'idle' && !row.session.ignored
      : row.chat.activity === 'active',
  )
  const chosen = new Set(pinned.slice(0, Math.max(0, max)))
  for (const row of ranked) {
    if (chosen.size >= max) break
    chosen.add(row)
  }
  return ranked.filter((row) => chosen.has(row))
}

/** Live activity remains available for time windows and hover details. */
export const sessionOrderAt = (session: Session) => session.orderAt ?? session.lastActiveAt
export const compareSessionOrder = (a: Session, b: Session) =>
  sessionOrderAt(b) - sessionOrderAt(a) || a.id.localeCompare(b.id)

/** Reserve the limited list's places for active threads, preserving completion order. */
export function recentSessions(
  sessions: Session[],
  max: number,
  /** Threads that keep their place however old: active ones, unless the user set them aside. */
  pinned: (session: Session) => boolean = (session) => session.state !== 'idle',
): Session[] {
  const ranked = [...sessions].sort(compareSessionOrder)
  const chosen = new Set(ranked.filter(pinned).slice(0, max))
  for (const session of ranked) {
    if (chosen.size >= max) break
    chosen.add(session)
  }
  return ranked.filter((session) => chosen.has(session))
}
