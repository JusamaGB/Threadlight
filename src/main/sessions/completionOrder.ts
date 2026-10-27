import type { Session } from '../../shared/types'

interface Entry {
  at: number
  completed: number
  state: Session['state']
  reply: string | null
}

/** Message/tool/focus updates do not move a row; finishing a task does. */
export class CompletionOrder {
  private entries = new Map<string, Entry>()

  observe(session: Session, completed = 0): Session {
    const previous = this.entries.get(session.id)
    let at = previous?.at ?? (completed || session.lastActiveAt)
    if (!previous && session.state === 'idle') at = completed || session.lastActiveAt
    if (
      previous &&
      session.state === 'idle' &&
      (previous.state !== 'idle' ||
        completed > previous.completed ||
        (session.lastReply && session.lastReply !== previous.reply))
    )
      at = completed > previous.completed ? completed : session.lastActiveAt
    this.entries.set(session.id, {
      at,
      completed: !previous
        ? completed
        : session.state === 'idle'
          ? Math.max(completed, previous.completed)
          : previous.completed,
      state: session.state,
      reply: session.lastReply,
    })
    return { ...session, orderAt: at }
  }

  time(id: string, fallback: number): number {
    return this.entries.get(id)?.at ?? fallback
  }
}
