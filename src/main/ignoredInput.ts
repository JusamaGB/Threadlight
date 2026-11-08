import type { Attention, Session, Snapshot, ThreadNode } from '../shared/types'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { CodexQuestionRef } from '../shared/codexQuestions'

/** What a request is, so a different one from the same thread is not mistaken for the old one. */
function signature(session: Session): string {
  const a: Attention | null = session.attention
  if (!a) return 'waiting'
  if (a.holdId) return `${a.kind}:${a.holdId}`
  switch (a.kind) {
    case 'question':
      return `question:${JSON.stringify([a.nativeCodex, a.questions])}`
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
  private dismissed = new Set<string>()

  constructor(private file?: string) {
    if (!file) return
    try {
      const ids = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(ids))
        this.dismissed = new Set(
          ids.filter((id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)),
        )
    } catch {
      /* No saved dismissals yet. */
    }
  }

  private dismissalKey(session: Session) {
    if (session.attention?.kind !== 'question' || !session.attention.nativeCodex) return
    return this.questionKey(session.id, session.attention.nativeCodex)
  }

  private questionKey(id: string, ref: CodexQuestionRef) {
    return createHash('sha256')
      .update(JSON.stringify([id, ref.turnId, ref.itemId, ref.generation]))
      .digest('hex')
  }

  isQuestionDismissed(id: string, ref: CodexQuestionRef) {
    return this.dismissed.has(this.questionKey(id, ref))
  }

  private save() {
    if (!this.file) return
    writeFileSync(this.file + '.tmp', JSON.stringify([...this.dismissed]), { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
  }

  dismiss(session: Session, ref: CodexQuestionRef) {
    const current = session.attention?.kind === 'question' && session.attention.nativeCodex
    const key = this.dismissalKey(session)
    if (
      !key ||
      !current ||
      current.turnId !== ref.turnId ||
      current.itemId !== ref.itemId ||
      !current.generation ||
      current.generation !== ref.generation
    )
      return false
    this.dismissed.add(key)
    try {
      this.save()
    } catch {
      this.dismissed.delete(key)
      return false
    }
    return true
  }

  isIgnored(session: Session): boolean {
    return (
      needsInput(session) &&
      (this.marks.get(session.id) === signature(session) ||
        this.dismissed.has(this.dismissalKey(session) ?? ''))
    )
  }

  set(session: Session, ignore: boolean): void {
    if (ignore && needsInput(session)) this.marks.set(session.id, signature(session))
    else this.marks.delete(session.id)
    const key = this.dismissalKey(session)
    if (!ignore && key && this.dismissed.delete(key)) {
      try {
        this.save()
      } catch {
        this.dismissed.add(key)
      }
    }
  }

  /** Flags each ignored session, and forgets marks whose request has moved on. */
  annotate(snapshot: Snapshot): Snapshot {
    const cache = new Map<string, Session>()
    const flag = (session: Session): Session => {
      let result = cache.get(session.id)
      if (!result) {
        if (this.isIgnored(session))
          result = {
            ...session,
            ignored: true,
            questionDismissed: this.dismissed.has(this.dismissalKey(session) ?? '') || undefined,
          }
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
