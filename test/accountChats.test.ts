import { Duplex } from 'node:stream'
import { describe, it, expect, vi } from 'vitest'
import { AccountChats } from '../src/main/accountChats/service'
import { ReadRpc } from '../src/main/accountChats/rpc'
import {
  parseChatGPTList,
  parseChatGPTRead,
  parsePerplexityList,
  parsePerplexityRead,
  type ChatReader,
} from '../src/main/accountChats/adapters'
import { chatCommand, chatLink, visibleAccountChats } from '../src/shared/accountChats'
import { perplexityContent } from '../src/main/accountChats/richContent'
import { parseSettings, validatePatch } from '../src/shared/settings'
import { ChatDelivery } from '../src/main/accountChats/delivery'
import { ChatRateLimited, CHAT_RATE_LIMITED } from '../src/main/accountChats/rpc'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const caller = '01a18a38-bbc1-7e70-9374-10f945d6a372'
const id = '6aeaea26-2338-83ed-a05f-4a2bb9018ff3'
const other = '6aeae6a2-64f0-83ed-ad71-d54499d93c06'
const summary = { id, title: 'Example', updatedAt: null }
function fixture() {
  const reader: ChatReader = {
    list: vi.fn(async () => ({ chats: [summary], cursor: 'next-list', recentOnly: false })),
    read: vi.fn(async () => ({
      messages: [{ id: 'message', role: 'assistant' as const, text: 'Example', truncated: false }],
      cursor: 'older',
      limited: false,
    })),
    close: vi.fn(),
  }
  const deps = {
    contexts: vi.fn(async () => [{ id: caller, title: 'Local context' }]),
    connect: vi.fn(async () => reader),
    enabled: vi.fn(() => true),
  }
  return { service: new AccountChats(deps), reader, deps }
}
describe('read-only account chat boundary', () => {
  it('uses the existing Perplexity connection and checks for disconnect before submitting', async () => {
    const { service, reader, deps } = fixture()
    await service.request({ action: 'list', source: 'perplexity' })
    let dispatch: (() => void) | undefined
    let finish: ((id: string) => void) | undefined
    reader.create = vi.fn(async (_message, _id, before) => {
      dispatch = before
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    })
    const reserve = vi.fn()
    const opening = service.createPerplexityChat('test', id, reserve)
    expect(deps.connect).toHaveBeenCalledOnce()
    await expect(service.createPerplexityChat('another', other, reserve)).rejects.toThrow('busy')
    await service.request({ action: 'disconnect', source: 'perplexity' })
    expect(() => dispatch!()).toThrow('unavailable')
    expect(reserve).not.toHaveBeenCalled()
    finish!(id)
    await opening
    service.close()
  })
  it('backs off native rate limits without clearing a valid reader or retrying a send', async () => {
    const { service, reader } = fixture()
    await service.request({ action: 'list', source: 'chatgpt' })
    vi.mocked(reader.read).mockRejectedValueOnce(new ChatRateLimited())
    const command = { action: 'read', source: 'chatgpt', id }
    const limited = await service.request(command)
    expect(limited).toMatchObject({
      ok: false,
      reason: CHAT_RATE_LIMITED,
      retryAt: expect.any(Number),
    })
    expect(await service.request(command)).toEqual(limited)
    expect(reader.read).toHaveBeenCalledOnce()
    expect(reader.close).not.toHaveBeenCalled()
    expect(service.catalog('chatgpt')).toHaveLength(1)
    service.close()
  })
  it('retains the last list through cooldown and recovers on a later poll without reconnecting', async () => {
    const { service, reader, deps } = fixture()
    const command = { action: 'list', source: 'chatgpt', poll: true }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      await service.request(command)
      vi.mocked(reader.list).mockRejectedValueOnce(new ChatRateLimited())
      expect(await service.request(command)).toEqual({
        ok: false,
        reason: CHAT_RATE_LIMITED,
        retryAt: 61000,
      })
      clock.mockReturnValue(60999)
      expect(await service.request(command)).toEqual({
        ok: false,
        reason: CHAT_RATE_LIMITED,
        retryAt: 61000,
      })
      expect(reader.list).toHaveBeenCalledTimes(2)
      expect(service.catalog('chatgpt')).toHaveLength(1)
      clock.mockReturnValue(61000)
      expect(await service.request(command)).toMatchObject({ ok: true, kind: 'list' })
      expect(deps.connect).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
      service.close()
    }
  })
  it('spaces recurring rate limits even after a successful head poll and honours longer provider delays', async () => {
    const { service, reader } = fixture()
    const poll = { action: 'list', source: 'chatgpt', poll: true }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      vi.mocked(reader.list).mockRejectedValueOnce(new ChatRateLimited())
      expect(await service.request(poll)).toMatchObject({ retryAt: 61000 })
      clock.mockReturnValue(61000)
      expect(await service.request(poll)).toMatchObject({ ok: true })
      clock.mockReturnValue(121000)
      vi.mocked(reader.list).mockRejectedValueOnce(new ChatRateLimited())
      expect(await service.request(poll)).toMatchObject({ retryAt: 241000 })
      clock.mockReturnValue(240999)
      expect(await service.request(poll)).toMatchObject({ retryAt: 241000 })
      expect(reader.list).toHaveBeenCalledTimes(3)
      clock.mockReturnValue(241000)
      vi.mocked(reader.list).mockRejectedValueOnce(new ChatRateLimited(1800000))
      expect(await service.request(poll)).toMatchObject({ retryAt: 2041000 })
      clock.mockReturnValue(5000000)
      vi.mocked(reader.list).mockRejectedValueOnce(new ChatRateLimited())
      expect(await service.request(poll)).toMatchObject({ retryAt: 5060000 })
    } finally {
      clock.mockRestore()
      service.close()
    }
  })
  it('coalesces simultaneous head polls from the panel and account destination lookup', async () => {
    const { service, reader } = fixture()
    const poll = { action: 'list', source: 'chatgpt', poll: true }
    const [a, b] = await Promise.all([service.request(poll), service.request(poll)])
    expect(a).toMatchObject({ ok: true, kind: 'list' })
    expect(a).toEqual(b)
    expect(reader.list).toHaveBeenCalledOnce()
    service.close()
  })
  it('polls without invalidating known chats or older-message cursors', async () => {
    const { service, reader, deps } = fixture()
    await service.request({ action: 'list', source: 'chatgpt' })
    await service.request({ action: 'read', source: 'chatgpt', id })
    await service.request({ action: 'list', source: 'chatgpt', poll: true })
    await service.request({ action: 'read', source: 'chatgpt', id, latest: true })
    await service.request({ action: 'read', source: 'chatgpt', id, older: true })
    expect(reader.read).toHaveBeenLastCalledWith(id, 'older')
    expect(deps.connect).toHaveBeenCalledTimes(1)
  })
  it('sends an explicit reply once, checks capability and activity, and replays only the receipt', async () => {
    const { service, reader } = fixture()
    reader.send = vi.fn(async () => {})
    vi.mocked(reader.read).mockResolvedValue({
      messages: [],
      cursor: null,
      limited: false,
      canSend: true,
      activity: 'idle',
    })
    await service.request({ action: 'list', source: 'chatgpt' })
    const command = {
      action: 'send',
      source: 'chatgpt',
      id,
      operationId: other,
      message: 'A typed reply',
    }
    expect(await service.request(command)).toMatchObject({ ok: true, kind: 'sent' })
    expect(await service.request(command)).toMatchObject({ ok: true, kind: 'sent' })
    expect(reader.send).toHaveBeenCalledExactlyOnceWith(id, 'A typed reply')
    expect((await service.request({ ...command, message: 'Different text' })).ok).toBe(false)
    await service.request({ action: 'list', source: 'chatgpt' })
    vi.mocked(reader.read).mockResolvedValue({
      messages: [],
      cursor: null,
      limited: false,
      canSend: true,
      activity: 'active',
    })
    expect((await service.request({ ...command, operationId: caller })).ok).toBe(false)
    expect(reader.send).toHaveBeenCalledTimes(1)
  })
  it('persists uncertain delivery across restart and requires an explicit checked action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadlight-chat-delivery-'))
    try {
      const { reader, deps } = fixture()
      reader.send = vi.fn(async () => {
        throw new Error('Connection ended')
      })
      vi.mocked(reader.read).mockResolvedValue({
        messages: [],
        cursor: null,
        limited: false,
        canSend: true,
      })
      const delivery = new ChatDelivery(join(root, 'receipts.json'))
      const service = new AccountChats({ ...deps, delivery })
      await service.request({ action: 'list', source: 'chatgpt' })
      const command = {
        action: 'send',
        source: 'chatgpt',
        id,
        operationId: other,
        message: 'Keep this draft',
      }
      expect((await service.request(command)).ok).toBe(false)
      const restarted = new AccountChats({
        ...deps,
        delivery: new ChatDelivery(join(root, 'receipts.json')),
      })
      await restarted.request({ action: 'list', source: 'chatgpt' })
      expect(await restarted.request({ action: 'read', source: 'chatgpt', id })).toMatchObject({
        page: { deliveryUncertain: true },
      })
      expect((await restarted.request({ ...command, operationId: caller })).ok).toBe(false)
      expect(reader.send).toHaveBeenCalledTimes(1)
      await restarted.request({ action: 'list', source: 'chatgpt' })
      expect(
        (await restarted.request({ action: 'confirm-delivery', source: 'chatgpt', id })).ok,
      ).toBe(true)
      expect(await restarted.request({ action: 'read', source: 'chatgpt', id })).toMatchObject({
        page: { deliveryUncertain: false },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('automatically selects a real local context, and refuses connection when none exists', async () => {
    const { service, deps } = fixture()
    expect((await service.request({ action: 'list', source: 'chatgpt' })).ok).toBe(true)
    expect(deps.connect).toHaveBeenCalledWith('chatgpt', caller)
    deps.contexts.mockResolvedValue([])
    expect((await service.request({ action: 'list', source: 'chatgpt' })).ok).toBe(false)
    expect(deps.connect).toHaveBeenCalledTimes(1)
  })
  it('rejects mutation, raw routes/tools, injected callers, unknown IDs and cursors', async () => {
    const { service, deps } = fixture()
    for (const command of [
      { action: 'send', source: 'chatgpt', id, message: 'test' },
      { action: 'read', source: 'chatgpt', id, tool: 'send_message_to_thread' },
      { action: 'list', source: 'perplexity', path: '/rest/delete' },
      { action: 'list', source: 'chatgpt', callerId: other },
      { action: 'read', source: 'perplexity', id },
      { action: 'list', source: 'perplexity', cursor: 'untrusted' },
    ])
      expect((await service.request(command)).ok).toBe(false)
    expect(deps.connect).not.toHaveBeenCalled()
    expect(chatCommand.safeParse({ action: 'cancel', source: 'perplexity' }).success).toBe(false)
  })
  it('binds a real context and keeps history cursors in main, separate from list paging', async () => {
    const { service, reader, deps } = fixture()
    expect(
      (await service.request({ action: 'list', source: 'chatgpt', callerId: caller })).ok,
    ).toBe(true)
    expect(deps.connect).toHaveBeenCalledWith('chatgpt', caller)
    expect((await service.request({ action: 'read', source: 'chatgpt', id })).ok).toBe(true)
    vi.mocked(reader.read).mockResolvedValueOnce({ messages: [], cursor: null, limited: false })
    expect((await service.request({ action: 'read', source: 'chatgpt', id, older: true })).ok).toBe(
      true,
    )
    expect(reader.read).toHaveBeenLastCalledWith(id, 'older')
    vi.mocked(reader.list).mockResolvedValueOnce({
      chats: [{ ...summary, id: other }, summary],
      cursor: null,
      recentOnly: false,
    })
    expect(await service.request({ action: 'list', source: 'chatgpt', more: true })).toMatchObject({
      ok: true,
      kind: 'list',
      chats: [{ id: other }],
      hasMore: false,
    })
    expect(reader.list).toHaveBeenLastCalledWith('next-list')
    service.close()
  })
  it('does not let a discovered Perplexity ID read ChatGPT or survive disconnect', async () => {
    const { service, reader } = fixture()
    await service.request({ action: 'list', source: 'perplexity' })
    expect((await service.request({ action: 'read', source: 'chatgpt', id })).ok).toBe(false)
    await service.request({ action: 'disconnect', source: 'perplexity' })
    expect((await service.request({ action: 'read', source: 'perplexity', id })).ok).toBe(false)
    expect(reader.read).not.toHaveBeenCalled()
  })
  it('rejects stale context, disabled sources and repeated history cursors', async () => {
    const { service, reader, deps } = fixture()
    await service.request({ action: 'list', source: 'chatgpt', callerId: caller })
    deps.contexts.mockResolvedValueOnce([])
    expect((await service.request({ action: 'read', source: 'chatgpt', id })).ok).toBe(false)
    expect(reader.read).not.toHaveBeenCalled()
    await service.request({ action: 'list', source: 'perplexity' })
    await service.request({ action: 'read', source: 'perplexity', id })
    expect(
      (await service.request({ action: 'read', source: 'perplexity', id, older: true })).ok,
    ).toBe(false)
    deps.enabled.mockReturnValue(false)
    expect((await service.request({ action: 'list', source: 'perplexity' })).ok).toBe(false)
  })
  it('coalesces neither independent reads nor stale responses after disconnect', async () => {
    const { service, reader } = fixture()
    let resolve!: (value: Awaited<ReturnType<ChatReader['list']>>) => void
    vi.mocked(reader.list).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const pending = service.request({ action: 'list', source: 'perplexity' })
    await vi.waitFor(() => expect(reader.list).toHaveBeenCalled())
    expect((await service.request({ action: 'list', source: 'perplexity' })).ok).toBe(false)
    await service.request({ action: 'disconnect', source: 'perplexity' })
    resolve({ chats: [summary], cursor: null, recentOnly: true })
    expect((await pending).ok).toBe(false)
    expect((await service.request({ action: 'read', source: 'perplexity', id })).ok).toBe(false)
  })
})
describe('provider response projections', () => {
  it('uses only reported activity, never recent timestamps, for the Active view', () => {
    const now = 2000000000000
    const chats = [
      { ...summary, id: 'unknown', updatedAt: now },
      { ...summary, id: 'idle', updatedAt: now, activity: 'idle' as const },
      { ...summary, id: 'working', updatedAt: now, activity: 'active' as const },
      { ...summary, id: 'old', updatedAt: now - 25 * 3600000 },
    ]
    expect(visibleAccountChats(chats, 'active', now, 24, 10).map((c) => c.id)).toEqual(['working'])
    expect(visibleAccountChats(chats, 'workspace', now, 24, 10)).toEqual([])
    expect(visibleAccountChats(chats, 'recent', now, 24, 2).map((c) => c.id)).toEqual([
      'unknown',
      'idle',
    ])
    expect(visibleAccountChats(chats, 'all', now, 24, 2)).toHaveLength(4)
    expect(
      parseChatGPTList({ threads: [{ id, title: 'Live', kind: 'chatgpt', status: 'active' }] })
        .chats[0]?.activity,
    ).toBe('active')
    expect(
      parsePerplexityList([
        {
          uuid: id,
          context_uuid: id,
          title: 'Recent',
          variant: 'thread',
          updated_at: new Date(now).toISOString(),
        },
      ]).chats[0]?.activity,
    ).toBeUndefined()
  })
  it('requires ChatGPT identity and projects observed message formats in chronological order', () => {
    const input = {
      schemaVersion: 1,
      thread: { id, kind: 'chatgpt' },
      page: { order: 'newest_first', hasMore: true, nextCursor: 'older' },
      turns: [
        {
          id: 'new',
          items: [
            {
              id: 'u',
              type: 'userMessage',
              content: [{ type: 'text', text: 'Question', truncated: true }],
            },
            { id: 'a', type: 'agentMessage', text: 'Answer' },
            { type: 'unknown-private-field', token: 'never-copy' },
          ],
        },
        { id: 'old', items: [{ id: 'a', type: 'agentMessage', text: 'Earlier' }] },
      ],
    }
    const parsed = parseChatGPTRead(input, id)
    expect(parsed.messages.map((m) => m.text)).toEqual(['Earlier', 'Question', 'Answer'])
    expect(parsed.messages[1]?.truncated).toBe(true)
    expect(parsed.limited).toBe(true)
    expect(JSON.stringify(parsed)).not.toContain('never-copy')
    expect(() => parseChatGPTRead(input, other)).toThrow()
    expect(() => parseChatGPTRead({ ...input, thread: { id, kind: 'codex' } }, id)).toThrow()
    expect(() =>
      parseChatGPTRead({ ...input, page: { order: 'oldest_first', hasMore: false } }, id),
    ).toThrow()
  })
  it('strips private fields and refuses foreign chat kinds', () => {
    expect(
      parseChatGPTList({
        threads: [{ id, title: 'Chat', kind: 'chatgpt', updatedAt: 1000, private: 'secret' }],
        nextCursor: null,
      }),
    ).toEqual({
      chats: [{ id, title: 'Chat', updatedAt: 1000000 }],
      cursor: null,
      recentOnly: false,
    })
    expect(() => parseChatGPTList({ threads: [{ id, title: 'Code', kind: 'codex' }] })).toThrow()
    expect(
      parsePerplexityList([
        {
          uuid: id,
          context_uuid: caller,
          title: 'Chat',
          variant: 'thread',
          read_write_token: 'secret',
        },
        { uuid: other, title: 'Space', variant: 'collection' },
      ]),
    ).toEqual({ chats: [{ id, title: 'Chat', updatedAt: null }], cursor: null, recentOnly: true })
  })
  it('reads Perplexity question/answer blocks without copying credentials or private metadata', () => {
    const value = {
      status: 'success',
      has_next_page: true,
      next_cursor: 'older',
      entries: [
        {
          uuid: id,
          context_uuid: caller,
          query_str: 'Question',
          read_write_token: 'secret',
          blocks: [
            { markdown_block: { answer: 'Answer', chunks: ['duplicate'] } },
            { plan_block: { description: 'hidden tool detail' } },
          ],
        },
      ],
    }
    const result = parsePerplexityRead(value, caller)
    expect(result.messages.map((m) => m.text)).toEqual(['Question', 'Answer'])
    expect(result.limited).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/secret|duplicate|hidden tool/)
    expect(() => parsePerplexityRead({ ...value, next_cursor: null }, caller)).toThrow()
    expect(() => parsePerplexityRead({ ...value, status: 'error' }, caller)).toThrow()
    expect(() => parsePerplexityRead(value, other)).toThrow('different conversation')
  })
})
describe('compact account-chat content', () => {
  it('preserves sources, suggestions and explicit goal state through the production parser', () => {
    const result = parsePerplexityRead(
      {
        status: 'success',
        has_next_page: false,
        entries: [
          {
            uuid: id,
            context_uuid: caller,
            query_str: 'Question',
            read_write_token: 'secret',
            related_queries: ['Next question?', 'Next question?', '', 42],
            blocks: [
              { markdown_block: { answer: '**Answer**' } },
              {
                web_result_block: {
                  web_results: [
                    { name: 'Source', url: 'https://example.com/source', private_data: 'secret' },
                    { name: 'Bad', url: 'javascript:alert(1)' },
                    { name: 'Credential', url: 'https://user:secret@example.com/' },
                    { name: 'Source', url: 'https://example.com/source' },
                  ],
                },
              },
              {
                plan_block: {
                  progress: 'DONE',
                  final: true,
                  goals: [
                    {
                      id: 'g1',
                      description: 'Check sources',
                      todo_task_status: 'INCOMPLETE',
                      final: true,
                    },
                    {
                      id: 'g2',
                      description: 'Compare results',
                      todo_task_status: 'NEW_UNKNOWN_STATE',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      caller,
    )
    expect(result.messages[1]).toMatchObject({
      text: '**Answer**',
      sources: [{ title: 'Source', url: 'https://example.com/source' }],
      followUps: ['Next question?'],
      steps: [
        { id: 'g1', title: 'Check sources', status: 'Incomplete' },
        { id: 'g2', title: 'Compare results' },
      ],
    })
    expect(result.activity).toBeUndefined()
    expect(JSON.stringify(result)).not.toMatch(/secret|NEW_UNKNOWN_STATE|javascript/)
  })
  it('updates repeated goals without duplication and tolerates malformed optional content', () => {
    const result = perplexityContent(
      [
        {
          plan_block: {
            goals: [{ id: 'g', description: 'Check', todo_task_status: 'INCOMPLETE' }],
          },
        },
        {
          plan_block: { goals: [{ id: 'g', description: 'Check', todo_task_status: 'COMPLETE' }] },
        },
        {
          web_result_block: {
            web_results: [null, { url: 'file:///secret' }, { url: 'https://example.com' }],
          },
        },
        { plan_block: 'unknown version', web_result_block: null },
      ],
      null,
    )
    expect(result.steps).toEqual([{ id: 'g', title: 'Check', status: 'Complete' }])
    expect(result.sources).toEqual([{ title: 'example.com', url: 'https://example.com/' }])
    expect(result.followUps).toBeUndefined()
    expect(perplexityContent([], [' ', 4, 'x'.repeat(2001)])).toEqual({})
  })
  it('bounds extras and only permits usable HTTPS links', () => {
    const result = perplexityContent(
      [
        {
          web_result_block: {
            web_results: Array.from({ length: 100 }, (_, i) => ({
              url: `https://example.com/${i}`,
            })),
          },
          plan_block: {
            goals: Array.from({ length: 100 }, (_, i) => ({ id: String(i), description: 'Step' })),
          },
        },
      ],
      Array.from({ length: 20 }, (_, i) => `Question ${i}`),
    )
    expect(result.sources).toHaveLength(50)
    expect(result.steps).toHaveLength(50)
    expect(result.followUps).toHaveLength(6)
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,test',
      'file:///private',
      '//example.com',
      '/local',
      'http://example.com',
    ])
      expect(chatLink(url)).toBeUndefined()
  })
})
describe('bounded desktop framing', () => {
  for (const framing of ['length', 'header'] as const)
    it(`handles fragmented ${framing} frames and unsolicited notices`, async () => {
      let sent = Buffer.alloc(0)
      const pipe = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          sent = Buffer.concat([sent, chunk])
          callback()
        },
      })
      const rpc = new ReadRpc(pipe, framing)
      const pending = rpc.request('read', {})
      const offset = framing === 'length' ? 4 : sent.indexOf('\r\n\r\n') + 4
      const id = JSON.parse(sent.subarray(offset).toString()).id
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result: { okay: true } }))
      const header =
        framing === 'length'
          ? Buffer.alloc(4)
          : Buffer.from(`Content-Length: ${body.length}\r\n\r\n`)
      if (framing === 'length') header.writeUInt32LE(body.length)
      const frame = Buffer.concat([header, body])
      pipe.push(frame.subarray(0, 2))
      pipe.push(frame.subarray(2, 8))
      pipe.push(frame.subarray(8))
      expect(await pending).toEqual({ okay: true })
      rpc.close()
    })
  it('rejects pending requests when disconnected without leaking the provider body', async () => {
    const pipe = new Duplex({
        read() {},
        write(_data, _encoding, callback) {
          callback()
        },
      }),
      rpc = new ReadRpc(pipe, 'length')
    const pending = rpc.request('read', {})
    rpc.close()
    await expect(pending).rejects.toThrow('interrupted')
  })
})
it('migrates and persists independent source/type preferences without resetting code providers', () => {
  expect(parseSettings({ enabledProviders: ['codex'] })).toMatchObject({
    conversationFilter: 'code-computer',
    chatSources: ['chatgpt', 'perplexity'],
    enabledProviders: ['codex'],
  })
  expect(validatePatch({ conversationFilter: 'chat', chatSources: ['perplexity'] })).toEqual({
    ok: true,
    patch: { conversationFilter: 'chat', chatSources: ['perplexity'] },
  })
  expect(validatePatch({ conversationFilter: 'work' }).ok).toBe(false)
  expect(validatePatch({ chatSources: ['chatgpt', 'chatgpt'] }).ok).toBe(false)
})
