import { z } from 'zod'
import {
  emptyPerplexity,
  perplexityCommand,
  type PerplexityReply,
  type PerplexitySnapshot,
  type PerplexityThread,
} from '../../shared/perplexity'
import type { ComputerConnection } from './computer'
import type { PerplexityVault } from './vault'
import type { discoverPerplexity } from './discovery'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export function computerResult(value: unknown): {
  thread: PerplexityThread | null
  failed: boolean
  rejection?: string
} {
  const result = object(value)
  let data = object(result.structuredContent)
  if (!Object.keys(data).length && Array.isArray(result.content)) {
    const first = object(result.content[0])
    if (first.type === 'text' && typeof first.text === 'string') {
      try {
        data = object(JSON.parse(first.text))
      } catch {
        /* Never interpret unstructured text as a receipt. */
      }
    }
  }
  // The provider checks credits before submitting any message. This documented
  // response deliberately has no thread ID, including for rejected follow-ups.
  if (
    data.event === 'insufficient_credits' &&
    data.thread_id === undefined &&
    data.task_status === undefined
  ) {
    return {
      thread: null,
      failed: true,
      rejection:
        'Perplexity Computer needs account credits. No message was sent. Check your Perplexity account usage before trying again.',
    }
  }
  const parsed = z
    .object({
      thread_id: z.string().uuid(),
      text: z
        .string()
        .max(2 * 1024 * 1024)
        .optional(),
      event: z.string().max(100),
      task_status: z.string().max(100).optional(),
      web_state: z
        .object({ task_status: z.string().max(100).optional() })
        .nullable()
        .optional(),
      truncated: z.boolean().optional(),
    })
    .safeParse(data)
  if (!parsed.success) return { thread: null, failed: true }
  const v = parsed.data,
    status = v.web_state?.task_status ?? v.task_status ?? 'unknown'
  return {
    thread: {
      id: v.thread_id,
      text: (v.text ?? '').slice(0, 120000),
      event: v.event,
      status,
      truncated: !!v.truncated || (v.text?.length ?? 0) > 120000,
      needsInput:
        status === 'input_required' ||
        [
          'ask_user_question',
          'confirm_action',
          'auth_required',
          'interaction_required',
          'insufficient_credits',
        ].includes(v.event),
    },
    failed:
      result.isError === true ||
      ['error', 'access_denied', 'insufficient_credits'].includes(v.event),
  }
}

export class PerplexityService {
  private state = emptyPerplexity()
  private computer?: ComputerConnection
  private connecting?: Promise<void>
  private scanning?: Promise<void>
  private generation = 0
  private closed = false
  private loadError = false
  private loaded: Promise<void>
  constructor(
    private deps: {
      vault: PerplexityVault
      discover: typeof discoverPerplexity
      connection: (authorizing: () => void) => ComputerConnection
      open: (url: string) => Promise<void>
      changed: () => void
    },
  ) {
    this.loaded = deps.vault
      .load()
      .then(() => {
        this.state.computerThreads = [...deps.vault.value.threads]
        this.state.uncertainSend = deps.vault.value.operations.some(
          (operation) => operation.state !== 'done',
        )
      })
      .catch(() => {
        this.loadError = true
        this.state.computer = {
          state: 'error',
          tools: [],
          reason: 'Saved Perplexity connection data is unavailable. Disconnect to reset it.',
        }
      })
  }
  snapshot(): PerplexitySnapshot {
    return structuredClone(this.state)
  }
  private publish() {
    if (!this.closed) this.deps.changed()
  }
  async request(input: unknown): Promise<PerplexityReply> {
    await this.loaded
    const parsed = perplexityCommand.safeParse(input)
    if (!parsed.success || this.closed)
      return { ok: false, reason: 'Perplexity request unavailable.', snapshot: this.snapshot() }
    const command = parsed.data
    try {
      if (command.action === 'status') return { ok: true, snapshot: this.snapshot() }
      if (command.action === 'discover') {
        this.scanning ??= this.discover().finally(() => {
          this.scanning = undefined
        })
        await this.scanning
      } else if (command.action === 'connect') {
        if (this.loadError) throw new Error('Disconnect to reset the saved connection first.')
        if (this.state.computer.state !== 'connected' && !this.connecting) {
          this.connecting = this.connect().finally(() => {
            this.connecting = undefined
          })
        }
      } else if (command.action === 'disconnect') {
        if (this.state.busy)
          throw new Error('Wait for the current request to finish before disconnecting.')
        this.generation++
        await this.computer?.close()
        await this.connecting
        this.computer = undefined
        await this.deps.vault.clearCredentials()
        this.loadError = false
        this.state.computer = { state: 'disconnected', tools: [] }
        this.state.thread = null
      } else if (command.action === 'reconcile') {
        if (this.state.busy) throw new Error('Wait for the current request to finish.')
        for (const operation of this.deps.vault.value.operations) operation.state = 'done'
        await this.deps.vault.save()
        this.state.uncertainSend = false
      } else if (command.action === 'open') {
        const desktop = this.state.desktop.chats.some((chat) => chat.id === command.threadId)
        if (!desktop && !this.known(command.threadId))
          throw new Error('Select a discovered chat first.')
        await this.deps.open(
          desktop
            ? `https://www.perplexity.ai/search/${command.threadId}`
            : // MCP IDs are opaque handles, not the public session IDs in web URLs.
              'https://www.perplexity.ai/computer',
        )
      } else {
        if (this.state.busy || !this.computer || this.state.computer.state !== 'connected')
          throw new Error('Connect Computer and wait for the current request to finish.')
        if (command.threadId && !this.known(command.threadId))
          throw new Error('Select a Computer task created here.')
        if (command.action === 'read') await this.read(command.threadId)
        else {
          if (
            this.deps.vault.value.operations.some(
              (operation) => operation.id === command.operationId,
            )
          )
            throw new Error(
              'This operation was already submitted. Refresh the task instead of sending it again.',
            )
          if (this.state.uncertainSend)
            throw new Error('Check the previous request in Perplexity before sending again.')
          await this.mutate(command)
        }
      }
      this.publish()
      return { ok: true, snapshot: this.snapshot() }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Perplexity request failed.',
        snapshot: this.snapshot(),
      }
    }
  }
  private known(id: string) {
    return this.deps.vault.value.threads.some((thread) => thread.id === id)
  }
  private async discover() {
    try {
      this.state.desktop = {
        state: 'ready',
        checkedAt: Date.now(),
        ...(await this.deps.discover()),
      }
    } catch (error) {
      this.state.desktop = {
        state: 'unavailable',
        checkedAt: Date.now(),
        chats: [],
        hasMore: false,
        reason: error instanceof Error ? error.message : 'Desktop discovery unavailable.',
      }
    }
    this.publish()
  }
  private async connect() {
    const generation = ++this.generation
    this.state.computer = { state: 'connecting', tools: [] }
    this.publish()
    await this.computer?.close()
    const connection = this.deps.connection(() => {
      if (generation !== this.generation) return
      this.state.computer = { state: 'authorizing', tools: [] }
      this.publish()
    })
    this.computer = connection
    try {
      const tools = await connection.connect()
      if (generation === this.generation && !this.closed)
        this.state.computer = { state: 'connected', tools }
    } catch {
      await connection.close().catch(() => {})
      if (generation === this.generation && !this.closed)
        this.state.computer = {
          state: 'error',
          tools: [],
          reason:
            'Computer could not connect. Retry sign-in; check that Computer is available on your Perplexity account.',
        }
    }
    this.publish()
  }
  private async read(id: string) {
    this.state.busy = true
    this.publish()
    try {
      const result = computerResult(await this.computer!.call('read_thread', { thread_id: id }))
      if (!result.thread || result.thread.id !== id || result.failed)
        throw new Error('Read unavailable.')
      this.state.thread = result.thread
    } catch {
      throw new Error('Computer could not read this task. No message was sent.')
    } finally {
      this.state.busy = false
      this.publish()
    }
  }
  private async mutate(
    command: Extract<ReturnType<typeof perplexityCommand.parse>, { action: 'send' | 'cancel' }>,
  ) {
    this.state.busy = true
    this.publish()
    const operation = {
      id: command.operationId,
      state: 'pending' as 'pending' | 'done' | 'uncertain',
      threadId: command.threadId,
    }
    const store = this.deps.vault
    let failure: string | undefined
    store.value.operations = store.value.operations
      .filter((op) => op.state !== 'done')
      .concat(store.value.operations.filter((op) => op.state === 'done').slice(-99), operation)
    try {
      await store.save() // Persist before network I/O; never automatically retry a mutation.
    } catch {
      store.value.operations = store.value.operations.filter((op) => op !== operation)
      this.state.busy = false
      this.publish()
      throw new Error('Could not save the request receipt. Nothing was sent.')
    }
    try {
      const result = computerResult(
        await this.computer!.call(
          command.action === 'send' ? 'call_perplexity_computer' : 'cancel_task',
          command.action === 'send'
            ? {
                message: command.message,
                ...(command.threadId ? { thread_id: command.threadId } : {}),
              }
            : { thread_id: command.threadId },
          (message) => {
            this.state.computer.reason = message
            this.publish()
          },
        ),
      )
      if (result.rejection) {
        operation.state = 'done'
        await store.save()
        this.state.computer.reason = result.rejection
        failure = result.rejection
      } else {
        if (!result.thread || (command.threadId && result.thread.id !== command.threadId))
          throw new Error('Unconfirmed receipt.')
        this.state.thread = result.thread
        if (!this.known(result.thread.id)) {
          store.value.threads.push({
            id: result.thread.id,
            title: command.action === 'send' ? command.message.slice(0, 100) : 'Computer task',
          })
          store.value.threads = store.value.threads.slice(-100)
        }
        this.state.computerThreads = [...store.value.threads]
        operation.threadId = result.thread.id
        operation.state = 'done'
        await store.save()
        if (result.failed) {
          this.state.computer.reason =
            'Computer reported a problem. Read the response or open the task.'
          failure = this.state.computer.reason
        } else delete this.state.computer.reason
      }
    } catch {
      operation.state = 'uncertain'
      this.state.uncertainSend = true
      await store.save().catch(() => {})
      throw new Error(
        'Delivery could not be confirmed. Check Perplexity before retrying; the request may already be running.',
      )
    } finally {
      this.state.busy = false
      this.publish()
    }
    if (failure) throw new Error(failure)
  }
  async close() {
    this.closed = true
    this.generation++
    await this.computer?.close()
  }
}
