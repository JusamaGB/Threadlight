import type { CommunicationQuestion } from './communication'
import type { Session, Snapshot, ThreadNode } from './types'

/** Project only current human cards onto provider data; never mutate its native attention. */
export function withManagedQuestions(
  snapshot: Snapshot,
  questions: CommunicationQuestion[],
  now = Date.now(),
): Snapshot {
  const pending = questions.filter(
    (q) =>
      q.answerDelivery === 'tool' &&
      q.audience === 'human' &&
      q.state === 'pending' &&
      !!q.senderTarget &&
      !!q.expiresAt &&
      q.expiresAt > now,
  )
  if (!pending.length) return snapshot
  const annotate = (session: Session): Session => {
    const question = pending.find((q) => q.senderTarget === session.id)
    if (!question) return session
    return {
      ...session,
      state: 'waiting',
      compacting: false,
      stage: question.body,
      attention: {
        kind: 'question',
        answerableUntil: question.expiresAt!,
        managed: {
          id: question.id,
          generation: question.generation,
          allowOther: question.allowOther ?? false,
        },
        questions: [
          {
            header: 'Question',
            question: question.body,
            multiSelect: false,
            options: question.choices.map((label) => ({
              label,
              description: '',
              recommended: false,
            })),
          },
        ],
      },
    }
  }
  const tree = (nodes: ThreadNode[]): ThreadNode[] =>
    nodes.map((node) => ({
      ...node,
      session: annotate(node.session),
      children: tree(node.children),
    }))
  return {
    ...snapshot,
    sessions: snapshot.sessions.map(annotate),
    lookupSessions: snapshot.lookupSessions?.map(annotate),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      threads: tree(workspace.threads),
    })),
  }
}
