import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexQuestionRef, CodexQuestionResult } from '../../shared/codexQuestions'
import { isObject } from '../sessions/json'
import { codexId, CODEX_UUID } from './identity'
import { connectCodexDesktop, type DesktopConnection } from './desktopConnection'

import {
  pendingQuestion,
  questionId,
  questionRecords,
  type OwnerQuestionState,
} from './questionLifecycle'

export function nativeQuestionRef(
  records: Record<string, unknown>[],
  turnId: unknown,
): CodexQuestionRef | undefined {
  return pendingQuestion(records, turnId)?.ref
}

/** Re-read the source immediately before sending; a renderer snapshot is not authority to answer. */
export function readNativeAnswer(
  history: string,
  id: string,
  ref: CodexQuestionRef,
  answers: string[],
  ownerState?: OwnerQuestionState,
): string {
  return prepareAnswer(history, id, ref, answers, ownerState).text
}

function prepareAnswer(
  history: string,
  id: string,
  ref: CodexQuestionRef,
  answers: string[],
  ownerState?: OwnerQuestionState,
) {
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
    const records = questionRecords(db, id, ref.turnId)
    const pending = pendingQuestion(
      records,
      ref.turnId,
      ownerState,
      (candidate) => candidate.itemId === ref.itemId,
    )
    if (
      !pending ||
      pending.ref.itemId !== ref.itemId ||
      (ref.generation && ref.generation !== pending.ref.generation)
    )
      throw new Error('This question has changed or has already been answered in Codex.')
    if (pending.questions.length !== answers.length)
      throw new Error('Answer each question before sending.')
    const replies = pending.questions.map((question, index) => {
      if (!isObject(question) || typeof question.title !== 'string')
        throw new Error('Unsupported Codex question.')
      return {
        questionItemId: questionId(ref.itemId, pending.indexes[index]!),
        question: question.title,
        answer: answers[index]!.trim(),
      }
    })
    return {
      generation: pending.ref.generation,
      ids: replies.map((reply) => reply.questionItemId),
      text: `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>`,
    }
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
    private ownerState?: (id: string, turn: string) => OwnerQuestionState | undefined,
    private confirmed?: (id: string, turn: string, ids: string[]) => void,
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
      (reference.generation !== undefined &&
        (typeof reference.generation !== 'string' ||
          !/^[0-9a-f]{64}$/.test(reference.generation))) ||
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 10 ||
      !values.every((v) => typeof v === 'string' && !!v.trim() && v.length <= 4000)
    )
      return { ok: false, reason: 'Invalid Codex question answer.', retryable: false }
    const ref = {
        turnId: reference.turnId,
        itemId: reference.itemId,
        generation: reference.generation as string | undefined,
      },
      answers = values as string[]
    try {
      ref.generation = prepareAnswer(
        this.history,
        id,
        ref,
        answers,
        this.ownerState?.(id, ref.turnId),
      ).generation
    } catch (error) {
      return { ok: false, reason: (error as Error).message, retryable: false }
    }
    const token = createHash('sha256')
      .update(JSON.stringify([this.history, id, ref.turnId, ref.itemId, ref.generation ?? null]))
      .digest('hex')
    const receipt = join(this.journal, `${token}.json`)
    const legacyReceipt = join(
      this.journal,
      createHash('sha256')
        .update(JSON.stringify([this.history, id, ref.turnId, ref.itemId]))
        .digest('hex') + '.json',
    )
    if (this.busy.has(id) || existsSync(receipt) || existsSync(legacyReceipt))
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
      const { text, ids } = prepareAnswer(
        this.history,
        id,
        ref,
        answers,
        this.ownerState?.(id, ref.turnId),
      )
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
      this.confirmed?.(id, ref.turnId, ids)
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
