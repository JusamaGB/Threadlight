import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { ConversationEventService } from '../src/main/communication/conversationEvents'
import { CommunicationStore } from '../src/main/communication/store'
import { OwnedRequests } from '../src/main/communication/ownedRequests'
import { IDLE_AGENT } from '../src/shared/agent'
import type { AgentService } from '../src/main/agent/agentService'
import type {
  CommunicationMessage,
  CommunicationSnapshot,
  NativeCommunicationRequest,
} from '../src/shared/communication'

const close: (() => void)[] = []
afterEach(() => close.splice(0).forEach((fn) => fn()))
function fixture() {
  const db = new DatabaseSync(':memory:'),
    store = new CommunicationStore(db),
    feed = new ConversationEventService(store)
  close.push(() => db.close())
  const owner = `codex:${randomUUID()}`,
    other = `codex:${randomUUID()}`,
    target = randomUUID()
  feed.register(owner, owner, undefined, 'line:1')
  feed.register(other, other)
  const snapshot: CommunicationSnapshot = {
    messages: [],
    questions: [],
    assignments: [],
    workflows: [],
    events: [],
    cursor: 0,
    snapshotRequired: false,
    nativeRequests: [],
  }
  const message: CommunicationMessage = {
    id: randomUUID(),
    operationId: randomUUID(),
    sender: owner,
    senderKind: 'agent',
    rootId: randomUUID(),
    kind: 'request',
    body: 'Work',
    at: 100,
    deliveries: [
      {
        target,
        phase: 'accepted',
        generation: 'g',
        attemptId: randomUUID(),
        reason: '',
        observedAt: 101,
      },
    ],
  }
  store.transaction(() => store.put('message', message, 'Accepted'))
  const request: NativeCommunicationRequest = {
    id: randomUUID(),
    generation: 'generation',
    revision: 1,
    target,
    kind: 'question',
    title: 'Which layout?',
    startedAt: 200,
    expiresAt: Date.now() + 100000,
    questions: [{ id: 'one', question: 'Pick', options: [{ label: 'A' }] }],
  }
  const project = () => feed.project(owner, snapshot, () => 'UI')
  return { db, store, feed, owner, other, target, snapshot, message, request, project }
}
it('scopes questions to the originating conversation and retains identity across updates', () => {
  const f = fixture()
  f.snapshot.nativeRequests = [f.request]
  const card = f.project().cards[0]!
  expect(card).toMatchObject({
    source: f.target,
    requestId: f.request.id,
    generation: 'generation',
    state: 'pending',
    anchor: 'line:1',
  })
  expect(f.feed.project(f.other, f.snapshot, () => 'Same title').cards).toEqual([])
  expect(f.project().cards[0]!.revision).toBe(card.revision)
  f.snapshot.nativeRequests = []
  expect(f.project().cards[0]!).toMatchObject({
    id: card.id,
    state: 'unavailable',
    speech: 'suppressed',
  })
  expect(() => f.feed.card(f.owner, card.id, card.revision)).toThrow(/changed/)
})
it('does not attach an ambiguous native request to one of multiple originating conversations', () => {
  const f = fixture()
  f.store.transaction(() =>
    f.store.put(
      'message',
      {
        ...f.message,
        id: randomUUID(),
        rootId: randomUUID(),
        operationId: randomUUID(),
        sender: f.other,
      },
      'Accepted',
    ),
  )
  f.snapshot.nativeRequests = [f.request]
  expect(f.project().cards).toEqual([])
})
it('requires explicit question correlation when conversations have no project subscription', () => {
  const f = fixture()
  const question = {
    id: randomUUID(),
    spaceId: randomUUID(),
    sender: 'worker',
    senderTarget: f.target,
    audience: 'human',
    body: 'Private choice',
    choices: [],
    generation: 'q',
    state: 'pending' as const,
    at: 200,
  }
  f.snapshot.questions = [question]
  expect(f.project().cards).toEqual([])
  f.snapshot.questions = [{ ...question, originMessageId: f.message.id }]
  expect(f.project().cards.some((card) => card.requestId === question.id)).toBe(true)
  expect(f.feed.project(f.other, f.snapshot, () => 'Other chat').cards).toEqual([])
})
it('deduplicates result projection and refuses a speech reservation after the request resolves', () => {
  const f = fixture()
  f.snapshot.nativeRequests = [f.request]
  f.message.deliveries[0]!.phase = 'completed'
  f.message.deliveries[0]!.reply = 'Actual result'
  f.message.deliveries[0]!.observedAt = 300
  f.store.transaction(() => f.store.put('message', f.message, 'Result'))
  expect(f.project().cards.filter((c) => c.kind === 'result')).toHaveLength(1)
  const a = f.feed.reserve(f.owner, 0)!
  expect(a.text).toContain('returned a result')
  expect(f.feed.reserve(f.owner, 0)).toBeUndefined()
  expect(f.feed.commit(a)).toBe(true)
  f.feed.settle(f.owner, a.id, 'announced')
  expect(f.project().cards).toHaveLength(1)
  expect(f.feed.reserve(f.owner, 0)).toBeUndefined()
})
it('suppresses a stale reservation and recovers submitted speech as uncertain without replay', () => {
  const f = fixture()
  f.snapshot.nativeRequests = [f.request]
  f.project()
  const a = f.feed.reserve(f.owner, 0)!
  f.snapshot.nativeRequests = []
  f.project()
  expect(f.feed.commit(a)).toBe(false)
  f.snapshot.nativeRequests = [f.request]
  f.project()
  const b = f.feed.reserve(f.owner, 0)!
  expect(f.feed.commit(b)).toBe(true)
  const recovered = new ConversationEventService(f.store)
  expect(recovered.get(f.owner).cards[0]!.speech).toBe('uncertain')
  expect(recovered.reserve(f.owner, 0)).toBeUndefined()
})
it('keeps a question-yield receipt distinct from a task result after the question is answered', () => {
  const f = fixture(),
    spaceId = randomUUID()
  f.feed.register(f.owner, f.owner, spaceId)
  f.snapshot.questions = [
    {
      id: randomUUID(),
      spaceId,
      sender: 'worker',
      senderTarget: f.target,
      audience: 'human',
      body: 'Need a choice',
      originMessageId: f.message.id,
      choices: [],
      generation: 'q',
      state: 'pending',
      at: 200,
    },
  ]
  f.message.deliveries[0]!.phase = 'completed'
  f.message.deliveries[0]!.observedAt = 300
  f.store.transaction(() => f.store.put('message', f.message, 'Yield'))
  expect(f.project().cards.find((c) => c.messageId === f.message.id)?.state).toBe('needs-input')
  f.snapshot.questions[0]!.state = 'answered'
  expect(f.project().cards.some((c) => c.kind === 'result')).toBe(false)
})
it('exposes all owned native requests and routes identical wording by field ID', () => {
  const received: unknown[] = []
  const state = {
    ...IDLE_AGENT,
    provider: 'codex' as const,
    conversationId: 'conversation',
    sessionId: randomUUID(),
    requests: [1, 2].map((n) => ({
      id: `rpc-${n}`,
      kind: 'questions' as const,
      title: 'Choice',
      detail: '',
      canAllow: true,
      questions: [
        { id: 'a', text: 'Same question', options: ['A'], other: false },
        { id: 'b', text: 'Same question', options: ['B'], other: false },
      ],
    })),
  }
  const owner = {
    current: state,
    respond: (...args: unknown[]) => {
      received.push(args)
      return { ok: true as const }
    },
  } as unknown as AgentService
  const adapter = new OwnedRequests(() => [owner]),
    requests = adapter.list()
  expect(requests).toHaveLength(2)
  expect(
    adapter.respond(requests[1]!.id, requests[1]!.generation, {
      action: 'answer',
      answers: { a: 'A', b: 'B' },
    }),
  ).toEqual({ ok: true })
  expect(received[0]!).toEqual(['rpc-2', { action: 'answer', answers: { a: 'A', b: 'B' } }])
  state.requests[1]!.title = 'Changed'
  expect(
    adapter.respond(requests[1]!.id, requests[1]!.generation, {
      action: 'answer',
      answers: { a: 'A', b: 'B' },
    }).ok,
  ).toBe(false)
})

it('routes a one-off question and its answer result by explicit origin, without a project subscription', () => {
  const f = fixture(),
    q = {
      id: randomUUID(),
      spaceId: randomUUID(),
      originMessageId: f.message.id,
      sender: 'worker',
      senderTarget: f.target,
      audience: 'human',
      body: 'Choose',
      choices: [],
      generation: 'q',
      state: 'pending' as const,
      at: 200,
    }
  f.snapshot.questions = [q]
  expect(f.project().cards.some((c) => c.requestId === q.id)).toBe(true)
  const answer = {
    ...f.message,
    id: randomUUID(),
    rootId: q.id,
    sender: 'human',
    kind: 'answer' as const,
    deliveries: [
      {
        ...f.message.deliveries[0]!,
        phase: 'completed' as const,
        attemptId: randomUUID(),
        reply: 'Answer result',
        observedAt: 500,
      },
    ],
  }
  f.snapshot.questions[0] = { ...q, state: 'answered', messageId: answer.id }
  f.store.transaction(() => f.store.put('message', answer, 'Answer result'))
  expect(f.project().cards.find((c) => c.messageId === answer.id)).toMatchObject({
    kind: 'result',
    body: 'Answer result',
  })
  expect(f.feed.project(f.other, f.snapshot, () => 'Same title').cards).toEqual([])
})
