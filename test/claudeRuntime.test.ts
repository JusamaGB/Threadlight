import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunicationStore } from '../src/main/communication/store'
import { CommunicationService } from '../src/main/communication/service'
import {
  ClaudeRuntimeInbox,
  CLAUDE_INBOX_PROBED_HASH,
} from '../src/main/communication/claudeRuntime'
import type {
  CommunicationActor,
  CommunicationMessage,
  Destination,
} from '../src/shared/communication'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
})
function fixture(testMode = true) {
  const db = new DatabaseSync(':memory:'),
    store = new CommunicationStore(db)
  const target = randomUUID(),
    space = randomUUID(),
    generation: string = randomUUID()
  let revoked = false,
    now = Date.now()
  const actor: CommunicationActor = {
    id: `participant:${space}:${target}`,
    kind: 'participant',
    target,
    spaceId: space,
    runtimeGeneration: generation,
  }
  const authenticate = () => {
    if (revoked) throw new Error('Revoked')
    return actor
  }
  const identity = {
    pid: 12,
    start: '100',
    executable: 'claude.exe',
    hash: CLAUDE_INBOX_PROBED_HASH,
  }
  const pipe = { inspect: vi.fn(async () => ({ ...identity })), write: vi.fn() }
  const runtime = new ClaudeRuntimeInbox(store, pipe, testMode, () => now)
  const service = new CommunicationService(store, {
    destinations: async () => [],
    deliver: async () => ({ reply: '' }),
    authorize: () => {
      if (revoked) throw new Error('Revoked')
    },
    input: () => ({ revision: 1, folderId: randomUUID(), archived: false }),
    project: () => ({ paused: false, expiresAt: Date.now() + 1000000, maxDispatches: 20 }),
  })
  service.configure(
    {
      id: randomUUID(),
      spaceId: space,
      revision: 1,
      mode: 'manual',
      paused: false,
      participants: [
        {
          id: randomUUID(),
          target,
          role: 'Build',
          model: 'test',
          communicate: true,
          requestWork: true,
        },
      ],
      maxConcurrent: 1,
      maxDispatches: 20,
      expiresAt: Date.now() + 1000000,
      recover: false,
      acceptBy: 'human',
    },
    0,
    { id: 'human', kind: 'human' },
  )
  const message: CommunicationMessage = {
    id: randomUUID(),
    operationId: randomUUID(),
    rootId: randomUUID(),
    sender: 'human',
    senderKind: 'human',
    kind: 'request',
    body: 'Do this once',
    at: now,
    deliveries: [
      {
        target,
        phase: 'submitting',
        transport: 'claude-runtime-inbox',
        attemptId: randomUUID(),
        generation,
        reason: '',
        observedAt: now,
      },
    ],
  }
  store.transaction(() => store.put('message', message, 'Test delivery'))
  const input = { id: message.id, attemptId: message.deliveries[0]!.attemptId, generation }
  const register = async (connection = 'connection') => {
    const result = await runtime.register(connection, authenticate, {
      socket: 'pipe',
      token: 'test-token-123456',
    })
    actor.runtimeGeneration = result.generation
    input.generation = result.generation
    message.deliveries[0]!.generation = result.generation
    store.transaction(() => store.put('message', message, 'Runtime bound'))
    return result
  }
  cleanups.push(() => {
    runtime.close()
    service.close()
    db.close()
  })
  return {
    db,
    store,
    service,
    runtime,
    pipe,
    identity,
    actor,
    authenticate,
    message,
    input,
    register,
    target,
    space,
    revoke: () => {
      revoked = true
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}
describe('recipient claims and completion', () => {
  it('grants exactly one execution and records one immutable completion and reply', async () => {
    const f = fixture()
    const first = (await f.service.execute('claim_delivery', f.input, f.actor)) as {
      status: string
      claimId: string
    }
    expect(first.status).toBe('claimed')
    expect(await f.service.execute('claim_delivery', f.input, f.actor)).toEqual({
      status: 'already_claimed',
      claimId: first.claimId,
    })
    const completion = { ...f.input, claimId: first.claimId, body: 'Finished once' }
    await f.service.execute('complete_delivery', completion, f.actor)
    await f.service.execute('complete_delivery', completion, f.actor)
    expect(f.store.list('message').filter((m) => m.replyTo === f.message.id)).toHaveLength(1)
    expect(f.store.get('message', f.message.id).deliveries[0]!.phase).toBe('completed')
    await expect(
      f.service.execute('complete_delivery', { ...completion, body: 'Different' }, f.actor),
    ).rejects.toThrow('different content')
    expect(
      ((await f.service.execute('claim_delivery', f.input, f.actor)) as { status: string }).status,
    ).toBe('completed')
  })
  it('rejects forged actor, recipient, generation, attempt and claim identity', async () => {
    const f = fixture()
    for (const actor of [
      { ...f.actor, runtimeGeneration: undefined },
      { ...f.actor, target: randomUUID() },
      { ...f.actor, kind: 'human' as const },
    ])
      await expect(f.service.execute('claim_delivery', f.input, actor)).rejects.toThrow()
    for (const input of [
      { ...f.input, generation: randomUUID() },
      { ...f.input, attemptId: randomUUID() },
    ])
      await expect(f.service.execute('claim_delivery', input, f.actor)).rejects.toThrow()
    await f.service.execute('claim_delivery', f.input, f.actor)
    await expect(
      f.service.execute(
        'complete_delivery',
        { ...f.input, claimId: randomUUID(), body: 'Forged' },
        f.actor,
      ),
    ).rejects.toThrow('claim')
  })
  it('keeps a claimed attempt uncertain across restart without granting new execution', async () => {
    const f = fixture()
    const result = (await f.service.execute('claim_delivery', f.input, f.actor)) as {
      claimId: string
    }
    new CommunicationStore(f.db)
    expect(f.store.get('message', f.message.id).deliveries[0]!.phase).toBe('unknown')
    expect(
      ((await f.service.execute('claim_delivery', f.input, f.actor)) as { status: string }).status,
    ).toBe('already_claimed')
    await expect(
      f.service.execute(
        'complete_delivery',
        { ...f.input, claimId: result.claimId, body: 'Late' },
        f.actor,
      ),
    ).rejects.toThrow('uncertain')
  })
  it('rejects revoked recipients and new claims after project pause', async () => {
    const f = fixture()
    const { eventCursor: _cursor, ...w } = f.service.workflow(f.space)!
    f.service.configure({ ...w, paused: true, revision: 2 }, 1, { id: 'human', kind: 'human' })
    f.message.spaceId = f.space
    f.store.transaction(() => f.store.put('message', f.message, 'Project-bound'))
    await expect(f.service.execute('claim_delivery', f.input, f.actor)).rejects.toThrow('authority')
    f.revoke()
    await expect(f.service.execute('claim_delivery', f.input, f.actor)).rejects.toThrow('Revoked')
  })
})
describe('Claude runtime registration and delivery', () => {
  it('does not resurrect a registration disabled while identity verification is pending', async () => {
    const f = fixture()
    let release!: (value: typeof f.identity) => void
    f.pipe.inspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const registering = f.runtime.register('connection', f.authenticate, {
      socket: 'pipe',
      token: 'test-token-123456',
    })
    const rejected = expect(registering).rejects.toThrow('changed')
    f.runtime.unregister('connection')
    release(f.identity)
    await rejected
    expect(await f.runtime.destination(f.target)).toBeUndefined()
  })
  it('does not write if registration is revoked during delivery discovery', async () => {
    const f = fixture()
    await f.register()
    const destination = { id: f.target, ...(await f.runtime.destination(f.target)) } as Destination
    let release!: (value: typeof f.identity) => void
    f.pipe.inspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const result = f.runtime.deliver(f.message, destination, vi.fn())
    const rejected = expect(result).rejects.toThrow('changed')
    f.runtime.unregister('connection')
    release(f.identity)
    await rejected
    expect(f.pipe.write).not.toHaveBeenCalled()
  })
  it('keeps production gated until Desktop sign-off', async () => {
    const f = fixture(false),
      registration = await f.register()
    expect(registration.enabled).toBe(false)
    expect((await f.runtime.destination(f.target))!.send).toBe(false)
  })
  it('renews the same generation but rotates it after lease expiry or native restart', async () => {
    const f = fixture(),
      first = await f.register()
    expect((await f.register()).generation).toBe(first.generation)
    f.advance(46000)
    expect(await f.runtime.destination(f.target)).toBeUndefined()
    const next = await f.register()
    expect(next.generation).not.toBe(first.generation)
    f.identity.start = '101'
    expect((await f.register()).generation).not.toBe(next.generation)
  })
  it('rejects untested binaries, ambiguous enrollment and revoked capabilities', async () => {
    const f = fixture()
    await f.register()
    await f.register('other')
    expect((await f.runtime.destination(f.target))!.send).toBe(false)
    expect(f.runtime.actor('connection', f.actor).runtimeGeneration).toBeUndefined()
    f.runtime.unregister('other')
    f.identity.hash = 'unverified'
    await expect(f.register()).rejects.toThrow('verification')
    expect((await f.runtime.destination(f.target))!.send).toBe(false)
    f.revoke()
    expect(await f.runtime.destination(f.target)).toBeUndefined()
  })
  it('does not acknowledge a socket write; resolves only a correlated claim and completion', async () => {
    const f = fixture()
    await f.register()
    const capability = await f.runtime.destination(f.target)
    const destination = { id: f.target, ...capability } as Destination
    const accepted = vi.fn(),
      result = f.runtime.deliver(f.message, destination, accepted)
    await vi.waitFor(() => expect(f.pipe.write).toHaveBeenCalledOnce())
    expect(accepted).not.toHaveBeenCalled()
    const claim = (await f.service.execute('claim_delivery', f.input, f.actor)) as {
      claimId: string
    }
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce())
    await f.service.execute(
      'complete_delivery',
      { ...f.input, claimId: claim.claimId, body: 'Done' },
      f.actor,
    )
    await expect(result).resolves.toEqual({ reply: 'Done' })
    const payload = f.pipe.write.mock.calls[0] as unknown as [string, unknown, string]
    expect(payload[2]).not.toContain('Do this once')
    expect(payload[2]).toContain(f.message.id)
  })
  it('does not resend on missing acknowledgement and invalidates a lost lease', async () => {
    const f = fixture()
    await f.register()
    const destination = { id: f.target, ...(await f.runtime.destination(f.target)) } as Destination
    const result = f.runtime.deliver(f.message, destination, vi.fn())
    const rejected = expect(result).rejects.toThrow('disconnected')
    await vi.waitFor(() => expect(f.pipe.write).toHaveBeenCalledOnce())
    f.advance(46000)
    await rejected
    expect(f.pipe.write).toHaveBeenCalledOnce()
  })
})
