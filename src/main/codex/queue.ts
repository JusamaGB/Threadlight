import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CodexTransport } from '../agent/codexClient'
import { CodexRpcError } from '../agent/codexClient'
import type { NativeAttachment } from '../messaging/attachments'
import { nativeAttachmentMessage } from './nativeAttachmentMessage'
import { codexId, CODEX_UUID } from './identity'
import { isObject } from '../sessions/json'
import { connectCodexDesktop, type DesktopConnection } from './desktopConnection'
import { MESSAGE_LIMIT } from '../../shared/messaging'
import type { QueueCommand, QueueResult, QueuedMessage } from '../../shared/codexQueue'

type Entry = { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
const separator = '\n\n## My request:\n'
export function queueText(entry: Entry): string {
  const text = entry.input
    .filter((i) => i.type === 'text')
    .map((i) => String(i.text ?? ''))
    .join('\n')
  return text.startsWith('# Files mentioned by the user:') && text.includes(separator)
    ? text.slice(text.indexOf(separator) + separator.length)
    : text
}

/** Queue-only connection: never resumes a thread or starts a competing turn. */
export class CodexQueue {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private connect: () => Promise<CodexTransport>,
    private journal: string,
    private history: string,
    private desktop: () => Promise<DesktopConnection> = connectCodexDesktop,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn)
    this.tail = next.catch(() => {})
    return next
  }
  private async entries(client: CodexTransport, id: string): Promise<Entry[]> {
    const entries: Entry[] = []
    let cursor: string | undefined
    do {
      const response = await client.request('thread/queue/list', {
        threadId: id,
        ...(cursor ? { cursor } : {}),
      })
      if (!Array.isArray(response.data)) throw Error('Codex queue is unavailable.')
      for (const value of response.data) {
        if (
          !isObject(value) ||
          typeof value.id !== 'string' ||
          !Array.isArray(value.input) ||
          !value.input.every(isObject)
        )
          throw Error('Unsupported Codex queue entry.')
        entries.push(value as Entry)
      }
      cursor = typeof response.nextCursor === 'string' ? response.nextCursor : undefined
      if (entries.length > 1000) throw Error('Codex queue is too large.')
    } while (cursor)
    return entries
  }
  private project(entries: Entry[]): QueuedMessage[] {
    return entries.map((e) => ({
      id: e.id,
      text: queueText(e),
      images: e.input.filter((i) => i.type === 'image' || i.type === 'localImage').length,
      editable: e.input.filter((i) => i.type === 'text').length === 1,
    }))
  }
  private async steer(client: CodexTransport, id: string, entry: Entry) {
    const db = new DatabaseSync(this.history, { readOnly: true })
    let accepted: boolean, turn: { turn_id: string; status: string } | undefined
    try {
      accepted = !!db
        .prepare(
          "SELECT 1 FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND json_extract(item_json,'$.clientId')=?",
        )
        .get(id, entry.clientUserMessageId)
      turn = db
        .prepare(
          'SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
        )
        .get(id) as typeof turn
    } finally {
      db.close()
    }
    const receipt = join(this.journal, `steer-${entry.id}.json`)
    if (!accepted) {
      if (existsSync(receipt))
        throw Error(
          'Steer delivery is unconfirmed. Check Codex before trying again; the original message remains queued.',
        )
      if (!turn || !['inProgress', 'in_progress'].includes(turn.status))
        throw Error(
          'This chat is no longer working. Codex will process the queued message normally.',
        )
      const connection = await this.desktop()
      try {
        const owner = await connection.request(
          'thread-owner-discovery',
          { hostId: 'local', conversationId: id },
          1,
        )
        if (owner.resultType !== 'success' || typeof owner.handledByClientId !== 'string')
          throw Error('Open this chat in Codex to connect it. Your message remains queued.')
        mkdirSync(this.journal, { recursive: true })
        writeFileSync(
          receipt,
          JSON.stringify({ clientId: entry.clientUserMessageId, turnId: turn.turn_id }),
        )
        // Preserve Codex's queue identity and complete serialized input, including images.
        const response = await connection.request(
          'thread-follower-steer-turn',
          {
            conversationId: id,
            input: entry.input,
            clientUserMessageId: entry.clientUserMessageId,
            restoreMessage: {
              text: queueText(entry),
              context: {},
              serverQueuedMessageId: entry.id,
            },
          },
          1,
          owner.handledByClientId,
        )
        const result =
          isObject(response.result) && isObject(response.result.result)
            ? response.result.result
            : null
        if (
          response.resultType !== 'success' ||
          response.handledByClientId !== owner.handledByClientId ||
          result?.turnId !== turn.turn_id
        )
          throw Error(
            'Steer delivery could not be confirmed. Refresh before trying again; the original message remains queued.',
          )
      } finally {
        connection.close()
      }
    }
    // As in the native composer, remove only after the same client message was accepted.
    await client.request('thread/queue/delete', { threadId: id, queuedSubmissionId: entry.id })
    if (existsSync(receipt)) unlinkSync(receipt)
  }
  command(key: string, command: QueueCommand): Promise<QueueResult> {
    return this.serial(async () => {
      let client: CodexTransport | undefined
      try {
        const id = codexId(key)
        if (!id) throw Error('Invalid Codex chat.')
        client = await this.connect()
        const entries = await this.entries(client, id)
        if (command.action === 'list') return { ok: true, items: this.project(entries) }
        const entry = entries.find((e) => e.id === command.id)
        if (!entry && command.action === 'remove') return { ok: true, items: this.project(entries) }
        if (!entry)
          throw Error(
            'This message has already left the queue. Refreshing the queue will show its current state.',
          )
        if (command.action === 'steer') {
          await this.steer(client, id, entry)
        } else if (command.action === 'remove') {
          const response = await client.request('thread/queue/delete', {
            threadId: id,
            queuedSubmissionId: entry.id,
          })
          if (response.deleted === true) {
            // A confirmed removal can update the card immediately. A second read
            // must not delay it or turn a successful deletion into a refresh error.
            return { ok: true, items: this.project(entries.filter((e) => e.id !== entry.id)) }
          }
          const remaining = await this.entries(client, id)
          if (remaining.some((e) => e.id === entry.id))
            throw Error('Codex did not confirm removal. Refresh before retrying.')
          return { ok: true, items: this.project(remaining) }
        } else {
          if (
            !command.text.trim() ||
            command.text.length > MESSAGE_LIMIT ||
            entry.input.filter((i) => i.type === 'text').length !== 1
          )
            throw Error('Enter a message up to 16000 characters.')
          const input = entry.input.map((i) => {
            if (i.type !== 'text') return i
            const original = String(i.text)
            const prefix =
              original.startsWith('# Files mentioned by the user:') && original.includes(separator)
                ? original.slice(0, original.indexOf(separator) + separator.length)
                : ''
            return { ...i, text: prefix + command.text.trim(), text_elements: [] }
          })
          await client.request('thread/queue/update', {
            threadId: id,
            queuedSubmissionId: entry.id,
            input,
          })
        }
        return { ok: true, items: this.project(await this.entries(client, id)) }
      } catch (e) {
        return {
          ok: false,
          reason:
            e instanceof Error
              ? e.message
              : 'Queue update could not be confirmed. Refresh before retrying.',
        }
      } finally {
        client?.close()
      }
    })
  }
  add(
    key: string,
    text: string,
    files: NativeAttachment[] = [],
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.serial(async () => {
      let client: CodexTransport | undefined
      try {
        const id = codexId(key)
        if (!id || (!text.trim() && !files.length) || text.length > MESSAGE_LIMIT)
          throw Error('Invalid queue message.')
        const input = nativeAttachmentMessage(text.trim(), files).input
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
        const file = join(this.journal, `${id}.json`)
        client = await this.connect()
        if (existsSync(file)) {
          const previous = JSON.parse(readFileSync(file, 'utf8')) as {
            clientId: string
            hash: string
          }
          const queued = (await this.entries(client, id)).some(
            (e) => e.clientUserMessageId === previous.clientId,
          )
          const db = new DatabaseSync(this.history, { readOnly: true })
          let accepted: boolean
          try {
            accepted = !!db
              .prepare(
                "SELECT 1 FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND json_extract(item_json,'$.clientId')=?",
              )
              .get(id, previous.clientId)
          } finally {
            db.close()
          }
          if (!queued && !accepted)
            throw Error(
              'Previous queue delivery is unconfirmed. Check Codex before resending; your draft is retained.',
            )
          unlinkSync(file)
          if (previous.hash === hash) return { ok: true }
        }
        const clientId = randomUUID()
        mkdirSync(this.journal, { recursive: true })
        writeFileSync(file, JSON.stringify({ clientId, hash }))
        let response
        try {
          response = await client.request('thread/queue/add', {
            threadId: id,
            input,
            clientUserMessageId: clientId,
          })
        } catch (error) {
          // Invalid request/parameters were explicitly rejected before submission.
          if (error instanceof CodexRpcError && [-32600, -32602].includes(error.code ?? 0))
            unlinkSync(file)
          throw error
        }
        if (
          !isObject(response.queuedSubmission) ||
          typeof response.queuedSubmission.id !== 'string' ||
          !CODEX_UUID.test(response.queuedSubmission.id) ||
          response.queuedSubmission.clientUserMessageId !== clientId
        )
          throw Error('Queue acknowledgement was not confirmed.')
        unlinkSync(file)
        return { ok: true }
      } catch (e) {
        return {
          ok: false,
          reason: `${e instanceof Error ? e.message : 'Queue delivery could not be confirmed.'} Your draft is retained.`,
        }
      } finally {
        client?.close()
      }
    })
  }
}
