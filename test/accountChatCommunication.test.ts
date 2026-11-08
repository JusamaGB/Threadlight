import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { AccountChats } from '../src/main/accountChats/service'
import type { ChatReader } from '../src/main/accountChats/adapters'
import {
  AccountChatTransport,
  accountChatReply,
} from '../src/main/communication/accountChatTransport'
import { CommunicationService } from '../src/main/communication/service'
import { CommunicationStore } from '../src/main/communication/store'
import type { CommunicationMessage, Workflow } from '../src/shared/communication'
import { communicationTarget } from '../src/shared/communicationTargets'
import type { ChatMessage, ChatSource } from '../src/shared/accountChats'

function fixture(source: ChatSource = 'chatgpt') {
  const id = randomUUID(),
    caller = randomUUID(),
    operation = randomUUID()
  let messages: ChatMessage[] = [
    { id: 'old', role: 'assistant', text: 'Unrelated old reply', truncated: false },
  ]
  let finish = true
  const reader: ChatReader = {
    list: vi.fn(async () => ({
      chats: [{ id, title: 'Test chat', updatedAt: null }],
      cursor: null,
      recentOnly: true,
    })),
    read: vi.fn(async () => ({
      messages,
      cursor: null,
      limited: false,
      canSend: true,
      activity: 'idle' as const,
    })),
    send: vi.fn(async (_id, text) => {
      messages = [...messages, { id: 'prompt', role: 'user', text, truncated: false }]
      if (finish)
        messages.push({
          id: 'answer',
          role: 'assistant',
          text: 'A bounded research result',
          truncated: false,
        })
    }),
    close: vi.fn(),
  }
  const chats = new AccountChats({
    contexts: async () => [{ id: caller, title: 'Work context' }],
    connect: async () => reader,
    enabled: (s) => s === source,
  })
  const transport = new AccountChatTransport(chats, { pollMs: 1, timeoutMs: 30 })
  const message: CommunicationMessage = {
    id: randomUUID(),
    operationId: operation,
    rootId: operation,
    sender: `codex:${caller}`,
    senderTarget: `codex:${caller}`,
    senderKind: 'participant',
    kind: 'request',
    body: 'Think through the design.',
    at: Date.now(),
    deliveries: [
      {
        target: `${source}:${id}`,
        phase: 'queued',
        reason: '',
        attemptId: randomUUID(),
        observedAt: Date.now(),
      },
    ],
  }
  return {
    id,
    caller,
    reader,
    chats,
    transport,
    message,
    finish: (value: boolean) => {
      finish = value
    },
  }
}

describe('Shared communication account-chat transport', () => {
  it('lists Perplexity by provider even when the chat title does not name it', async () => {
    const f = fixture('perplexity')
    expect((await f.transport.find(undefined, ' Perplexity ')).map((d) => d.id)).toEqual([
      `perplexity:${f.id}`,
    ])
    expect(await f.transport.find(undefined, 'no such title')).toEqual([])
    await expect(f.transport.find(undefined, 'ChatGPT')).rejects.toThrow('Chat providers shown')
  })
  it.each(['chatgpt', 'perplexity'] as const)(
    'uses %s identity, correlates a reply, and retains no model/workspace fiction',
    async (source) => {
      const f = fixture(source)
      try {
        const rows = await f.transport.find()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          id: `${source}:${f.id}`,
          provider: source,
          workspace: '',
          capabilities: { memoryTools: false, observedReplies: true, workspace: false },
        })
        const destination = (await f.transport.find(`${source}:${f.id}`))[0]!
        expect(destination.send).toBe(true)
        const accepted = vi.fn()
        expect(await f.transport.deliver(f.message, destination, accepted)).toEqual({
          reply: 'A bounded research result',
        })
        expect(await f.chats.request({ action: 'list', source, poll: true })).toMatchObject({
          sharedDelivery: { source, failed: false, sequence: 1 },
        })
        expect(accepted).toHaveBeenCalledOnce()
        expect(f.reader.send).toHaveBeenCalledOnce()
        // Reusing an attempt never causes a second model generation.
        await expect(f.transport.deliver(f.message, destination, accepted)).rejects.toThrow(
          'without a confirmed result',
        )
        expect(await f.chats.request({ action: 'list', source, poll: true })).toMatchObject({
          sharedDelivery: { source, failed: true, sequence: 2 },
        })
        expect(f.reader.send).toHaveBeenCalledOnce()
      } finally {
        f.transport.close()
        f.chats.close()
      }
    },
  )

  it('refuses changed connections before a send and never substitutes a same-UUID provider', async () => {
    const f = fixture()
    try {
      const destination = (await f.transport.find(`chatgpt:${f.id}`))[0]!
      expect(await f.transport.find(`perplexity:${f.id}`)).toEqual([])
      await f.chats.request({ action: 'disconnect', source: 'chatgpt' })
      await expect(f.transport.deliver(f.message, destination, vi.fn())).rejects.toMatchObject({
        deliveryRejected: true,
      })
      expect(f.reader.send).not.toHaveBeenCalled()
    } finally {
      f.transport.close()
      f.chats.close()
    }
  })

  it('blocks the human composer while collecting a reply and reports uncertainty without a resend', async () => {
    const f = fixture()
    f.finish(false)
    try {
      const destination = (await f.transport.find(`chatgpt:${f.id}`))[0]!
      const result = f.transport
        .deliver(f.message, destination, vi.fn())
        .catch((error: Error) => error)
      await vi.waitFor(() => expect(f.reader.send).toHaveBeenCalledOnce(), { interval: 1 })
      expect(
        await f.chats.request({
          action: 'send',
          source: 'chatgpt',
          id: f.id,
          operationId: randomUUID(),
          message: 'Competing send',
        }),
      ).toMatchObject({ ok: false, reason: expect.stringContaining('shared-space') })
      expect(await result).toBeInstanceOf(Error)
      expect(f.reader.send).toHaveBeenCalledOnce()
    } finally {
      f.transport.close()
      f.chats.close()
    }
  })

  it('does not confuse old, partial, busy, or intervening answers with a completed result', () => {
    const prompt: ChatMessage = { id: 'p', role: 'user', text: 'exact prompt', truncated: false }
    const answer: ChatMessage = { id: 'a', role: 'assistant', text: 'answer', truncated: false }
    const page = {
      id: randomUUID(),
      hasMore: false,
      limited: false,
      activity: 'idle' as const,
      messages: [prompt, answer],
    }
    expect(accountChatReply(page, 'different prompt', new Set())).toBeUndefined()
    expect(accountChatReply(page, prompt.text, new Set(['p', 'a']))).toBeUndefined()
    expect(
      accountChatReply({ ...page, activity: 'active' }, prompt.text, new Set()),
    ).toBeUndefined()
    expect(() =>
      accountChatReply(
        { ...page, messages: [prompt, { ...answer, truncated: true }] },
        prompt.text,
        new Set(),
      ),
    ).toThrow('completely')
    expect(() =>
      accountChatReply(
        {
          ...page,
          messages: [prompt, answer, { ...prompt, id: 'other', text: 'another question' }],
        },
        prompt.text,
        new Set(),
      ),
    ).toThrow('Another message')
    expect(accountChatReply(page, prompt.text, new Set())).toBe('answer')
  })

  it.each(['chatgpt', 'perplexity'] as const)(
    'passes a shared-space journal request through %s and returns its correlated inbox result',
    async (source) => {
      const f = fixture(source),
        db = new DatabaseSync(':memory:'),
        store = new CommunicationStore(db)
      const spaceId = randomUUID(),
        work = f.message.senderTarget!,
        target = `${source}:${f.id}`
      const service = new CommunicationService(store, {
        destinations: (id, query) => f.transport.find(id, query),
        deliver: (m, d, accepted) => f.transport.deliver(m, d, accepted),
        authorize: () => {},
        input: () => ({ revision: 1, folderId: randomUUID(), archived: false }),
        project: () => ({
          root: '/actual-work-project',
          paused: false,
          expiresAt: Date.now() + 60000,
          maxDispatches: 5,
        }),
      })
      const workflow: Workflow = {
        id: randomUUID(),
        spaceId,
        revision: 1,
        mode: 'manual',
        paused: false,
        participants: [
          {
            id: randomUUID(),
            target: work,
            role: 'Build',
            model: 'build-model',
            communicate: true,
            requestWork: true,
          },
          {
            id: randomUUID(),
            target,
            role: 'Think',
            model: 'Current native model',
            modelPolicy: 'current',
            communicate: true,
            requestWork: false,
          },
        ],
        maxConcurrent: 1,
        maxDispatches: 5,
        expiresAt: Date.now() + 60000,
        recover: false,
        acceptBy: 'human',
      }
      try {
        service.configure(workflow, 0, { id: 'human', kind: 'human' })
        expect(() =>
          service.configure({ ...workflow, revision: 2, coordinator: target }, 1, {
            id: 'human',
            kind: 'human',
          }),
        ).toThrow('cannot coordinate')
        expect(() =>
          service.configure(
            {
              ...workflow,
              revision: 2,
              participants: workflow.participants.map((p) =>
                p.target === work ? { ...p, modelPolicy: 'current' as const } : p,
              ),
            },
            1,
            { id: 'human', kind: 'human' },
          ),
        ).toThrow('exact model')
        const actor = { id: 'enrolled-work', kind: 'participant' as const, target: work, spaceId }
        const input = {
          operationId: randomUUID(),
          targets: [target],
          spaceId,
          body: 'Compare two approaches.',
          intent: 'send',
        }
        const found = await service.execute('get_destination', { spaceId, query: source }, actor)
        expect(found).toMatchObject([{ id: target, participant: { role: 'Think' } }])
        const sent = (await service.execute('send_message', input, actor)) as CommunicationMessage
        await service.tick()
        await vi.waitFor(() =>
          expect(store.get('message', sent.id).deliveries[0]?.phase).toBe('completed'),
        )
        const record = (await service.execute('get_message', { id: sent.id }, actor)) as {
          replies: CommunicationMessage[]
        }
        expect(record.replies).toHaveLength(1)
        expect(record.replies[0]).toMatchObject({
          replyTo: sent.id,
          senderTarget: target,
          body: 'A bounded research result',
          deliveries: [{ target: work, phase: 'inbox' }],
        })
        await service.execute('send_message', input, actor)
        await service.tick()
        expect(f.reader.send).toHaveBeenCalledOnce()
        await expect(
          service.execute(
            'send_message',
            { ...input, operationId: randomUUID(), targets: [`perplexity:${randomUUID()}`] },
            actor,
          ),
        ).rejects.toThrow('not in the project')
        service.configure(
          {
            ...workflow,
            revision: 2,
            participants: workflow.participants.map((p) =>
              p.target === target ? { ...p, communicate: false } : p,
            ),
          },
          1,
          { id: 'human', kind: 'human' },
        )
        await expect(
          service.execute('send_message', { ...input, operationId: randomUUID() }, actor),
        ).rejects.toThrow('disabled')
      } finally {
        service.close()
        f.transport.close()
        f.chats.close()
        db.close()
      }
    },
  )

  it('keeps legacy identities and rejects arbitrary provider names', () => {
    const id = randomUUID()
    for (const target of [id, `codex:${id}`, `chatgpt:${id}`, `perplexity:${id}`])
      expect(communicationTarget.safeParse(target).success).toBe(true)
    for (const target of [`unknown:${id}`, 'chatgpt:../chat', `chatgpt:codex:${id}`])
      expect(communicationTarget.safeParse(target).success).toBe(false)
  })
})
