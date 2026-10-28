import type { Session, Snapshot, ThreadNode } from './types'

interface Receipt {
  state: Session['state']
  stamp: string
  unread: boolean
}
const LIMIT = 500

// Persist only a fingerprint and lifecycle state, never a copy of message content.
function stamp(session: Session): string {
  const text = session.lastReply ?? session.recap ?? ''
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `${session.orderAt ?? 0}:${text.length}:${hash >>> 0}`
}

function mapSnapshot(snapshot: Snapshot, map: (session: Session) => Session): Snapshot {
  const nodes = (threads: ThreadNode[]): ThreadNode[] =>
    threads.map((node) => ({
      ...node,
      session: map(node.session),
      children: nodes(node.children),
    }))
  return {
    ...snapshot,
    sessions: snapshot.sessions.map(map),
    lookupSessions: snapshot.lookupSessions?.map(map),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      threads: nodes(workspace.threads),
    })),
  }
}

/** Read receipts belong to this UI. Historical threads are quietly baselined on first discovery. */
export class ThreadReadReceipts {
  private entries = new Map<string, Receipt>()

  constructor(saved?: string | null) {
    try {
      const parsed: unknown = JSON.parse(saved ?? 'null')
      if (!Array.isArray(parsed)) return
      for (const record of parsed.slice(-LIMIT)) {
        if (!Array.isArray(record) || record.length !== 2) continue
        const [id, value] = record
        if (typeof id !== 'string' || !value || typeof value !== 'object') continue
        if (
          !['working', 'waiting', 'idle'].includes(value.state) ||
          typeof value.stamp !== 'string' ||
          typeof value.unread !== 'boolean'
        )
          continue
        this.entries.set(id, { state: value.state, stamp: value.stamp, unread: value.unread })
      }
    } catch {
      /* Missing or older UI storage starts with a clean baseline. */
    }
  }

  observe(snapshot: Snapshot): boolean {
    let changed = false
    const visited = new Set<string>()
    mapSnapshot(snapshot, (session) => {
      if (visited.has(session.id)) return session
      visited.add(session.id)
      const previous = this.entries.get(session.id)
      const currentStamp = stamp(session)
      const next: Receipt = {
        state: session.state,
        stamp: currentStamp,
        unread:
          session.state === 'idle' &&
          !!previous &&
          (previous.unread || previous.state !== 'idle' || previous.stamp !== currentStamp),
      }
      if (
        !previous ||
        previous.state !== next.state ||
        previous.stamp !== next.stamp ||
        previous.unread !== next.unread
      ) {
        this.entries.delete(session.id)
        this.entries.set(session.id, next)
        changed = true
      }
      return session
    })
    while (this.entries.size > LIMIT) this.entries.delete(this.entries.keys().next().value!)
    return changed
  }

  decorate(snapshot: Snapshot): Snapshot {
    return mapSnapshot(snapshot, (session) => ({
      ...session,
      unread: session.state === 'idle' && !!this.entries.get(session.id)?.unread,
    }))
  }

  markRead(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry?.unread) return false
    entry.unread = false
    return true
  }

  serialize(): string {
    return JSON.stringify([...this.entries])
  }
}
