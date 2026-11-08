import { describe, it, expect, vi } from 'vitest'
import {
  PerplexityChatReader,
  ChatGPTReader,
  confirmsPerplexitySend,
} from '../src/main/accountChats/adapters'
const id = '6aeaea26-2338-83ed-a05f-4a2bb9018ff3'
const parent = '6aeae6a2-64f0-83ed-ad71-d54499d93c06'
const next = '01a18a38-bbc1-7e70-9374-10f945d6a372'
const entry = {
  backend_uuid: parent,
  context_uuid: id,
  frontend_context_uuid: id,
  read_write_token: 'private-test-token',
  status: 'COMPLETED',
  display_model: 'turbo',
  user_selected_model: 'turbo',
  mode: 'COPILOT',
  sources: { sources: ['web'] },
  query_str: 'Previous message',
}

describe('native chat send contracts', () => {
  it('reports provider rate limits and hides arbitrary native error text', async () => {
    const rpc = {
      request: vi.fn(async () => ({
        success: false,
        contentItems: [{ text: JSON.stringify({ detail: 'Too many requests' }) }],
      })),
      close: vi.fn(),
    }
    const reader: ChatGPTReader = Reflect.construct(ChatGPTReader, [rpc, parent, true])
    await expect(reader.list()).rejects.toThrow('limiting requests')
    for (const [payload, expected] of [
      [{ retry_after: 120 }, 120000],
      [{ headers: { 'Retry-After': '180' } }, 180000],
      [{ retry_after: 'invalid' }, undefined],
    ] as const) {
      rpc.request.mockResolvedValue({
        success: false,
        contentItems: [{ text: JSON.stringify({ detail: 'Too many requests', ...payload }) }],
      })
      await expect(reader.list()).rejects.toMatchObject({ retryAfterMs: expected })
    }
    rpc.request.mockResolvedValue({
      success: false,
      contentItems: [{ text: 'untrusted private details' }],
    })
    await expect(reader.list()).rejects.toThrow('could not complete')
  })
  it('confirms Perplexity only against a new entry, same context and exact prompt', () => {
    const response = { entries: [{ ...entry, backend_uuid: next, query_str: 'Typed reply' }] }
    expect(confirmsPerplexitySend(response, id, parent, 'Typed reply')).toBe(true)
    expect(confirmsPerplexitySend(response, next, parent, 'Typed reply')).toBe(false)
    expect(confirmsPerplexitySend(response, id, next, 'Typed reply')).toBe(false)
    expect(confirmsPerplexitySend(response, id, parent, 'Different reply')).toBe(false)
  })
  it('uses native follow-up streamId and confirms the observed 200 head without an entryId', async () => {
    const callbacks = new Map<string, (raw: unknown) => void>()
    const rpc = {
      listen: vi.fn((key, fn) => {
        callbacks.set(key, fn)
        return () => {
          callbacks.delete(key)
        }
      }),
      request: vi.fn(async (_method, params) => {
        queueMicrotask(() =>
          callbacks.get(params.onMessage)?.({
            payload: { type: 'open', status: 200, headers: {} },
          }),
        )
        return null
      }),
      close: vi.fn(),
    }
    const reader: PerplexityChatReader = Reflect.construct(PerplexityChatReader, [rpc])
    const latest = vi
      .fn()
      .mockResolvedValueOnce({ raw: { entries: [entry] }, page: {} })
      .mockResolvedValue({
        raw: { entries: [{ ...entry, backend_uuid: next, query_str: 'Typed reply' }] },
        page: {},
      })
    Reflect.set(reader, 'latest', latest)
    await reader.send(id, 'Typed reply')
    expect(rpc.request).toHaveBeenCalledTimes(1)
    const [method, params] = rpc.request.mock.calls[0]!
    expect(method).toBe('session_followup')
    expect(params.streamId).toMatch(/^[a-f0-9-]{36}$/)
    const body = JSON.parse(Buffer.from(params.body).toString())
    expect(body).toMatchObject({
      query_str: 'Typed reply',
      params: {
        last_backend_uuid: parent,
        read_write_token: 'private-test-token',
        mode: 'copilot',
        model_preference: 'turbo',
        sources: ['web'],
      },
    })
    expect(callbacks.size).toBe(0)
  })
  it('sends only the selected ChatGPT id and prompt, preserving model settings', async () => {
    const rpc = {
      request: vi.fn(async () => ({
        success: true,
        contentItems: [{ text: JSON.stringify({ threadId: id }) }],
      })),
      close: vi.fn(),
    }
    const reader: ChatGPTReader = Reflect.construct(ChatGPTReader, [rpc, parent, true])
    await reader.send(id, 'Typed reply')
    expect(rpc.request).toHaveBeenCalledWith(
      'tools/call',
      expect.objectContaining({
        namespace: 'codex_app',
        tool: 'send_message_to_thread',
        arguments: { threadId: id, prompt: 'Typed reply' },
        threadId: parent,
      }),
    )
  })
})
