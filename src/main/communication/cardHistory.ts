import { DatabaseSync } from 'node:sqlite'
import { codexId } from '../codex/identity'
import { isObject } from '../sessions/json'
import type { CommunicationMessage } from '../../shared/communication'
import type { ConversationCard } from '../../shared/conversationEvents'

/** Both tables share Codex's rollout order. Look up IDs only, within the owning thread. */
function previousLiveItems(path: string, target: string | undefined, cards: ConversationCard[]) {
  const previous = new Map<string, string>()
  const thread = target && codexId(target)
  const anchors = cards.filter((c) => c.anchor && c.state !== 'pending').map((c) => c.anchor!)
  if (!thread || !anchors.length) return previous
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const rows = db
      .prepare(
        `SELECT i.item_id, (
      SELECT r.item_id FROM thread_realtime_items r WHERE r.thread_id=i.thread_id
      AND r.item_type='transcript_segment' AND r.rollout_ordinal<i.rollout_ordinal
      ORDER BY r.rollout_ordinal DESC LIMIT 1
    ) AS previous FROM thread_items i WHERE i.thread_id=? AND i.item_id IN (SELECT value FROM json_each(?))`,
      )
      .all(thread, JSON.stringify(anchors))
    for (const row of rows)
      if (typeof row.previous === 'string')
        previous.set(String(row.item_id), 'live:' + row.previous)
  } catch {
    /* Exact anchors still work with older or unavailable provider history. */
  } finally {
    db?.close()
  }
  return previous
}

function recordedAnswer(card: ConversationCard, messages: CommunicationMessage[]) {
  if (card.kind === 'question' && card.question?.state === 'answered') return card.question.answer
  if (card.kind !== 'native' || card.state !== 'answered-here') return
  const message = messages.find(
    (m) =>
      m.kind === 'answer' &&
      m.rootId === card.requestId &&
      m.deliveries.some(
        (d) =>
          d.phase === 'completed' && d.target === card.source && d.generation === card.generation,
      ),
  )
  if (!message || !card.request || !message.body.startsWith(`Response to ${card.request.title}\n`))
    return
  // The communication service records the response JSON on the final line.
  try {
    const response: unknown = JSON.parse(message.body.split('\n').at(-1)!)
    if (!isObject(response)) return
    if (response.action === 'allow') return 'Allowed'
    if (response.action === 'deny') return 'Denied'
    if (response.action === 'answer') {
      if (typeof response.text === 'string') return response.text
      if (isObject(response.answers))
        return Object.entries(response.answers)
          .flatMap(([id, value]) => {
            if (typeof value !== 'string') return []
            const label = card.request?.questions?.find((q) => q.id === id)?.question
            return [label ? `${label}\n${value}` : value]
          })
          .join('\n')
    }
  } catch {
    /* Older receipts retain their original recorded state. */
  }
}

export function readerCards(
  path: string,
  target: string | undefined,
  cards: ConversationCard[],
  messages: CommunicationMessage[],
) {
  const previous = previousLiveItems(path, target, cards)
  return cards.map((card) => ({
    ...card,
    afterLiveItem: card.anchor && previous.get(card.anchor),
    recordedAnswer: recordedAnswer(card, messages),
  }))
}
