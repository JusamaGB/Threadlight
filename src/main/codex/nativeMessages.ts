import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MESSAGE_LIMIT } from '../../shared/messaging'
import type { NativeAttachment } from '../messaging/attachments'
import { nativeAttachmentMessage } from './nativeAttachmentMessage'
import type { RelayStatus } from '../../shared/types'
import { isObject } from '../sessions/json'
import { codexId, CODEX_UUID } from './identity'
import { connectCodexDesktop, type DesktopConnection } from './desktopConnection'

type Receipt = { clientId: string; textHash: string; turnId?: string }
type Result = { ok: true } | { ok: false; reason: string }

/** Human composer messages use the existing desktop owner, never another CLI writer. */
export class NativeCodexMessages {
  private busy = new Set<string>()
  private statuses = new Map<string, RelayStatus>()
  private watching = new Map<string, string>()
  constructor(
    private history: string,
    private journal: string,
    private changed: () => void,
    private connect: () => Promise<DesktopConnection> = connectCodexDesktop,
  ) {}
  list() {
    return [...this.statuses.values()]
  }
  private read<T>(action: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.history, { readOnly: true })
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; BEGIN')
      return action(db)
    } finally {
      db.close()
    }
  }
  private accepted(id: string, clientId: string): string | undefined {
    return this.read((db) => {
      const row = db
        .prepare(
          "SELECT turn_id FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND json_extract(item_json,'$.clientId')=? LIMIT 1",
        )
        .get(id, clientId)
      return typeof row?.turn_id === 'string' ? row.turn_id : undefined
    })
  }
  private update(id: string, state: RelayStatus['state'], detail = '') {
    this.statuses.set(id, { sessionId: id, state, detail, at: Date.now() })
    this.changed()
  }
  /** Only exact acknowledged turns are watched; no prompt-text matching or resubmission. */
  refresh() {
    for (const [key, turnId] of this.watching) {
      try {
        const result = this.read((db) => {
          const turn = db
            .prepare('SELECT status FROM thread_turns WHERE thread_id=? AND turn_id=?')
            .get(codexId(key)!, turnId)
          if (!turn || ['inProgress', 'in_progress'].includes(String(turn.status))) return
          const last = db
            .prepare(
              "SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? AND item_type='agentMessage' ORDER BY rollout_ordinal DESC LIMIT 1",
            )
            .get(codexId(key)!, turnId)
          return {
            status: turn.status,
            text: last ? String(JSON.parse(String(last.item_json)).text ?? '') : '',
          }
        })
        if (!result) continue
        this.watching.delete(key)
        this.update(
          key,
          result.status === 'completed' ? 'replied' : 'failed',
          result.status === 'completed'
            ? result.text
            : 'Codex accepted the message, but the turn did not complete.',
        )
      } catch {
        /* Retain the accepted state while provider history is unavailable. */
      }
    }
  }
  async send(key: string, message: string, files: NativeAttachment[] = []): Promise<Result> {
    const id = codexId(key),
      text = message.trim()
    if (!id || (!text && !files.length) || text.length > MESSAGE_LIMIT)
      return { ok: false, reason: 'Enter a valid Codex message up to 16000 characters.' }
    if (this.busy.has(key)) return { ok: false, reason: 'This message is still being sent.' }
    this.busy.add(key)
    let connection: DesktopConnection | undefined
    let attempted = false
    const clientId = randomUUID(),
      file = join(this.journal, `${id}.json`)
    const textHash = createHash('sha256')
      .update(
        files.length
          ? JSON.stringify([text, files.map((file) => [file.id, file.path, file.size])])
          : text,
      )
      .digest('hex')
    try {
      if (existsSync(file)) {
        const previous: Receipt = JSON.parse(readFileSync(file, 'utf8'))
        if (!previous.turnId) {
          const turnId = this.accepted(id, previous.clientId)
          if (!turnId)
            return {
              ok: false,
              reason:
                'The previous delivery is unconfirmed. Check Codex before sending again; your draft is retained.',
            }
          writeFileSync(file, JSON.stringify({ ...previous, turnId }))
          if (previous.textHash === textHash) {
            this.watching.set(key, turnId)
            this.update(key, 'sent')
            return { ok: true }
          }
        }
      }
      connection = await this.connect()
      const owner = await connection.request(
        'thread-owner-discovery',
        { hostId: 'local', conversationId: id },
        1,
      )
      if (owner.resultType !== 'success' || typeof owner.handledByClientId !== 'string')
        return {
          ok: false,
          reason: 'Open this chat in Codex to connect it, then send again. Your draft is retained.',
        }
      const { turn, knownEmpty } = this.read((db) => {
        const turn = db
          .prepare(
            'SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
          )
          .get(id)
        // A newly created desktop chat has a projection but no turns yet. Missing
        // history must still fail closed; owner discovery alone is not a history read.
        const knownEmpty =
          !turn &&
          !!db.prepare('SELECT 1 FROM thread_history_projection_state WHERE thread_id=?').get(id)
        return { turn, knownEmpty }
      })
      if (!turn && !knownEmpty)
        return {
          ok: false,
          reason: 'Codex chat history is unavailable. Your message was not sent.',
        }
      const active = ['inProgress', 'in_progress'].includes(String(turn?.status))
      const { input, restoreMessage, attachments } = nativeAttachmentMessage(text, files)
      mkdirSync(this.journal, { recursive: true })
      writeFileSync(file, JSON.stringify({ clientId, textHash } satisfies Receipt))
      this.update(key, 'sending')
      attempted = true
      const response = await connection.request(
        active ? 'thread-follower-steer-turn' : 'thread-follower-start-turn',
        active
          ? {
              conversationId: id,
              input,
              restoreMessage,
              clientUserMessageId: clientId,
              ...(files.length ? { attachments } : {}),
            }
          : {
              conversationId: id,
              turnStart: {
                request: { threadId: id, input, clientUserMessageId: clientId },
                context: {
                  inheritThreadSettings: true,
                  restoreMessage,
                  ...(files.length ? { attachments } : {}),
                },
              },
            },
        active ? 1 : 2,
        owner.handledByClientId,
      )
      const body =
        isObject(response.result) && isObject(response.result.result)
          ? response.result.result
          : null
      const turnId = active ? body?.turnId : isObject(body?.turn) ? body.turn.id : undefined
      if (
        response.resultType !== 'success' ||
        response.handledByClientId !== owner.handledByClientId ||
        typeof turnId !== 'string' ||
        !CODEX_UUID.test(turnId)
      )
        throw new Error('No native delivery acknowledgement.')
      writeFileSync(file, JSON.stringify({ clientId, textHash, turnId } satisfies Receipt))
      this.watching.set(key, turnId)
      this.update(key, 'sent')
      return { ok: true }
    } catch {
      // The native message ID can prove acceptance after a lost acknowledgement.
      if (attempted) {
        try {
          const turnId = this.accepted(id, clientId)
          if (turnId) {
            writeFileSync(file, JSON.stringify({ clientId, textHash, turnId } satisfies Receipt))
            this.watching.set(key, turnId)
            this.update(key, 'sent')
            return { ok: true }
          }
        } catch {
          /* Leave the durable pending receipt in place. */
        }
      }
      const reason = attempted
        ? 'Delivery could not be confirmed. Your draft is retained; check Codex before sending again.'
        : 'Could not connect to Codex. Your message was not sent and your draft is retained.'
      this.update(key, 'failed', reason)
      return { ok: false, reason }
    } finally {
      connection?.close()
      this.busy.delete(key)
    }
  }
}
