import { expect, it } from 'vitest'
import { withManagedQuestions } from '../src/shared/managedQuestions'
import type { CommunicationQuestion } from '../src/shared/communication'
import type { Session, Snapshot } from '../src/shared/types'

it('projects only current linked cards across recent and workspace views and restores native data', () => {
  const native = { kind: 'question', questions: [], answerableUntil: null } as const
  const session = { id: 'codex:one', state: 'idle', attention: native } as unknown as Session
  const other = { ...session, id: 'codex:two' }
  const snapshot = {
    sessions: [session, other],
    lookupSessions: [session],
    workspaces: [
      { id: 'project', threads: [{ session: other, children: [{ session, children: [] }] }] },
    ],
  } as unknown as Snapshot
  const q = {
    id: 'question',
    generation: 'generation',
    answerDelivery: 'tool',
    senderTarget: session.id,
    audience: 'human',
    state: 'pending',
    body: 'Which direction?',
    choices: ['Build'],
    expiresAt: 10000,
  } as CommunicationQuestion
  const projected = withManagedQuestions(snapshot, [q], 1000)
  expect(projected.sessions[0]).toMatchObject({
    state: 'waiting',
    attention: {
      managed: { id: q.id, generation: q.generation },
      questions: [{ question: q.body }],
    },
  })
  expect(projected.sessions[1]).toBe(other)
  expect(projected.lookupSessions?.[0]?.attention).toEqual(projected.sessions[0]?.attention)
  expect(projected.workspaces[0]?.threads[0]?.children[0]?.session.attention).toEqual(
    projected.sessions[0]?.attention,
  )
  expect(session.attention).toBe(native)
  for (const question of [
    { ...q, state: 'answered' as const },
    { ...q, audience: 'someone-else' },
    { ...q, answerDelivery: 'message' as const },
    { ...q, expiresAt: 999 },
  ])
    expect(withManagedQuestions(snapshot, [question], 1000)).toBe(snapshot)
})
