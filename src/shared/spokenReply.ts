import type { AgentItem } from './agent'
import { z } from 'zod'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { delegationLinks } from './agentTranscript'
import { spokenProse } from './spokenProse'
import { matchesSpeech } from './speechCaption'

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

/** A native caption can follow its formatted backing answer without a narration handoff.
 * Resolve only its recorded predecessor, and require the learner's linked delegation
 * to that exact turn plus matching caption evidence. This is a visual source only. */
function delegatedSource(items: AgentItem[], latest: AgentItem, priorIds: ReadonlySet<string>) {
  if (!latest.liveAfter) return
  const answer = items.find((item) => item.id === latest.liveAfter)
  if (answer?.kind !== 'agent' || !answer.backingTurnId || !answer.timingSession) return
  const links = delegationLinks(items)
  const user = items
    .slice(0, items.indexOf(latest))
    .findLast((item) => item.kind === 'you' && item.id?.startsWith('live:'))
  if (
    !user?.id ||
    priorIds.has(user.id) ||
    !items.some(
      (item) =>
        item.kind === 'you' &&
        item.id &&
        item.backingTurnId === answer.backingTurnId &&
        links.get(item.id) === user.id,
    )
  )
    return
  // Normalize only observed transcription forms. Preserve wording, negations and
  // the complete caption so a separate native response cannot borrow the fence.
  const prose = (text: string) =>
    spokenProse(text)
      .replace(/\b(\w+)\((\w+), (\w+)\[(\w+)\]\)/g, '$1 of $2 and $3 of $4')
      .replace(
        /\b(10|11|12)\b/g,
        (number) => ({ '10': 'ten', '11': 'eleven', '12': 'twelve' })[number]!,
      )
      .replace(/[\u2014,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  if (matchesSpeech(prose(answer.text), prose(latest.text), latest.liveComplete === false))
    return answer
}

function quotesExample(source: string, blocks: SpokenReply['blocks']) {
  const lines = new Set(
    blocks.flatMap((block) => block.value.split(/\r?\n/).map((line) => line.trim())),
  )
  function references(node: Nodes): boolean {
    if (node.type === 'inlineCode') {
      const code = node.value.trim()
      return /[\p{L}_][\p{L}\p{N}_]*/u.test(code) && /[^\w\s]/.test(code) && lines.has(code)
    }
    return 'children' in node && node.children.some(references)
  }
  return source.includes('`') && references(fromMarkdown(source))
}

export const currentExampleMarker = '<!--threadlight:current-example-->'
export interface SpokenExample {
  sourceId: string
  session: string
  blocks: SpokenReply['blocks']
}

/** The presenter remembers a single actual fenced example. A follow-up must explicitly
 * reference that example in a verified backing message before it can display it. */
export function spokenExample(
  previous: SpokenExample | null,
  current: {
    source: string
    sourceId?: string
    sourceSession?: string
    incomplete: boolean
    pendingSource?: boolean
  },
  blocks: SpokenReply['blocks'],
) {
  const { sourceId, sourceSession } = current
  if (sourceId && sourceSession && blocks.length) {
    const example = { sourceId, session: sourceSession, blocks }
    return { example, blocks }
  }
  if (
    sourceId &&
    previous &&
    previous.session === sourceSession &&
    (current.source.trimEnd().endsWith(currentExampleMarker) ||
      quotesExample(current.source, previous.blocks))
  )
    return { example: previous, blocks: previous.blocks }
  return { example: current.incomplete || current.pendingSource ? previous : null, blocks: [] }
}

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
  if (!origin) {
    const answer = delegatedSource(items, latest, priorIds)
    return {
      id: latest.id!,
      captionIds: [latest.id!],
      userItemId,
      awaitingLink: latest.liveComplete === false,
      text: latest.text,
      source: answer?.text ?? '',
      sourceId: answer?.id,
      sourceSession: answer?.timingSession,
      pendingSource: !answer && !!latest.liveAfter && !latest.liveAfter.startsWith('live:'),
      incomplete: latest.liveComplete === false,
    }
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
    sourceId: answer?.id,
    sourceSession: origin.sessionId,
    pendingSource: !answer,
    incomplete: latest.liveComplete === false,
  }
}
