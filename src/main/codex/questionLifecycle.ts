import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isObject, type JsonObject } from '../sessions/json'
import { CODEX_UUID } from './identity'
import type { CodexQuestionRef } from '../../shared/codexQuestions'

export interface OwnerQuestionState {
  answered: ReadonlySet<string>
  ended: boolean
}

export const questionId = (itemId: string, index: number) =>
  JSON.stringify(['request_user_input_async', itemId, index])

/** Codex indexes committed user messages and acknowledged steers, never voice transcript text. */
export function answeredQuestionIds(records: JsonObject[]): Set<string> {
  const ids = new Set<string>()
  for (const item of records) {
    const content =
      item.type === 'userMessage'
        ? item.content
        : item.type === 'steeringUserMessage' &&
            (item.status === 'accepted' || item.steerAcknowledged === true)
          ? item.input
          : null
    if (!Array.isArray(content)) continue
    const text = content
      .filter(isObject)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
    const body = text
      .split(/\r?\n## My request:\r?\n/)
      .at(-1)!
      .trim()
    const match =
      /^<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>$/.exec(
        body,
      )
    if (!match) continue
    try {
      const value: unknown = JSON.parse(match[1]!)
      const replies = Array.isArray(value) ? value : [value]
      if (
        replies.every(
          (r) =>
            isObject(r) &&
            typeof r.questionItemId === 'string' &&
            typeof r.question === 'string' &&
            typeof r.answer === 'string',
        )
      )
        for (const r of replies) ids.add(r.questionItemId)
    } catch {
      /* Incomplete provider envelope. */
    }
  }
  return ids
}

/** Read question-bearing messages for this turn even when tools push them off the recent page. */
export function questionRecords(db: DatabaseSync, id: string, turn: string): JsonObject[] {
  const rows = db
    .prepare(
      `SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? AND
      item_type IN ('agentMessage','userMessage','steeringUserMessage') AND json_valid(item_json) AND
      ((item_type='agentMessage' AND json_extract(item_json,'$.delivery')='async' AND json_array_length(item_json,'$.questions')>0) OR
       (item_type IN ('userMessage','steeringUserMessage') AND instr(item_json,'<send_user_message_question_reply>')>0))
      ORDER BY rollout_ordinal`,
    )
    .all(id, turn)
  return rows.map((row) => JSON.parse(String(row.item_json)))
}

export function pendingQuestion(
  records: JsonObject[],
  turnId: unknown,
  owner?: OwnerQuestionState,
  include?: (ref: CodexQuestionRef) => boolean,
) {
  if (owner?.ended || typeof turnId !== 'string' || !CODEX_UUID.test(turnId)) return
  const answered = answeredQuestionIds(records)
  for (const id of owner?.answered ?? []) answered.add(id)
  for (const item of records.toReversed()) {
    if (
      item.type !== 'agentMessage' ||
      item.delivery !== 'async' ||
      typeof item.id !== 'string' ||
      !Array.isArray(item.questions)
    )
      continue
    const itemId = item.id
    const parts = item.questions
    const indexes = parts
      .map((_, index) => index)
      .filter((i) => !answered.has(questionId(itemId, i)))
    if (!indexes.length) continue
    const questions: unknown[] = indexes.map((i) => parts[i])
    const generation = createHash('sha256')
      .update(JSON.stringify([item.questions, indexes]))
      .digest('hex')
    const ref = { turnId, itemId, generation }
    if (!include || include(ref)) return { ref, questions, indexes }
  }
}
