import { randomUUID } from 'node:crypto'
import { Duplex } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { PerplexityChatReader } from '../src/main/accountChats/adapters'
import { ReadRpc } from '../src/main/accountChats/rpc'
import { AccountChats } from '../src/main/accountChats/service'
import { AccountChatTransport } from '../src/main/communication/accountChatTransport'
import { CommunicationService } from '../src/main/communication/service'
import { CommunicationStore } from '../src/main/communication/store'
import { startSpaceChat, openSpaceProvider } from '../src/main/appControl/startSpaceChat'
import { defaultPaths } from '../src/main/sessions/paths'
import type { CommunicationActor, CommunicationMessage } from '../src/shared/communication'

it('creates a Perplexity chat, sends a scoped follow-up over the same framed connection and records the exact inbox reply', async () => {
  const uuid = randomUUID(),
    context = randomUUID(),
    spaceId = randomUUID(),
    openingId = randomUUID()
  let entry: Record<string, unknown> | undefined
  const sends: string[] = []
  const wire = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) {
      try {
        const request = JSON.parse(chunk.subarray(chunk.indexOf('\r\n\r\n') + 4).toString())
        const { id, method, params } = request
        const frame = (data: object) => {
          const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...data }))
          this.push(
            Buffer.concat([Buffer.from('Content-Length: ' + payload.length + '\r\n\r\n'), payload]),
          )
        }
        const notify = (payload: object) => frame({ method: params.onMessage, params: { payload } })
        if (method === 'threads_snapshot') {
          frame({
            id,
            result: { items: entry ? [{ contextUuid: context, threadStatus: 'completed' }] : [] },
          })
        } else if (method === 'native_transport_request_streaming') {
          const value = params.input.path.startsWith('/rest/thread/list_recent')
            ? entry
              ? [{ uuid, context_uuid: context, title: 'Unrelated title', variant: 'thread' }]
              : []
            : { status: 'success', has_next_page: false, entries: [entry] }
          frame({ id, result: { status: 200 } })
          notify({
            type: 'chunk',
            dataBase64: Buffer.from(JSON.stringify(value)).toString('base64'),
          })
          notify({ type: 'end' })
        } else if (method === 'session_ask' || method === 'session_followup') {
          const ask = JSON.parse(Buffer.from(params.body).toString())
          if (method === 'session_followup') {
            expect(ask.params.last_backend_uuid).toBe(entry?.backend_uuid)
            expect(ask.params.read_write_token).toBe('fixture-token')
          }
          expect(ask.params.frontend_context_uuid).toBe(openingId)
          const answer = method === 'session_followup' ? 'Scoped response' : 'Opening response'
          entry = {
            uuid: randomUUID(),
            backend_uuid: randomUUID(),
            context_uuid: context,
            frontend_context_uuid: openingId,
            query_str: ask.query_str,
            mode: 'concise',
            read_write_token: 'fixture-token',
            display_model: 'fixture',
            status: 'COMPLETED',
            blocks: [{ markdown_block: { answer } }],
          }
          sends.push(method)
          frame({ id, result: {} })
          notify({ type: 'open', status: 200 })
        } else throw Error('Unexpected RPC ' + method)
        done()
      } catch (error) {
        done(error as Error)
      }
    },
  })
  const reader: PerplexityChatReader = Reflect.construct(PerplexityChatReader, [
    new ReadRpc(wire, 'header'),
  ])
  const connect = vi.fn(async () => reader),
    chats = new AccountChats({
      contexts: async () => [],
      enabled: (s) => s === 'perplexity',
      connect,
    })
  const t = new AccountChatTransport(chats, { pollMs: 5, timeoutMs: 1000 }),
    db = new DatabaseSync(':memory:'),
    store = new CommunicationStore(db)
  const project = {
    root: 'workspace',
    paused: false,
    expiresAt: Date.now() + 60000,
    maxDispatches: 3,
  }
  const service = new CommunicationService(store, {
    destinations: (id, q) => t.find(id, q),
    authorize: () => {},
    deliver: (m, d, ack) => t.deliver(m, d, ack),
    input: () => {
      throw Error('No test inputs')
    },
    project: () => project,
  })
  const actor: CommunicationActor = {
    id: 'test-agent',
    kind: 'agent',
    target: 'codex:' + randomUUID(),
    spaceId,
  }
  try {
    expect((await chats.request({ action: 'list', source: 'perplexity' })).ok).toBe(true)
    const result = await startSpaceChat(
      {
        spaceId,
        provider: 'perplexity',
        role: 'Research',
        openingMessage: 'Open this conversation.',
      },
      openingId,
      {
        project: () => project,
        workflow: (id) => service.workflow(id),
        enabled: () => true,
        reserve: () => {},
        save: (w, r) => {
          service.configure(w, r, { id: 'human', kind: 'human' })
        },
        start: (input, root, id, beforeSend) =>
          openSpaceProvider(input, root, id, beforeSend, {
            chats,
            paths: defaultPaths(),
            claude: async () => null,
          }),
      },
    )
    expect(result).toMatchObject({ outcome: 'ok', target: 'perplexity:' + uuid, linked: true })
    expect(
      await service.execute('get_destination', { spaceId, query: 'Perplexity' }, actor),
    ).toMatchObject([{ id: result.target, send: true }])
    const sent = (await service.execute(
      'send_message',
      {
        operationId: randomUUID(),
        spaceId,
        targets: [result.target],
        body: 'Return a scoped response.',
        intent: 'send',
      },
      actor,
    )) as CommunicationMessage
    await service.tick()
    await vi.waitFor(async () => {
      const record = await service.execute('get_message', { id: sent.id }, actor)
      expect(record).toMatchObject({
        replies: [
          {
            replyTo: sent.id,
            senderTarget: result.target,
            body: 'Scoped response',
            deliveries: [{ target: actor.target, phase: 'inbox' }],
          },
        ],
      })
    })
    const inbox = await service.execute('read_inbox', { spaceId }, actor)
    expect(inbox).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          replyTo: sent.id,
          senderTarget: result.target,
          body: 'Scoped response',
        }),
      ]),
    })
    expect(connect).toHaveBeenCalledOnce()
    expect(sends).toEqual(['session_ask', 'session_followup'])
  } finally {
    service.close()
    t.close()
    chats.close()
    db.close()
  }
})
