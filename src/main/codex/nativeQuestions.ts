import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexQuestionRef, CodexQuestionResult } from '../../shared/codexQuestions'
import { isObject } from '../sessions/json'
import { codexId, CODEX_UUID } from './identity'
import { connectCodexDesktop, type DesktopConnection } from './desktopConnection'

export function nativeQuestionRef(
  records: Record<string, unknown>[],
  turnId: unknown,
): CodexQuestionRef | undefined {
  if (typeof turnId !== 'string' || !CODEX_UUID.test(turnId)) return
  const item = records.findLast(
    (r) =>
      r.type === 'agentMessage' &&
      r.delivery === 'async' &&
      Array.isArray(r.questions) &&
      r.questions.length > 0,
  )
  if (typeof item?.id === 'string') return { turnId, itemId: item.id }
}

/** Re-read the source immediately before sending; a renderer snapshot is not authority to answer. */
export function readNativeAnswer(
  history: string,
  id: string,
  ref: CodexQuestionRef,
  answers: string[],
): string {
  const db = new DatabaseSync(history, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; BEGIN')
    const turn = db
      .prepare(
        'SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
      )
      .get(id)
    if (
      turn?.turn_id !== ref.turnId ||
      !['inProgress', 'in_progress'].includes(String(turn.status))
    )
      throw new Error('This question has expired. Refresh the thread.')
    const rows = db
      .prepare(
        "SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? AND item_type IN ('agentMessage','userMessage') ORDER BY rollout_ordinal DESC LIMIT 200",
      )
      .all(id, ref.turnId)
    const records = rows
      .reverse()
      .map((r) => JSON.parse(String(r.item_json)) as Record<string, unknown>)
    const current = nativeQuestionRef(records, ref.turnId)
    if (current?.itemId !== ref.itemId)
      throw new Error('This question has changed. Refresh the thread.')
    const item = records.find((r) => r.id === ref.itemId)!
    if (!Array.isArray(item.questions) || item.questions.length !== answers.length)
      throw new Error('Answer each question before sending.')
    const ids = answers.map((_, index) =>
      JSON.stringify(['request_user_input_async', ref.itemId, index]),
    )
    for (const record of records) {
      if (record.type !== 'userMessage' || !Array.isArray(record.content)) continue
      const text = record.content
        .filter(isObject)
        .map((c) => (typeof c.text === 'string' ? c.text : ''))
        .join('\n')
      const match = text
        .trim()
        .match(
          /^<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>$/,
        )
      if (!match) continue
      let replies: unknown
      try {
        replies = JSON.parse(match[1]!)
      } catch {
        continue
      }
      if (
        (Array.isArray(replies) ? replies : [replies]).some(
          (r) => isObject(r) && ids.includes(String(r.questionItemId)),
        )
      )
        throw new Error('This question has already been answered in Codex.')
    }
    const replies = item.questions.map((question, index) => {
      if (!isObject(question) || typeof question.title !== 'string')
        throw new Error('Unsupported Codex question.')
      return {
        questionItemId: ids[index],
        question: question.title,
        answer: answers[index]!.trim(),
      }
    })
    return `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>`
  } finally {
    db.close()
  }
}

export class NativeCodexQuestions {
  private busy = new Set<string>()
  constructor(
    private history: string,
    private journal: string,
    private connect: () => Promise<DesktopConnection> = connectCodexDesktop,
  ) {}
  async answer(key: unknown, reference: unknown, values: unknown): Promise<CodexQuestionResult> {
    const id = typeof key === 'string' ? codexId(key) : null
    if (
      !id ||
      !isObject(reference) ||
      typeof reference.turnId !== 'string' ||
      !CODEX_UUID.test(reference.turnId) ||
      typeof reference.itemId !== 'string' ||
      reference.itemId.length > 200 ||
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 10 ||
      !values.every((v) => typeof v === 'string' && !!v.trim() && v.length <= 4000)
    )
      return { ok: false, reason: 'Invalid Codex question answer.', retryable: false }
    const ref = { turnId: reference.turnId, itemId: reference.itemId },
      answers = values as string[]
    const token = createHash('sha256')
      .update(JSON.stringify([this.history, id, ref.turnId, ref.itemId]))
      .digest('hex')
    const receipt = join(this.journal, `${token}.json`)
    if (this.busy.has(id) || existsSync(receipt))
      return {
        ok: false,
        reason: 'An answer was already submitted. Check Codex before trying again.',
        retryable: false,
      }
    this.busy.add(id)
    let connection: DesktopConnection | undefined,
      attempted = false,
      claimed = false
    try {
      readNativeAnswer(this.history, id, ref, answers)
      connection = await this.connect()
      const owner = await connection.request(
        'thread-owner-discovery',
        { hostId: 'local', conversationId: id },
        1,
      )
      if (owner.resultType !== 'success' || typeof owner.handledByClientId !== 'string')
        return {
          ok: false,
          reason: 'Codex is not connected to this chat. Open it in Codex, then try again.',
          retryable: true,
        }
      mkdirSync(this.journal, { recursive: true })
      const clientUserMessageId = randomUUID()
      writeFileSync(
        receipt,
        JSON.stringify({ threadId: id, ...ref, clientUserMessageId, at: Date.now() }),
        { flag: 'wx' },
      )
      claimed = true
      const text = readNativeAnswer(this.history, id, ref, answers)
      attempted = true
      const result = await connection.request(
        'thread-follower-steer-turn',
        {
          conversationId: id,
          input: [{ type: 'text', text, text_elements: [] }],
          restoreMessage: { text, context: {} },
          clientUserMessageId,
        },
        1,
        owner.handledByClientId,
      )
      const body =
        isObject(result.result) && isObject(result.result.result) ? result.result.result : null
      if (
        result.resultType !== 'success' ||
        result.handledByClientId !== owner.handledByClientId ||
        body?.turnId !== ref.turnId
      )
        return {
          ok: false,
          reason:
            'Codex did not confirm this answer for the original turn. Check the chat before sending again.',
          retryable: false,
        }
      return { ok: true }
    } catch (error) {
      let receiptRetained = false
      if (claimed && !attempted) {
        try {
          unlinkSync(receipt)
        } catch {
          receiptRetained = true
        }
      }
      return {
        ok: false,
        reason: attempted
          ? 'The connection ended before confirmation. Your answer may have arrived; check Codex before sending again.'
          : error instanceof Error
            ? error.message
            : 'Could not connect to Codex. Your answer was not sent.',
        retryable: !attempted && !receiptRetained,
      }
    } finally {
      connection?.close()
      this.busy.delete(id)
    }
  }
}
