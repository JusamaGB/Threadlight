import type { Attention, Session, Snapshot, ThreadNode } from '../shared/types'

/** What a request is, so a different one from the same thread is not mistaken for the old one. */
function signature(session: Session): string {
  const a: Attention | null = session.attention
  if (!a) return 'waiting'
  if (a.holdId) return `${a.kind}:${a.holdId}`
  switch (a.kind) {
    case 'question':
      return `question:${JSON.stringify(a.questions)}`
    case 'approval':
      return `approval:${a.tool ?? ''}:${a.action ?? ''}`
    case 'offer':
      return `offer:${a.title}`
    case 'next-step':
      return `next-step:${a.ask}`
  }
}

const needsInput = (session: Session) => session.state === 'waiting' || session.attention != null

/**
 * Threads whose pending request the user has set aside in Threadlight. Nothing is sent to
 * Claude or Codex: an ignored thread simply stops being held in Recent and stops dripping, and
 * its tag is toned down. The mark belongs to the request it was made on, so the thread asking
 * something new, or leaving the waiting state, clears it.
 */
export class IgnoredInput {
  private marks = new Map<string, string>()

  isIgnored(session: Session): boolean {
    return needsInput(session) && this.marks.get(session.id) === signature(session)
  }

  set(session: Session, ignore: boolean): void {
    if (ignore && needsInput(session)) this.marks.set(session.id, signature(session))
    else this.marks.delete(session.id)
  }

  /** Flags each ignored session, and forgets marks whose request has moved on. */
  annotate(snapshot: Snapshot): Snapshot {
    const cache = new Map<string, Session>()
    const flag = (session: Session): Session => {
      let result = cache.get(session.id)
      if (!result) {
        if (this.isIgnored(session)) result = { ...session, ignored: true }
        else {
          this.marks.delete(session.id)
          result = session
        }
        cache.set(session.id, result)
      }
      return result
    }
    const node = (item: ThreadNode): ThreadNode => ({
      session: flag(item.session),
      children: item.children.map(node),
    })
    return {
      ...snapshot,
      sessions: snapshot.sessions.map(flag),
      lookupSessions: snapshot.lookupSessions?.map(flag),
      workspaces: snapshot.workspaces.map((workspace) => ({
        ...workspace,
        threads: workspace.threads.map(node),
      })),
    }
  }
}
