import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunicationService } from '../src/main/communication/service'
import { CommunicationStore } from '../src/main/communication/store'
import type {
  CommunicationActor,
  CommunicationMessage,
  Destination,
  Workflow,
  NativeCommunicationRequest,
} from '../src/shared/communication'

const closing: (() => void)[] = []
afterEach(() => closing.splice(0).forEach((close) => close()))
function fixture() {
  const db = new DatabaseSync(':memory:'),
    store = new CommunicationStore(db, () => 1000)
  const spaceId = randomUUID(),
    folderId = randomUUID(),
    a = randomUUID(),
    b = `codex:${randomUUID()}`
  let revoked = false
  const destinations: Destination[] = [a, b].map((id) => ({
    id,
    title: id === a ? 'Claude build' : 'Codex review',
    provider: id === a ? 'claude' : 'codex',
    hostId: 'local',
    workspace: '/project',
    model: 'test-model',
    state: 'idle',
    generation: 'test-generation',
    send: false,
    queue: false,
    reason: 'Inbox only',
    observedAt: 1000,
  }))
  const native: NativeCommunicationRequest[] = []
  const respondNative = vi.fn(() => ({ ok: true as const }))
  const input = vi.fn(() => ({ revision: 1, folderId, archived: false }))
  const deliver = vi.fn(async () => ({ reply: 'Finished', turnId: 'turn-one' }))
  const lookup = vi.fn(async (target?: string) =>
    destinations.filter((d) => !target || d.id === target),
  )
  const service = new CommunicationService(
    store,
    {
      nativeRequests: () => native,
      respondNative,
      destinations: lookup,
      deliver,
      authorize: (actor) => {
        if (revoked && actor.kind === 'participant') throw new Error('Revoked')
      },
      input,
      project: () => ({ root: '/project', paused: false, expiresAt: 999999, maxDispatches: 20 }),
    },
    () => 1000,
  )
  closing.push(() => {
    service.close()
    db.close()
  })
  const human: CommunicationActor = { id: 'human', kind: 'human' }
  const peer = (target: string): CommunicationActor => ({
    id: `participant:${spaceId}:${target}`,
    kind: 'participant',
    target,
    spaceId,
  })
  const workflow: Workflow = {
    id: randomUUID(),
    spaceId,
    revision: 1,
    mode: 'manual',
    paused: false,
    participants: [a, b].map((target, index) => ({
      id: randomUUID(),
      target,
      role: index ? 'Review' : 'Build',
      model: 'test-model',
      communicate: true,
      requestWork: true,
    })),
    maxConcurrent: 2,
    maxDispatches: 20,
    expiresAt: 999999,
    recover: false,
    acceptBy: 'human',
  }
  service.configure(workflow, 0, human)
  const send = (sender = peer(a), targets = [b], extras: Record<string, unknown> = {}) =>
    service.execute(
      'send_message',
      {
        operationId: randomUUID(),
        targets,
        body: 'Investigate\nPreserve this second line.',
        spaceId,
        ...extras,
      },
      sender,
    ) as Promise<CommunicationMessage>
  return {
    native,
    respondNative,
    input,
    db,
    store,
    service,
    spaceId,
    folderId,
    a,
    b,
    human,
    peer,
    workflow,
    destinations,
    lookup,
    deliver,
    send,
    revoke: () => {
      revoked = true
    },
  }
}

describe('Thread communication', () => {
  it('persists an addressed multiline DM and exposes it in the recipient inbox without claiming wakeup', async () => {
    const f = fixture(),
      m = await f.send()
    await vi.waitFor(() => expect(f.store.get('message', m.id).deliveries[0]?.phase).toBe('inbox'))
    const inbox = (await f.service.execute('read_inbox', {}, f.peer(f.b))) as {
      messages: CommunicationMessage[]
    }
    expect(inbox.messages.map((m) => m.id)).toContain(m.id)
    expect(inbox.messages[0]?.body).toContain('\n')
    expect(f.deliver).not.toHaveBeenCalled()
  })
  it('deduplicates repeated submissions but rejects reused IDs with different content', async () => {
    const f = fixture(),
      operationId = randomUUID()
    const a = await f.send(undefined, undefined, { operationId })
    const b = await f.send(undefined, undefined, { operationId })
    expect(b.id).toBe(a.id)
    expect(f.store.list('message')).toHaveLength(1)
    await expect(f.send(undefined, undefined, { operationId, body: 'Changed' })).rejects.toThrow(
      'different input',
    )
  })
  it('routes a direct cross-provider reply to its original sender and rejects forwarding as a reply', async () => {
    const f = fixture(),
      m = await f.send()
    const reply = await f.send(f.peer(f.b), [f.a], {
      replyTo: m.id,
      kind: 'answer',
      body: 'The answer',
    })
    expect(reply.replyTo).toBe(m.id)
    expect(reply.rootId).toBe(m.rootId)
    await expect(f.send(f.human, [f.b], { replyTo: m.id })).rejects.toThrow('original sender')
  })
  it('enforces project identity and revoked communication access', async () => {
    const f = fixture()
    await expect(f.send(f.peer(f.a), [f.b], { spaceId: randomUUID() })).rejects.toThrow('not bound')
    const m = await f.send()
    f.revoke()
    await expect(f.service.execute('get_message', { id: m.id }, f.peer(f.b))).rejects.toThrow(
      'not permitted',
    )
  })
  it('does not give a memory participant permission to approve or answer a human question', async () => {
    const f = fixture(),
      question = (await f.service.execute(
        'ask_question',
        { operationId: randomUUID(), spaceId: f.spaceId, body: 'Which colour?', audience: 'human' },
        f.peer(f.a),
      )) as { id: string; generation: string }
    await expect(
      f.service.execute(
        'answer_request',
        { operationId: randomUUID(), ...question, answer: 'Blue' },
        f.peer(f.b),
      ),
    ).rejects.toThrow()
    await f.service.execute(
      'answer_request',
      {
        operationId: randomUUID(),
        id: question.id,
        generation: question.generation,
        answer: 'Blue',
      },
      f.human,
    )
    expect(f.store.get('question', question.id).answeredBy).toBe('human')
    expect(f.store.list('message')[0]?.deliveries[0]?.target).toBe(f.a)
  })
  it('rejects stale question generations and deduplicates the actual answer', async () => {
    const f = fixture(),
      q = (await f.service.execute(
        'ask_question',
        {
          operationId: randomUUID(),
          spaceId: f.spaceId,
          body: 'Which?',
          audience: 'human',
          choices: ['A', 'B'],
        },
        f.peer(f.a),
      )) as { id: string; generation: string }
    await expect(
      f.service.execute(
        'answer_request',
        { operationId: randomUUID(), id: q.id, generation: 'old', answer: 'A' },
        f.human,
      ),
    ).rejects.toThrow('no longer')
    const answer = { operationId: randomUUID(), id: q.id, generation: q.generation, answer: 'A' }
    await f.service.execute('answer_request', answer, f.human)
    await f.service.execute('answer_request', answer, f.human)
    expect(f.store.list('message')).toHaveLength(1)
  })
  it('preserves uncertain delivery and does not retry it on another scheduler tick', async () => {
    const f = fixture()
    f.destinations[1]!.send = true
    f.deliver.mockRejectedValue(new Error('Response lost'))
    const m = await f.send()
    await vi.waitFor(() =>
      expect(f.store.get('message', m.id).deliveries[0]?.phase).toBe('unknown'),
    )
    await f.service.tick()
    expect(f.deliver).toHaveBeenCalledTimes(1)
    await expect(
      f.service.execute('cancel_message', { id: m.id, operationId: randomUUID() }, f.human),
    ).rejects.toThrow('already')
  })
  it('serializes senders to a destination and records a correlated result', async () => {
    const f = fixture()
    f.destinations[1]!.send = true
    let finish!: (result: { reply: string; turnId: string }) => void
    f.deliver.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = await f.send(),
      second = await f.send()
    await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledTimes(1))
    finish({ reply: 'A result\nWith details', turnId: 'native-one' })
    await vi.waitFor(() =>
      expect(f.store.get('message', second.id).deliveries[0]?.phase).toBe('completed'),
    )
    expect(f.store.list('message').find((m) => m.replyTo === first.id)?.body).toBe(
      'A result\nWith details',
    )
  })
  it('keeps one-off exchange history separate from projects and unrelated agent conversations', async () => {
    const f = fixture(),
      agent: CommunicationActor = { id: 'agent:one', kind: 'agent' }
    const m = (await f.service.execute(
      'send_message',
      { operationId: randomUUID(), targets: [f.b], body: 'One-off' },
      agent,
    )) as CommunicationMessage
    expect(m.spaceId).toBeUndefined()
    expect(f.service.snapshot({ id: 'agent:two', kind: 'agent' }).messages).toHaveLength(0)
    expect(f.service.snapshot(f.human, f.spaceId).messages).toHaveLength(0)
  })
  it('refuses silent role-model substitution', async () => {
    const f = fixture()
    f.destinations[1]!.send = true
    f.destinations[1]!.model = 'different'
    const m = await f.send()
    await vi.waitFor(() => expect(f.store.get('message', m.id).deliveries[0]?.phase).toBe('held'))
    expect(f.deliver).not.toHaveBeenCalled()
  })
  it('retains separate fan-out delivery outcomes', async () => {
    const f = fixture()
    f.destinations[1]!.send = true
    const m = await f.send(f.human, [f.a, f.b])
    await vi.waitFor(() =>
      expect(f.store.get('message', m.id).deliveries.map((d) => d.phase)).toEqual([
        'inbox',
        'completed',
      ]),
    )
  })
  it('recovers interrupted attempts as uncertain and never restores a queued send as ready', async () => {
    const f = fixture()
    f.workflow.paused = true
    f.service.configure({ ...f.workflow, revision: 2 }, 1, f.human)
    const m = await f.send()
    f.store.transaction(() => {
      m.deliveries[0]!.phase = 'submitting'
      f.store.put('message', m, 'Interrupted')
    })
    const recovered = new CommunicationStore(f.db)
    expect(recovered.get('message', m.id).deliveries[0]?.phase).toBe('unknown')
  })
})

const assignment = (f: ReturnType<typeof fixture>, role = 0, dependsOn: string[] = []) => ({
  id: randomUUID(),
  spaceId: f.spaceId,
  title: `Task ${role}`,
  brief: 'Implement the bounded change',
  roleId: f.workflow.participants[role]!.id,
  acceptance: 'Saved result passes review',
  dependsOn,
  resources: [],
  inputs: [],
  folderId: f.folderId,
  workflowRevision: 1,
})

describe('Workflow progression and native response authority', () => {
  it('queues a busy verified destination without generating repeated events, then delivers once idle', async () => {
    const f = fixture()
    f.destinations[1]!.queue = true
    const m = await f.send()
    await vi.waitFor(() =>
      expect(f.store.get('message', m.id).deliveries[0]?.reason).toBe('Inbox only'),
    )
    const cursor = f.store.cursor()
    await f.service.tick()
    await f.service.tick()
    expect(f.store.cursor()).toBe(cursor)
    f.destinations[1]!.send = true
    await f.service.tick()
    await vi.waitFor(() =>
      expect(f.store.get('message', m.id).deliveries[0]?.phase).toBe('completed'),
    )
    expect(f.deliver).toHaveBeenCalledTimes(1)
  })
  it('holds dependent work until saved outputs are accepted and serializes shared checkout work', async () => {
    const f = fixture(),
      a = assignment(f),
      b = assignment(f, 1, [a.id]),
      c = assignment(f, 1)
    for (const item of [a, b, c]) {
      await f.service.execute(
        'propose_assignment',
        { operationId: randomUUID(), assignment: item },
        f.human,
      )
      f.service.authorizeAssignment(item.id, f.human)
    }
    await f.service.tick()
    expect(f.store.get('assignment', b.id).reason).toMatch(/dependencies/)
    expect(f.store.get('assignment', c.id).reason).toMatch(/resource/)
    const result = {
      operationId: randomUUID(),
      id: a.id,
      body: 'Result with evidence',
      outputIds: [randomUUID()],
    }
    await f.service.execute('submit_assignment_result', result, f.peer(f.a))
    await f.service.tick()
    expect(f.store.get('assignment', b.id).messageId).toBeUndefined()
    const queuedC = f.store.get('assignment', c.id).messageId
    if (queuedC)
      await f.service.execute('cancel_message', { id: queuedC, operationId: randomUUID() }, f.human)
    await f.service.execute(
      'accept_assignment',
      { operationId: randomUUID(), id: a.id, reason: 'Reviewed saved output' },
      f.human,
    )
    await f.service.tick()
    expect(f.store.get('assignment', b.id).messageId).toBeDefined()
  })
  it('does not release stale pinned inputs or silently change the requested reasoning setting', async () => {
    const f = fixture(),
      a = assignment(f)
    a.inputs = [{ itemId: randomUUID(), revision: 1 }] as never
    await f.service.execute(
      'propose_assignment',
      { operationId: randomUUID(), assignment: a },
      f.human,
    )
    f.service.authorizeAssignment(a.id, f.human)
    f.input.mockReturnValue({ revision: 2, folderId: f.folderId, archived: false })
    await f.service.tick()
    expect(f.store.get('assignment', a.id).reason).toMatch(/input changed/)
    const next = {
      ...f.workflow,
      revision: 2,
      participants: f.workflow.participants.map((p) => ({ ...p, reasoning: 'high' })),
    }
    f.service.configure(next, 1, f.human)
    f.destinations[1]!.send = true
    const m = await f.send()
    await vi.waitFor(() => expect(f.store.get('message', m.id).deliveries[0]?.phase).toBe('held'))
    expect(f.deliver).not.toHaveBeenCalled()
  })
  it('requires the latest plan review and preserves delivered briefs when an idea changes', async () => {
    const f = fixture(),
      a = assignment(f),
      b = assignment(f, 1, [a.id])
    for (const item of [a, b]) {
      await f.service.execute(
        'propose_assignment',
        { operationId: randomUUID(), assignment: item },
        f.human,
      )
      f.service.authorizeAssignment(item.id, f.human)
    }
    await f.service.tick()
    const messageId = f.store.get('assignment', a.id).messageId!
    const original = f.store.get('message', messageId).body
    f.service.ideaChanged(f.spaceId, randomUUID(), 2, 'Add accessibility requirements')
    await f.service.tick()
    expect(f.store.get('assignment', b.id).reason).toMatch(/plan review/)
    await expect(
      f.service.execute(
        'review_plan',
        { operationId: randomUUID(), spaceId: f.spaceId, revision: 2, decisions: [] },
        f.human,
      ),
    ).rejects.toThrow('changed again')
    const review = {
      operationId: randomUUID(),
      spaceId: f.spaceId,
      revision: 1,
      decisions: [{ id: b.id, action: 'supersede', reason: 'Replace with accessibility review' }],
    }
    await f.service.execute('review_plan', review, f.human)
    await f.service.execute('review_plan', review, f.human)
    expect(f.store.get('assignment', b.id).state).toBe('superseded')
    expect(f.store.get('message', messageId).body).toBe(original)
  })
  it('coalesces project events and allows only the configured native coordinator to propose work', async () => {
    const f = fixture()
    f.service.configure(
      { ...f.workflow, revision: 2, mode: 'automatic', coordinator: f.a },
      1,
      f.human,
    )
    for (const body of ['First question', 'Second question'])
      await f.service.execute(
        'ask_question',
        { operationId: randomUUID(), spaceId: f.spaceId, body, audience: 'human' },
        f.peer(f.b),
      )
    await f.service.tick()
    await f.service.tick()
    expect(
      f.store.list('message').filter((m) => m.sender.startsWith('workflow-events:')),
    ).toHaveLength(1)
    const a = { ...assignment(f), workflowRevision: 2 }
    await expect(
      f.service.execute(
        'propose_assignment',
        { operationId: randomUUID(), assignment: a },
        f.peer(f.b),
      ),
    ).rejects.toThrow('coordinator')
    const op = { operationId: randomUUID(), assignment: a }
    await f.service.execute('propose_assignment', op, f.peer(f.a))
    await f.service.execute('propose_assignment', op, f.peer(f.a))
    expect(f.store.list('assignment')).toHaveLength(1)
  })
  it('requires a focused live request and fresh human text, rejects peers and duplicate responses', async () => {
    const f = fixture(),
      id = randomUUID()
    f.native.push({
      id,
      generation: id,
      target: f.b,
      kind: 'approval',
      title: 'Run command',
      startedAt: 900,
      expiresAt: 2000,
    })
    const input = { operationId: randomUUID(), id, generation: id, response: { action: 'allow' } }
    const agent: CommunicationActor = {
      id: 'agent',
      kind: 'agent',
      humanInput: { id: 'human-turn', text: 'Allow this action', at: 1000 },
    }
    await expect(f.service.execute('respond_native_request', input, agent)).rejects.toThrow(
      'explicit',
    )
    f.service.focusRequest(id, { ...f.human, conversationId: 'agent' })
    await expect(f.service.execute('respond_native_request', input, f.peer(f.a))).rejects.toThrow(
      'Peer',
    )
    await expect(
      f.service.execute('respond_native_request', input, {
        ...agent,
        humanInput: { id: 'human-turn', text: 'Do not allow it', at: 1000 },
      }),
    ).rejects.toThrow('explicit')
    await expect(
      f.service.execute('respond_native_request', input, {
        ...agent,
        humanInput: { id: 'human-turn', text: 'Should I allow this action?', at: 1000 },
      }),
    ).rejects.toThrow('explicit')
    await f.service.execute('respond_native_request', input, agent)
    await f.service.execute('respond_native_request', input, agent)
    expect(f.respondNative).toHaveBeenCalledTimes(1)
    f.native[0]!.generation = randomUUID()
    await expect(
      f.service.execute('respond_native_request', { ...input, operationId: randomUUID() }, agent),
    ).rejects.toThrow('no longer')
  })
  it.each([
    ['What does Blue mean?', 'Blue', false],
    ['Do not choose Blue', 'Blue', false],
    ['Do not choose option 2', 'Green', false],
    ['Choose Blue or Green', 'Blue', false],
    ['Blue?', 'Blue', false],
    ['Blue', 'Blue', true],
    ['Please choose Blue', 'Blue', true],
    ['Choose option 2', 'Green', true],
  ])('requires an explicit question answer from "%s"', async (text, answer, allowed) => {
    const f = fixture(),
      id = randomUUID()
    f.native.push({
      id,
      generation: id,
      target: f.b,
      kind: 'question',
      title: 'Choose colour',
      startedAt: 900,
      expiresAt: 2000,
      questions: [{ question: 'Colour?', options: [{ label: 'Blue' }, { label: 'Green' }] }],
    })
    f.service.focusRequest(id, { ...f.human, conversationId: 'agent' })
    const input = {
      operationId: randomUUID(),
      id,
      generation: id,
      response: { action: 'answer', answers: { 'Colour?': answer } },
    }
    const actor: CommunicationActor = {
      id: 'agent',
      kind: 'agent',
      humanInput: { id: 'human-turn', text, at: 1000 },
    }
    if (allowed) {
      await f.service.execute('respond_native_request', input, actor)
      expect(f.respondNative).toHaveBeenCalledTimes(1)
    } else {
      await expect(f.service.execute('respond_native_request', input, actor)).rejects.toThrow(
        'explicit',
      )
      expect(f.respondNative).not.toHaveBeenCalled()
    }
  })
  it('paginates retained history without leaking one-off messages to other conversations', async () => {
    const f = fixture()
    f.workflow.paused = true
    f.service.configure({ ...f.workflow, revision: 2 }, 1, f.human)
    for (let i = 0; i < 55; i++) await f.send()
    const first = f.service.history(f.human, f.spaceId)
    expect(first.messages).toHaveLength(50)
    const second = f.service.history(f.human, f.spaceId, first.nextBefore)
    expect(second.messages).toHaveLength(5)
    expect(new Set([...first.messages, ...second.messages].map((m) => m.id)).size).toBe(55)
  })
  it('imports uncertain composer receipts into the same writer gate and requires human reconciliation', async () => {
    const f = fixture(),
      id = randomUUID()
    const op = {
      id,
      target: f.b,
      text: 'Previous request',
      intent: 'send' as const,
      phase: 'unknown' as const,
      epoch: 'previous-runtime',
      updatedAt: 900,
    }
    f.service.importLegacy([op])
    f.service.importLegacy([op])
    f.destinations[1]!.send = true
    await f.send()
    await f.service.tick()
    expect(f.deliver).not.toHaveBeenCalled()
    expect(() =>
      f.service.reconcile(id, id, 'rejected', 'Native chat shows no turn', f.peer(f.a)),
    ).toThrow('Review')
    f.service.reconcile(id, id, 'rejected', 'Native chat inspected: request was rejected', f.human)
    await f.service.tick()
    await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledTimes(1))
  })
})

describe('Return routing and nonblocking questions', () => {
  it('returns a project reply to the originating front desk without requiring it to be a workflow worker', async () => {
    const f = fixture(),
      target = `codex:${randomUUID()}`,
      front: CommunicationActor = { id: 'front-desk', kind: 'agent', target }
    f.destinations.push({ ...f.destinations[1]!, id: target })
    const original = await f.send(front, [f.b])
    const reply = await f.send(f.peer(f.b), [target], {
      replyTo: original.id,
      kind: 'answer',
      body: 'Answer to the originating conversation',
    })
    expect(reply.deliveries[0]?.phase).toBe('inbox')
    expect(f.deliver).not.toHaveBeenCalled()
    const read = (await f.service.execute('get_message', { id: original.id }, front)) as {
      replies: CommunicationMessage[]
    }
    expect(read.replies.map((m) => m.id)).toContain(reply.id)
  })
  it('records reciprocal waits as attention instead of keeping either tool connection blocked', async () => {
    const f = fixture()
    await f.service.execute(
      'ask_question',
      { operationId: randomUUID(), spaceId: f.spaceId, body: 'Need B fact', audience: f.b },
      f.peer(f.a),
    )
    const second = (await f.service.execute(
      'ask_question',
      { operationId: randomUUID(), spaceId: f.spaceId, body: 'Need A fact', audience: f.a },
      f.peer(f.b),
    )) as { reason?: string }
    expect(second.reason).toMatch(/Reciprocal/)
    expect(f.store.list('question')).toHaveLength(2)
  })
  it('freezes the original recipient group for explicit group replies', async () => {
    const f = fixture(),
      original = await f.send(f.human, [f.a, f.b])
    const reply = await f.send(f.peer(f.b), [f.a], {
      replyTo: original.id,
      replyMode: 'group',
      kind: 'information',
    })
    expect(reply.rootId).toBe(original.rootId)
    await expect(
      f.send(f.human, [f.b], { replyTo: original.id, replyMode: 'group' }),
    ).rejects.toThrow('original group')
  })
})

describe('Writer ownership after asynchronous discovery', () => {
  it('does not dispatch a message cancelled during destination discovery', async () => {
    const f = fixture()
    f.destinations[1]!.send = true
    let release!: (destinations: Destination[]) => void
    f.lookup
      .mockImplementationOnce(async () => [f.destinations[1]!])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
    const message = await f.send()
    await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(2))
    await f.service.execute(
      'cancel_message',
      { id: message.id, operationId: randomUUID() },
      f.human,
    )
    release([f.destinations[1]!])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.deliver).not.toHaveBeenCalled()
    expect(f.store.get('message', message.id).deliveries[0]?.phase).toBe('cancelled')
  })
  it('does not race a composer writer acquired while discovery was in flight', async () => {
    const f = fixture()
    f.destinations[1]!.send = true
    let release!: (destinations: Destination[]) => void
    f.lookup
      .mockImplementationOnce(async () => [f.destinations[1]!])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
    await f.send()
    await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledTimes(2))
    expect(f.service.submitLegacy(f.b, 'Human composer request', () => ({ ok: true })).ok).toBe(
      true,
    )
    release([f.destinations[1]!])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.deliver).not.toHaveBeenCalled()
  })
})
