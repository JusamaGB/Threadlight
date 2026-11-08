import type { AgentItem } from './agent'
import { z } from 'zod'

export const spokenReplySchema = z.object({
  id: z.string(),
  captionIds: z.array(z.string()).optional(),
  awaitingLink: z.boolean().optional(),
  userItemId: z.string().optional(),
  text: z.string(),
  blocks: z.array(
    z.object({
      language: z.string(),
      value: z.string(),
      start: z.number().int().nonnegative(),
      file: z
        .object({
          name: z.string(),
          path: z.string().optional(),
          kind: z.enum(['copy', 'reference', 'reply']),
        })
        .optional(),
    }),
  ),
})
export type SpokenReply = z.infer<typeof spokenReplySchema>

/** Only native assistant captions received in this call may supply the visible prose. */
export function latestSpokenReply(items: AgentItem[], priorIds: ReadonlySet<string>) {
  const captions = items.filter(
    (item) =>
      item.kind === 'agent' &&
      item.id?.startsWith('live:') &&
      !priorIds.has(item.id) &&
      item.text.trim(),
  )
  const latest = captions.at(-1)
  if (!latest) return null
  let userItemId: string | undefined
  for (let index = items.lastIndexOf(latest) - 1; index >= 0; index--) {
    const prior = items[index]!
    if (prior.kind === 'you' && prior.id) {
      userItemId = prior.id
      break
    }
  }
  const origin = latest.narrationOf
  if (!origin)
    return {
      id: latest.id!,
      captionIds: [latest.id!],
      userItemId,
      awaitingLink: latest.liveComplete === false,
      text: latest.text,
      source: '',
    }
  const parts = new Map<string, string>()
  for (const item of captions) {
    const link = item.narrationOf
    if (
      link?.sessionId !== origin.sessionId ||
      link.turnId !== origin.turnId ||
      link.itemId !== origin.itemId
    )
      continue
    parts.set(item.id!, item.text)
  }
  const answer = items.find(
    (item) =>
      item.kind === 'agent' &&
      item.id === origin.itemId &&
      (!item.backingTurnId || item.backingTurnId === origin.turnId) &&
      (!item.timingSession || item.timingSession === origin.sessionId),
  )
  return {
    id: JSON.stringify([origin.sessionId, origin.turnId, origin.itemId]),
    captionIds: [...parts.keys()],
    userItemId,
    awaitingLink: false,
    text: [...parts.values()].join(' '),
    source: answer?.text ?? '',
  }
}
