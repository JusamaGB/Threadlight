import { readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ChatMessage, ChatSummary } from '../../shared/accountChats'
import { openVerifiedCodexPipe } from '../codex/verifiedPipe'
import { openVerifiedPerplexityPipe } from '../perplexity/verifiedPipe'
import { ReadRpc, ChatRpcRejected, ChatRateLimited } from './rpc'
import { perplexityContent } from './richContent'

export interface ListedChats {
  chats: ChatSummary[]
  cursor: string | null
  recentOnly: boolean
  repliesAvailable?: boolean
}
export interface ReadChat {
  messages: ChatMessage[]
  cursor: string | null
  limited: boolean
  activity?: 'active' | 'idle'
  canSend?: boolean
}
export interface ChatReader {
  list(cursor?: string): Promise<ListedChats>
  read(id: string, cursor?: string): Promise<ReadChat>
  create?(message: string, clientContext: string, beforeSend: () => void): Promise<string>
  send?(id: string, message: string): Promise<void>
  close(): void
}
const cursorSchema = z.string().min(1).max(16000).nullish()
const text = z.string().max(200000)
const uuid = z.string().uuid()
const summary = z.object({
  id: uuid,
  title: z.string().max(16000),
  kind: z.literal('chatgpt'),
  updatedAt: z.number().optional(),
  status: z.string().optional(),
})
const stamp = (v: number | undefined) => (v === undefined ? null : v < 1e12 ? v * 1000 : v)
export function parseChatGPTList(value: unknown): ListedChats {
  const v = z.object({ threads: z.array(summary).max(50), nextCursor: cursorSchema }).parse(value)
  return {
    chats: v.threads.map((t) => ({
      id: t.id,
      title: t.title.slice(0, 500),
      updatedAt: stamp(t.updatedAt),
      ...(t.status === 'active' || t.status === 'idle' ? { activity: t.status } : {}),
    })),
    cursor: v.nextCursor ?? null,
    recentOnly: false,
  }
}
const messageItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('userMessage'),
    id: z.string(),
    content: z
      .array(
        z.object({ type: z.string(), text: text.optional(), truncated: z.boolean().optional() }),
      )
      .max(200),
  }),
  z.object({
    type: z.literal('agentMessage'),
    id: z.string(),
    text,
    truncated: z.boolean().optional(),
  }),
])
export function parseChatGPTRead(value: unknown, id: string): ReadChat {
  const v = z
    .object({
      schemaVersion: z.literal(1),
      thread: summary
        .pick({ id: true, kind: true })
        .extend({ status: z.object({ type: z.string() }).optional() }),
      page: z.object({
        order: z.literal('newest_first'),
        nextCursor: cursorSchema,
        hasMore: z.boolean(),
      }),
      turns: z.array(z.object({ id: z.string(), items: z.array(z.unknown()).max(500) })).max(10),
      attachments: z.array(z.unknown()).optional(),
    })
    .parse(value)
  if (v.thread.id !== id || (v.page.hasMore && !v.page.nextCursor))
    throw new Error('Unexpected chat response.')
  const messages: ChatMessage[] = []
  let limited = !!v.attachments?.length
  for (const turn of [...v.turns].reverse())
    for (const raw of turn.items) {
      const parsed = messageItem.safeParse(raw)
      if (!parsed.success) {
        limited = true
        continue
      }
      const item = parsed.data
      const user = item.type === 'userMessage'
      const body = user
        ? item.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n')
        : item.text
      if (user && item.content.some((c) => c.type !== 'text')) limited = true
      const truncated = user ? item.content.some((c) => c.truncated) : !!item.truncated
      messages.push({
        id: `${turn.id}:${item.id}`,
        role: user ? 'user' : 'assistant',
        text: body.slice(0, 120000),
        truncated: truncated || body.length > 120000,
      })
    }
  const status = v.thread.status?.type
  return {
    messages,
    cursor: v.page.hasMore ? v.page.nextCursor! : null,
    limited,
    ...(status === 'active' || status === 'idle' ? { activity: status } : {}),
  }
}
function appResult(value: unknown): unknown {
  const v = z
    .object({
      success: z.boolean(),
      contentItems: z
        .array(
          z.object({
            text: z
              .string()
              .max(4 * 1024 * 1024)
              .optional(),
          }),
        )
        .max(100),
    })
    .parse(value)
  const body = v.contentItems.find((c) => c.text)?.text
  if (!v.success) {
    let error:
      { detail?: unknown; retry_after?: unknown; headers?: Record<string, unknown> } | undefined
    try {
      error = body ? JSON.parse(body) : undefined
    } catch {
      /* Untrusted provider error body. */
    }
    if (error?.detail === 'Too many requests') {
      const hint =
        error.retry_after ?? error.headers?.['retry-after'] ?? error.headers?.['Retry-After']
      let delay: number | undefined
      if (typeof hint === 'number' || typeof hint === 'string') {
        const value = String(hint).trim()
        if (/^\d+$/.test(value)) delay = Number(value) * 1000
        else if (/^[A-Za-z]{3}, /.test(value)) delay = Date.parse(value) - Date.now()
      }
      throw new ChatRateLimited(
        delay !== undefined &&
          Number.isSafeInteger(delay) &&
          delay > 0 &&
          delay <= Number.MAX_SAFE_INTEGER - Date.now()
          ? delay
          : undefined,
      )
    }
    throw new Error(
      'The desktop app could not complete this request. Check the native app before retrying.',
    )
  }
  if (!body) throw new Error('No chat content returned.')
  return JSON.parse(body)
}
export class ChatGPTReader implements ChatReader {
  private constructor(
    private rpc: ReadRpc,
    private callerId: string,
    private canSend: boolean,
  ) {}
  static async connect(callerId: string) {
    uuid.parse(callerId)
    const names = (await readdir('\\\\.\\pipe\\')).filter((n) =>
      /^codex-app-tools-[a-f0-9-]{36}$/.test(n),
    )
    if (names.length !== 1)
      throw new Error('Open one Codex desktop instance to read ChatGPT chats.')
    const rpc = new ReadRpc(await openVerifiedCodexPipe(`\\\\.\\pipe\\${names[0]}`), 'length')
    try {
      const catalogue = z
        .object({
          tools: z.array(z.object({ name: z.string(), namespace: z.string().optional() })),
        })
        .parse(await rpc.request('tools/list', { threadStartKind: 'default' }))
      if (
        !['list_threads', 'read_thread'].every((name) =>
          catalogue.tools.some((t) => t.name === name && t.namespace === 'codex_app'),
        )
      )
        throw new Error('This desktop version does not expose chat reading.')
      return new ChatGPTReader(
        rpc,
        callerId,
        catalogue.tools.some(
          (t) => t.name === 'send_message_to_thread' && t.namespace === 'codex_app',
        ),
      )
    } catch (e) {
      rpc.close()
      throw e
    }
  }
  private async call(
    tool: 'list_threads' | 'read_thread' | 'send_message_to_thread',
    args: object,
  ) {
    // Runtime allowlist too: renderer input can never choose an app tool or caller metadata.
    if (!['list_threads', 'read_thread', 'send_message_to_thread'].includes(tool))
      throw new Error('Unsupported chat operation.')
    return appResult(
      await this.rpc.request('tools/call', {
        namespace: 'codex_app',
        tool,
        arguments: args,
        callerSource: 'codex',
        threadId: this.callerId,
        turnId: `threadlight-read-${randomUUID()}`,
        callId: randomUUID(),
      }),
    )
  }
  async list(cursor?: string) {
    const page = parseChatGPTList(
      await this.call('list_threads', {
        source: 'chatgpt',
        mode: 'history',
        limit: 30,
        ...(cursor ? { cursor } : {}),
      }),
    )
    return { ...page, repliesAvailable: this.canSend }
  }
  async read(id: string, cursor?: string) {
    const page = parseChatGPTRead(
      await this.call('read_thread', {
        threadId: uuid.parse(id),
        turnLimit: 5,
        includeOutputs: false,
        maxOutputCharsPerItem: 20000,
        ...(cursor ? { cursor } : {}),
      }),
      id,
    )
    return { ...page, canSend: this.canSend }
  }
  async send(id: string, message: string) {
    if (!this.canSend) throw new Error('This desktop version does not support chat replies.')
    const result = z
      .object({ threadId: uuid })
      .parse(
        await this.call('send_message_to_thread', { threadId: uuid.parse(id), prompt: message }),
      )
    if (result.threadId !== id) throw new Error('Chat delivery identity could not be confirmed.')
  }
  close() {
    this.rpc.close()
  }
}

const perplexityRecent = z
  .array(
    z.object({
      uuid,
      variant: z.string(),
      title: z.string().max(16000),
      updated_at: z.string().optional(),
      context_uuid: uuid.nullish(),
    }),
  )
  .max(1000)
export function parsePerplexityList(value: unknown): ListedChats {
  const v = perplexityRecent.parse(value)
  if (v.some((t) => t.variant === 'thread' && !t.context_uuid))
    throw new Error('Perplexity chat identity is missing.')
  return {
    chats: v
      .filter((t) => t.variant === 'thread')
      .map((t) => ({
        id: t.uuid,
        title: t.title.slice(0, 500),
        updatedAt: t.updated_at ? Date.parse(t.updated_at) || null : null,
      })),
    cursor: null,
    recentOnly: true,
  }
}
export function parsePerplexityRead(value: unknown, contextId: string): ReadChat {
  const v = z
    .object({
      status: z.literal('success'),
      has_next_page: z.boolean(),
      next_cursor: cursorSchema,
      entries: z
        .array(
          z.object({
            uuid,
            context_uuid: uuid,
            query_str: text,
            related_queries: z.unknown().optional(),
            blocks: z
              .array(
                z.object({
                  web_result_block: z.unknown().optional(),
                  plan_block: z.unknown().optional(),
                  markdown_block: z
                    .object({ answer: text.optional(), chunks: z.array(text).max(500).optional() })
                    .optional(),
                }),
              )
              .max(500),
          }),
        )
        .max(20),
    })
    .parse(value)
  if (v.has_next_page && !v.next_cursor) throw new Error('Missing history cursor.')
  if (v.entries.some((e) => e.context_uuid !== contextId))
    throw new Error('Perplexity returned a different conversation. Refresh the chat list.')
  const messages: ChatMessage[] = []
  for (const entry of [...v.entries].reverse()) {
    messages.push({
      id: `${entry.uuid}:user`,
      role: 'user',
      text: entry.query_str.slice(0, 120000),
      truncated: entry.query_str.length > 120000,
    })
    const body = entry.blocks
      .flatMap((b) =>
        b.markdown_block
          ? [b.markdown_block.answer ?? b.markdown_block.chunks?.join('') ?? '']
          : [],
      )
      .join('\n\n')
    messages.push({
      id: `${entry.uuid}:assistant`,
      role: 'assistant',
      text: body.slice(0, 120000),
      truncated: body.length > 120000,
      ...perplexityContent(entry.blocks, entry.related_queries),
    })
  }
  return { messages, cursor: v.has_next_page ? v.next_cursor! : null, limited: true }
}
export class PerplexityChatReader implements ChatReader {
  private contexts = new Map<string, string>()
  private constructor(private rpc: ReadRpc) {}
  static async connect() {
    const names = (await readdir('\\\\.\\pipe\\')).filter((n) =>
      /^perplexity-rpc-[a-f0-9]{32}$/.test(n),
    )
    if (names.length !== 1) throw new Error('Open one Perplexity Windows app to read chats.')
    const rpc = new ReadRpc(await openVerifiedPerplexityPipe(`\\\\.\\pipe\\${names[0]}`), 'header')
    try {
      z.object({ version: z.literal('26.10.3') }).parse(await rpc.request('server_status', {}))
      return new PerplexityChatReader(rpc)
    } catch {
      rpc.close()
      throw new Error('This Perplexity desktop version has not been validated for chat reading.')
    }
  }
  private async get(path: string) {
    if (
      path !== '/rest/thread/list_recent?exclude_asi=true' &&
      !/^\/rest\/thread\/[a-f0-9-]{36}\?/.test(path)
    )
      throw new Error('Read-only connection.')
    const callback = `threadlight_read_${randomUUID()}`,
      requestId = randomUUID(),
      chunks: Buffer[] = []
    let size = 0,
      timer: NodeJS.Timeout | undefined
    let off = () => {}
    const complete = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        this.rpc.close()
        reject(new Error('Chat read timed out.'))
      }, 15000)
      off = this.rpc.listen(callback, (raw) => {
        const parsed = z
          .object({
            payload: z.discriminatedUnion('type', [
              z.object({ type: z.literal('chunk'), dataBase64: z.string() }),
              z.object({ type: z.literal('end') }),
              z.object({ type: z.literal('error') }),
            ]),
          })
          .safeParse(raw)
        if (!parsed.success) {
          reject(new Error('Chat response format changed.'))
          return
        }
        const e = parsed.data.payload
        if (e.type === 'error')
          reject(
            new Error(
              'Perplexity interrupted the chat read. Refresh after checking the signed-in account.',
            ),
          )
        else if (e.type === 'end') resolve()
        else {
          const data = Buffer.from(e.dataBase64, 'base64')
          size += data.length
          if (size > 4 * 1024 * 1024) {
            this.rpc.close()
            reject(new Error('Chat response is too large.'))
          } else chunks.push(data)
        }
      })
    })
    void complete.catch(() => {})
    try {
      const head = z.object({ status: z.number() }).parse(
        await this.rpc.request('native_transport_request_streaming', {
          input: { requestId, method: 'GET', path, headers: {} },
          onMessage: callback,
        }),
      )
      if (head.status !== 200)
        throw new Error(
          'Perplexity could not read these chats. Check the signed-in account and refresh.',
        )
      await complete
      return JSON.parse(Buffer.concat(chunks).toString()) as unknown
    } finally {
      clearTimeout(timer)
      off()
    }
  }
  async list() {
    const rows = perplexityRecent.parse(await this.get('/rest/thread/list_recent?exclude_asi=true'))
    const page = parsePerplexityList(rows)
    for (const row of rows.filter((t) => t.variant === 'thread'))
      this.contexts.set(row.uuid, row.context_uuid!)
    // Native status is separate from the cloud list; never infer activity from recency.
    const snapshot = z
      .object({
        items: z.array(z.object({ contextUuid: uuid, threadStatus: z.string().nullish() })),
      })
      .parse(await this.rpc.request('threads_snapshot', {}))
    for (const chat of page.chats) {
      const status = snapshot.items.find(
        (t) => t.contextUuid === this.contexts.get(chat.id),
      )?.threadStatus
      if (status === 'pending') chat.activity = 'active'
      else if (status === 'completed') chat.activity = 'idle'
    }
    return page
  }
  private async latest(id: string, cursor?: string) {
    uuid.parse(id)
    const contextId = this.contexts.get(id)
    if (!contextId) throw new Error('Refresh the Perplexity chat list first.')
    const query = new URLSearchParams({
      with_parent_info: 'false',
      with_schematized_response: 'true',
      version: '2.18',
      source: 'default',
      limit: '1',
      offset: '0',
      from_first: 'false',
    })
    if (cursor) query.set('cursor', cursorSchema.parse(cursor)!)
    const raw = await this.get(`/rest/thread/${id}?${query}`)
    const page = parsePerplexityRead(raw, contextId)
    return { raw, page }
  }
  async read(id: string, cursor?: string) {
    const { raw, page } = await this.latest(id, cursor)
    const latest = perplexitySendContext.safeParse(raw)
    const entry = latest.success ? latest.data.entries[0] : undefined
    return {
      ...page,
      canSend: !!entry && entry.mode?.toLowerCase() !== 'asi',
      ...(entry?.status === 'COMPLETED' ? { activity: 'idle' as const } : {}),
    }
  }
  async send(id: string, message: string) {
    // Re-read the current parent and keep its write token entirely in main memory.
    const { raw } = await this.latest(id)
    const entry = perplexitySendContext.parse(raw).entries[0]!
    if (entry.mode?.toLowerCase() === 'asi' || entry.status !== 'COMPLETED')
      throw new Error('Wait for this chat to finish before replying.')
    const body = Buffer.from(
      JSON.stringify({
        query_str: message,
        params: {
          last_backend_uuid: entry.backend_uuid,
          read_write_token: entry.read_write_token,
          model_preference: entry.user_selected_model ?? entry.display_model,
          mode: entry.mode?.toLowerCase() ?? 'concise',
          search_focus: entry.search_focus ?? 'internet',
          sources: entry.sources?.sources ?? ['web'],
          frontend_uuid: randomUUID(),
          frontend_context_uuid: entry.frontend_context_uuid,
          query_source: 'followup',
          version: '2.18',
          use_schematized_api: true,
          send_back_text_in_streaming_api: false,
          language: Intl.DateTimeFormat().resolvedOptions().locale,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    )
    return this.submit('session_followup', body, async () => {
      const { raw } = await this.latest(id)
      return confirmsPerplexitySend(raw, entry.context_uuid, entry.backend_uuid, message)
    })
  }
  async create(message: string, clientContext: string, beforeSend: () => void) {
    uuid.parse(clientContext)
    const previous = new Set((await this.list()).chats.map((row) => row.id))
    const body = Buffer.from(
      JSON.stringify({
        query_str: message,
        params: {
          frontend_uuid: randomUUID(),
          frontend_context_uuid: clientContext,
          mode: 'concise',
          search_focus: 'internet',
          sources: ['web'],
          query_source: 'default_search',
          version: '2.18',
          use_schematized_api: true,
          send_back_text_in_streaming_api: false,
          language: Intl.DateTimeFormat().resolvedOptions().locale,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    )
    let confirmed: string | undefined
    beforeSend()
    await this.submit('session_ask', body, async () => {
      const rows = (await this.list()).chats.filter((row) => !previous.has(row.id))
      for (const row of rows) {
        const candidate = await this.latest(row.id).catch(() => undefined)
        if (!candidate) continue
        const { raw } = candidate
        const context = this.contexts.get(row.id)!
        if (confirmsPerplexityCreation(raw, context, clientContext, message)) {
          confirmed = row.id
          return true
        }
      }
      return false
    })
    if (!confirmed) throw new Error('New Perplexity chat could not be confirmed.')
    return confirmed
  }
  private async submit(
    method: 'session_followup' | 'session_ask',
    body: Buffer,
    confirm: () => Promise<boolean>,
  ) {
    const callback = `threadlight_send_${randomUUID()}`
    await new Promise<void>((resolve, reject) => {
      let accepted = false
      let finished = false
      let verifying = false
      const timer = setTimeout(
        () => {
          finished = true
          off()
          reject(
            new Error('Delivery could not be confirmed. Check Perplexity before sending again.'),
          )
        },
        method === 'session_ask' ? 120000 : 30000,
      )
      const verify = async () => {
        if (verifying) return
        verifying = true
        // A successful stream head has no entryId on this desktop version.
        // Confirm a new entry in the same conversation before acknowledging delivery.
        while (!finished) {
          try {
            if (await confirm()) {
              if (finished) return
              accepted = true
              finished = true
              clearTimeout(timer)
              off()
              resolve()
              return
            }
          } catch {
            /* The original send is never retried; the deadline marks it uncertain. */
          }
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      const off = this.rpc.listen(callback, (raw) => {
        const event = z
          .object({
            payload: z.object({
              type: z.string(),
              status: z.number().optional(),
              entryId: uuid.optional(),
            }),
          })
          .safeParse(raw)
        if (!event.success) return
        if (event.data.payload.type !== 'open') return
        if (event.data.payload.status === 200) void verify()
        else {
          finished = true
          clearTimeout(timer)
          off()
          reject(
            new Error('Perplexity did not confirm delivery. Check the chat before sending again.'),
          )
        }
      })
      void this.rpc
        .request(
          method,
          { body: Array.from(body), streamId: randomUUID(), onMessage: callback },
          300000,
        )
        .catch((error) => {
          finished = true
          clearTimeout(timer)
          off()
          if (error instanceof ChatRpcRejected && [-32601, -32602].includes(error.code)) {
            reject(error)
            return
          }
          if (!accepted)
            reject(
              new Error('Delivery could not be confirmed. Check Perplexity before sending again.'),
            )
        })
    })
  }
  close() {
    this.rpc.close()
  }
}

const perplexitySendContext = z.object({
  entries: z
    .array(
      z.object({
        backend_uuid: uuid,
        context_uuid: uuid,
        read_write_token: z.string().min(1).max(16000),
        frontend_context_uuid: uuid,
        status: z.string(),
        query_str: z.string(),
        mode: z.string().nullish(),
        display_model: z.string(),
        user_selected_model: z.string().nullish(),
        search_focus: z.string().nullish(),
        sources: z.object({ sources: z.array(z.string()) }).optional(),
      }),
    )
    .min(1),
})

/** Match the provider-owned conversation and the client context of this exact initial ask. */
export function confirmsPerplexityCreation(
  raw: unknown,
  contextId: string,
  clientContext: string,
  message: string,
) {
  const result = z
    .object({
      status: z.literal('success'),
      entries: z.array(
        z.object({
          context_uuid: uuid,
          frontend_context_uuid: uuid,
          query_str: text,
          mode: z.string().nullish(),
        }),
      ),
    })
    .safeParse(raw)
  return (
    result.success &&
    result.data.entries.length === 1 &&
    result.data.entries.some(
      (entry) =>
        entry.context_uuid === contextId &&
        entry.frontend_context_uuid === clientContext &&
        entry.query_str === message &&
        entry.mode?.toLowerCase() !== 'asi',
    )
  )
}

/** Delivery evidence must be a different saved entry, in the selected conversation. */
export function confirmsPerplexitySend(
  raw: unknown,
  contextId: string,
  previousId: string,
  message: string,
) {
  const value = perplexitySendContext.safeParse(raw)
  return (
    value.success &&
    value.data.entries.some(
      (entry) =>
        entry.context_uuid === contextId &&
        entry.backend_uuid !== previousId &&
        entry.query_str === message,
    )
  )
}
