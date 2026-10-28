import type { ThreadTimeline, TimelineItem } from './threadTimeline'
import type { Session } from './types'

/** The newest public activity or message in this turn, shared by the row and open card. */
export function liveThreadActivity(
  session: Pick<Session, 'id' | 'state' | 'compacting' | 'turnStartedAt'>,
  timeline?: ThreadTimeline,
): string | null {
  if (
    session.state !== 'working' ||
    session.compacting ||
    timeline?.threadId !== session.id ||
    !['live', 'history'].includes(timeline.connection)
  )
    return null
  const latest = timeline.items.at(-1)
  if (!latest || latest.role === 'user') return null
  if (session.turnStartedAt && latest.at !== null && latest.at < session.turnStartedAt) return null
  return latest.text.replace(/\s+/g, ' ').trim().slice(0, 300) || null
}

export type ConversationRow =
  | { type: 'message'; id: string; item: TimelineItem }
  | { type: 'activity'; id: string; items: TimelineItem[] }

/** Native message/turn boundaries remain visible; only adjacent tool activity collapses. */
export function conversationRows(items: TimelineItem[]): ConversationRow[] {
  const rows: ConversationRow[] = []
  for (const item of items) {
    if (
      item.role !== 'activity' ||
      item.activity === 'compaction' ||
      item.activity === 'files' ||
      item.kind !== 'tool'
    ) {
      rows.push({ type: 'message', id: item.id, item })
      continue
    }
    const last = rows.at(-1)
    if (last?.type === 'activity' && last.items[0]?.turnId === item.turnId) last.items.push(item)
    else rows.push({ type: 'activity', id: item.id, items: [item] })
  }
  return rows
}

export function activitySummary(items: TimelineItem[], active: boolean): string {
  const pending = active ? items.findLast((item) => !item.complete) : undefined
  if (pending) return pending.activity === 'command' ? 'Running command' : pending.text
  const actions = items.filter((item) => item.activity !== 'status')
  if (!actions.length) return items.at(-1)?.text || 'Activity'
  if (actions.length === 1 && actions[0]!.activity !== 'command')
    return actions[0]!.text + (actions[0]!.failed ? ' · Failed' : '')
  const segments = new Map<string, number>()
  for (const item of actions) {
    const kind = item.activity ?? 'tool'
    segments.set(kind, (segments.get(kind) ?? 0) + 1)
  }
  const phrases = [...segments].map(([kind, count]) => {
    switch (kind) {
      case 'command':
        return count === 1 ? 'ran a command' : 'ran commands'
      case 'files':
        return 'edited files'
      case 'loaded-tool':
        return count === 1 ? 'loaded a tool' : 'loaded tools'
      case 'search':
        return 'searched'
      case 'image':
        return count === 1 ? 'viewed an image' : 'viewed images'
      default:
        return count === 1 ? 'used a tool' : 'used tools'
    }
  })
  const label = phrases.join(', ')
  return (
    label.charAt(0).toUpperCase() +
    label.slice(1) +
    (actions.some((item) => item.failed) ? ' · Failed' : '')
  )
}
