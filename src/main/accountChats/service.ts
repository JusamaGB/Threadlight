import {
  chatCommand,
  type ChatReply,
  type ChatSource,
  type ChatSummary,
  type SharedDeliveryStatus,
} from '../../shared/accountChats'
import type { ChatReader } from './adapters'
import { ChatDelivery } from './delivery'
import { ChatRpcRejected, ChatRateLimited, CHAT_RATE_LIMITED } from './rpc'
import { createHash } from 'node:crypto'

interface Connection {
  reader?: ChatReader
  callerId?: string
  ids: Set<string>
  chats: Map<string, ChatSummary>
  cursor: string | null
  reads: Map<string, string | null>
  generation: number
  busy: boolean
}
const empty = (): Connection => ({
  ids: new Set(),
  chats: new Map(),
  cursor: null,
  reads: new Map(),
  generation: 0,
  busy: false,
})
/** Only discovered chats and explicit typed replies; no arbitrary provider dispatch. */
export class AccountChats {
  private connections: Record<ChatSource, Connection> = { chatgpt: empty(), perplexity: empty() }
  private closed = false
  private sharedDeliveries = new Map<ChatSource, SharedDeliveryStatus>()
  recordSharedDelivery(source: ChatSource, failed: boolean) {
    if (this.closed) return
    const previous = this.sharedDeliveries.get(source)
    const status = { source, failed, sequence: (previous?.sequence ?? 0) + 1 }
    this.sharedDeliveries.set(source, status)
    try {
      this.deps.onSharedDelivery?.(status)
    } catch {
      // A closing panel can recover this status on its next list request.
    }
  }
  private cooldown = new Map<ChatSource, { until: number; interval: number }>()
  private headPolls = new Map<ChatSource, { caller?: string; pending: Promise<ChatReply> }>()
  private limited(source: ChatSource, error: ChatRateLimited) {
    const now = Date.now(),
      previous = this.cooldown.get(source)
    const interval =
      previous && now <= previous.until + 30 * 60000
        ? Math.min(previous.interval * 2, 15 * 60000)
        : 60000
    const until = now + Math.max(interval, error.retryAfterMs ?? 0)
    this.cooldown.set(source, { until, interval })
    return until
  }
  private turnOwners = new Map<string, symbol>()
  enabled(source: ChatSource) {
    return !this.closed && this.deps.enabled(source)
  }
  catalog(source: ChatSource) {
    return this.deps.enabled(source) ? [...this.connections[source].chats.values()] : []
  }
  generation(source: ChatSource) {
    return this.connections[source].generation
  }
  /** Shares the composer boundary; the lease never crosses IPC or reaches a model. */
  async withTurn<T>(
    source: ChatSource,
    id: string,
    run: (request: (input: unknown) => Promise<ChatReply>) => Promise<T>,
  ) {
    const key = `${source}:${id}`
    if (this.turnOwners.has(key))
      throw Object.assign(new Error('A message is already being handled for this chat.'), {
        deliveryRejected: true,
      })
    const owner = Symbol(key)
    this.turnOwners.set(key, owner)
    try {
      return await run((input) => this.execute(input, owner))
    } finally {
      this.turnOwners.delete(key)
    }
  }
  constructor(
    private deps: {
      contexts: () => Promise<{ id: string; title: string }[]>
      connect: (source: ChatSource, callerId?: string) => Promise<ChatReader>
      enabled: (source: ChatSource) => boolean
      delivery?: ChatDelivery
      onSharedDelivery?: (status: SharedDeliveryStatus) => void
    },
  ) {}
  private get delivery() {
    return (this.deps.delivery ??= new ChatDelivery())
  }
  private reset(source: ChatSource) {
    const c = this.connections[source]
    c.reader?.close()
    this.connections[source] = { ...empty(), generation: c.generation + 1 }
  }
  async createPerplexityChat(message: string, id: string, beforeSend: () => void) {
    const source = 'perplexity'
    const c = this.connections[source]
    const current = () => this.enabled(source) && this.connections[source] === c
    if (!current()) throw Error('Perplexity chat creation unavailable.')
    if (c.busy || (this.cooldown.get(source)?.until ?? 0) > Date.now())
      throw Error('Perplexity is busy. Wait for its current operation to finish.')
    c.busy = true
    try {
      if (!c.reader) {
        const reader = await this.deps.connect(source)
        if (!current()) {
          reader.close()
          throw Error('Perplexity chat creation unavailable.')
        }
        c.reader = reader
      }
      if (!c.reader.create) throw Error('Perplexity chat creation unavailable.')
      return await c.reader.create(message, id, () => {
        if (!current()) throw Error('Perplexity chat creation unavailable.')
        beforeSend()
      })
    } catch (error) {
      if (error instanceof ChatRateLimited) this.limited(source, error)
      throw error
    } finally {
      c.busy = false
    }
  }
  async request(input: unknown): Promise<ChatReply> {
    return this.execute(input)
  }
  private async execute(input: unknown, owner?: symbol): Promise<ChatReply> {
    const parsed = chatCommand.safeParse(input)
    if (!parsed.success || this.closed) return { ok: false, reason: 'Chat request unavailable.' }
    const command = parsed.data
    if (command.action !== 'list' || !command.poll || command.more) return this.run(command, owner)
    const flight = this.headPolls.get(command.source)
    if (flight && flight.caller === command.callerId) return flight.pending
    const pending = this.run(command, owner)
    this.headPolls.set(command.source, { caller: command.callerId, pending })
    try {
      return await pending
    } finally {
      if (this.headPolls.get(command.source)?.pending === pending)
        this.headPolls.delete(command.source)
    }
  }
  private async run(
    command: import('../../shared/accountChats').ChatCommand,
    owner?: symbol,
  ): Promise<ChatReply> {
    if (command.action === 'contexts') {
      try {
        return { ok: true, kind: 'contexts', contexts: (await this.deps.contexts()).slice(0, 200) }
      } catch {
        return { ok: false, reason: 'Open a local Codex chat, then retry the connection.' }
      }
    }
    const source = command.source
    if (
      command.action === 'send' &&
      this.turnOwners.has(`${source}:${command.id}`) &&
      this.turnOwners.get(`${source}:${command.id}`) !== owner
    )
      return { ok: false, reason: 'A shared-space message is awaiting its reply in this chat.' }
    if (command.action === 'disconnect') {
      this.reset(source)
      this.headPolls.delete(source)
      return { ok: true, kind: 'disconnected' }
    }
    const retryAt = this.cooldown.get(source)?.until
    if (retryAt && retryAt > Date.now()) return { ok: false, reason: CHAT_RATE_LIMITED, retryAt }
    if (!this.deps.enabled(source)) {
      this.reset(source)
      return {
        ok: false,
        reason: 'This chat source is hidden. Enable it in the applications filter.',
      }
    }
    let c = this.connections[source]
    if (c.busy)
      return { ok: false, busy: true, reason: 'Wait for the current chat read to finish.' }
    if (command.action === 'list' && command.more && command.poll)
      return { ok: false, reason: 'Invalid chat list request.' }
    if (command.action === 'read' && command.older && command.latest)
      return { ok: false, reason: 'Invalid chat read request.' }
    if (command.action === 'list' && !command.more && (!command.poll || !c.reader)) {
      this.reset(source)
      c = this.connections[source]
      c.callerId = command.callerId
    }
    c.busy = true
    const current = () =>
      !this.closed && this.connections[source] === c && this.deps.enabled(source)
    try {
      await this.delivery.load()
      if (source === 'chatgpt') {
        const contexts = await this.deps.contexts()
        // Resolve the normal desktop connection from a real discovered local context.
        // Explicit callers are still validated; no synthetic identity is accepted.
        if (command.action === 'list' && !command.more && !c.callerId) c.callerId = contexts[0]?.id
        if (!c.callerId || !contexts.some((t) => t.id === c.callerId))
          throw new Error('Open a local Codex chat, then refresh this connection in Settings.')
        if (command.action === 'list' && command.callerId && command.callerId !== c.callerId)
          throw new Error('Refresh after changing the Codex connection context.')
      }
      if (!current()) throw new Error('Chat connection changed. Refresh to reconnect.')
      if (!c.reader) {
        if (command.action !== 'list' || command.more)
          throw new Error('Refresh the chat list first.')
        const reader = await this.deps.connect(source, c.callerId)
        if (!current()) {
          reader.close()
          throw new Error('Chat connection changed.')
        }
        c.reader = reader
      }
      if (command.action === 'list') {
        if (command.more && (!c.cursor || c.ids.size >= 300))
          throw new Error('Refresh to start a new chat list.')
        const page = await c.reader.list(command.more ? c.cursor! : undefined)
        if (!current()) throw new Error('Chat connection changed.')
        if (command.more && page.cursor && page.cursor === c.cursor)
          throw new Error('The chat list did not advance. Refresh to retry.')
        const chats = command.poll
          ? page.chats.slice(0, 300)
          : page.chats.filter((t) => !c.ids.has(t.id)).slice(0, 300 - c.ids.size)
        if (command.poll) {
          c.ids = new Set([...chats.map((chat) => chat.id), ...c.ids].slice(0, 300))
          for (const id of c.reads.keys()) if (!c.ids.has(id)) c.reads.delete(id)
        }
        chats.forEach((t) => c.ids.add(t.id))
        chats.forEach((t) => c.chats.set(t.id, t))
        for (const id of c.chats.keys()) if (!c.ids.has(id)) c.chats.delete(id)
        if (!command.poll) c.cursor = c.ids.size < 300 ? page.cursor : null
        if (c.ids.size >= 300) c.cursor = null
        return {
          ok: true,
          kind: 'list',
          sharedDelivery: this.sharedDeliveries.get(source),
          ...(page.repliesAvailable !== undefined && { repliesAvailable: page.repliesAvailable }),
          chats,
          hasMore: !!c.cursor,
          recentOnly: page.recentOnly || c.ids.size >= 300,
        }
      }
      if (!c.ids.has(command.id)) throw new Error('Select a chat from the current list.')
      if (command.action === 'confirm-delivery') {
        await this.delivery.confirm(source, command.id)
        return { ok: true, kind: 'delivery-confirmed' }
      }
      if (command.action === 'send') {
        const digest = createHash('sha256').update(command.message).digest('hex')
        const previous = this.delivery.find(command.operationId)
        if (previous) {
          if (
            previous.source === source &&
            previous.id === command.id &&
            previous.digest === digest &&
            previous.state === 'accepted'
          )
            return { ok: true, kind: 'sent', id: command.id, operationId: command.operationId }
          throw new Error(
            'This send was already attempted. Check the provider before trying again.',
          )
        }
        if (this.delivery.uncertain(source, command.id))
          throw new Error('Delivery is uncertain. Check the provider before sending again.')
        const latest = await c.reader.read(command.id)
        if (!current()) throw new Error('Chat connection changed.')
        if (!latest.canSend || !c.reader.send)
          throw new Error('Replies are unavailable for this connection.')
        if (latest.activity === 'active')
          throw new Error('Wait for this reply to finish before sending.')
        const receipt = { source, id: command.id, operationId: command.operationId, digest }
        await this.delivery.record({ ...receipt, state: 'pending' })
        if (!current())
          throw new Error('Chat connection changed before sending. Check delivery before retrying.')
        try {
          await c.reader.send(command.id, command.message)
        } catch (error) {
          if (error instanceof ChatRpcRejected && [-32601, -32602].includes(error.code))
            await this.delivery.record({ ...receipt, state: 'checked' })
          throw error
        }
        await this.delivery.record({ ...receipt, state: 'accepted' })
        return { ok: true, kind: 'sent', id: command.id, operationId: command.operationId }
      }
      const cursor = command.older ? c.reads.get(command.id) : undefined
      if (command.older && !cursor)
        throw new Error('No older page is available. Refresh this chat.')
      const page = await c.reader.read(command.id, cursor ?? undefined)
      if (!current()) throw new Error('Chat connection changed.')
      if (cursor && page.cursor === cursor)
        throw new Error('History did not advance. Refresh this chat.')
      if (!command.latest) c.reads.set(command.id, page.cursor)
      return {
        ok: true,
        kind: 'read',
        page: {
          id: command.id,
          messages: page.messages,
          hasMore: !!page.cursor,
          limited: page.limited,
          activity: page.activity,
          canSend: page.canSend,
          deliveryUncertain: this.delivery.uncertain(source, command.id),
        },
      }
    } catch (error) {
      if (error instanceof ChatRateLimited)
        return { ok: false, reason: CHAT_RATE_LIMITED, retryAt: this.limited(source, error) }
      if (this.connections[source] === c) this.reset(source)
      // Provider bodies never enter errors: adapter errors are local messages or validation failures.
      return {
        ok: false,
        reason:
          error instanceof Error && error.name !== 'ZodError' && error.name !== 'SyntaxError'
            ? error.message
            : 'The desktop chat format changed. Refresh after checking the app version.',
      }
    } finally {
      c.busy = false
    }
  }
  close() {
    this.closed = true
    this.headPolls.clear()
    this.reset('chatgpt')
    this.reset('perplexity')
  }
}
