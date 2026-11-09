import type { AgentItem } from './agent'
import { z } from 'zod'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { delegationLinks, liveUser } from './agentTranscript'
import { spokenProse } from './spokenProse'
import { matchesSpeech } from './speechCaption'

export const spokenReplySchema = z.object({
  id: z.string(),
  captionIds: z.array(z.string()).optional(),
  awaitingLink: z.boolean().optional(),
  userItemId: z.string().optional(),
  exampleId: z.string().optional(),
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
  userItemId?: string
  caption?: string
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

/** Only an explicit redisplay of this example may reuse its written blocks on
 * a new request. Named alternatives and revisions are resolved by the Agent. */
function asksForReplay(text: string, blocks: SpokenReply['blocks']) {
  const request = text
    .toLowerCase()
    .trim()
    .replace(/[,.!?]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:uh |um )?(?:sorry )?(?:i meant )?/, '')
    .replace(/^(?:(?:can|could|would) you |please )/, '')
    .replace(/ please$/, '')
    .replace(/ in (?:the |this )?thread$/, '')
  if (
    /\bpython\b/.test(request) &&
    (blocks.length !== 1 || !/^(?:python|py)$/i.test(blocks[0]!.language))
  )
    return false
  if (blocks.length > 1 && /\b(?:example|file|string|snippet|block)\b/.test(request)) return false
  if (
    !/\b(?:again|repeat|bring back|same|previous|last|you (?:gave|showed) me)\b/.test(request) &&
    !/^(?:show(?: me)?|display) (?:that|this|it)$/.test(request)
  )
    return false
  return /^(?:show(?: me)?|display|repeat|bring back) (?:that|this|it|(?:the|that|this|the same|the previous|the last) (?:python |code )?(?:example|string|snippet|block|file|code|python))(?: again)?(?: the (?:string|example|one) you (?:gave|showed) me)?$/.test(
    request,
  )
}

type BlockReader = (text: string) => SpokenReply['blocks']

/** Project the current learner request independently of caption delivery order.
 * Speech attribution remains untouched in the transcript. Only a written answer
 * linked by delegation or narration may introduce new code into the pill. */
export function presentSpokenReply(
  items: AgentItem[],
  priorIds: ReadonlySet<string>,
  excludedSources: ReadonlySet<string>,
  previous: SpokenExample | null,
  readBlocks: BlockReader,
): { reply: SpokenReply | null; example: SpokenExample | null } {
  const userIndex = items.findLastIndex(
    (item) => item.kind === 'you' && (liveUser(item) || !item.backingTurnId),
  )
  const boundary = items[userIndex]
  const user = boundary?.id && priorIds.has(boundary.id) ? undefined : boundary
  const links = delegationLinks(items)
  const owners = new Map<string, string>()
  for (const item of items) {
    const owner = item.id && links.get(item.id)
    if (owner && item.backingTurnId) owners.set(item.backingTurnId, owner)
  }
  const ignored = new Set(priorIds)
  const narrated = new Map<string, NonNullable<AgentItem['narrationOf']>>()
  const indices = new Map(items.map((item, index) => [item.id, index]))
  const precedesRequest = (id?: string) => !!id && (indices.get(id) ?? userIndex) < userIndex
  for (const [index, item] of items.entries()) {
    if (item.kind !== 'agent' || !item.id?.startsWith('live:')) continue
    const link = item.narrationOf
    const owner = link && owners.get(link.turnId)
    if (
      index < userIndex ||
      (owner && owner !== user?.id) ||
      ((precedesRequest(item.liveAfter) || precedesRequest(link?.itemId)) &&
        (!owner || owner !== user?.id)) ||
      (item.liveAfter && ignored.has(item.liveAfter))
    ) {
      ignored.add(item.id)
    } else if (link && !ignored.has(item.id)) narrated.set(link.itemId, link)
  }
  const speech = latestSpokenReply(items, ignored)
  const verified = items.filter((item) => {
    if (
      item.kind !== 'agent' ||
      !item.id ||
      item.id.startsWith('live:') ||
      excludedSources.has(item.id)
    )
      return false
    const link = narrated.get(item.id)
    return (
      (link &&
        (!item.backingTurnId || item.backingTurnId === link.turnId) &&
        (!item.timingSession || item.timingSession === link.sessionId)) ||
      (user?.id &&
        item.timingSession &&
        item.backingTurnId &&
        owners.get(item.backingTurnId) === user.id)
    )
  })
  // A status-only answer can follow the code in the same delivered batch.
  // Recover the latest written example even on the first paint of that batch.
  let written = verified.at(-1)
  let blocks: SpokenReply['blocks'] = []
  for (let index = verified.length - 1; index >= 0; index--) {
    const item = verified[index]!
    blocks = readBlocks(item.text)
    if (blocks.length) {
      written = item
      break
    }
  }
  const session = written?.timingSession ?? (written?.id && narrated.get(written.id)?.sessionId)
  const carry =
    previous &&
    !excludedSources.has(previous.sourceId) &&
    (!session || session === previous.session)
      ? previous
      : null
  const sameRequest = !!user?.id && carry?.userItemId === user.id
  const replay =
    carry && user?.liveComplete !== false && user?.text && asksForReplay(user.text, carry.blocks)
  const source = written?.text ?? ''
  const selection = spokenExample(
    carry,
    {
      source,
      sourceId: written?.id,
      sourceSession: session,
      incomplete: speech?.incomplete ?? false,
    },
    blocks,
  )
  const card = replay
    ? carry
    : selection.blocks.length
      ? selection.example
      : sameRequest
        ? carry
        : null
  const caption = speech && {
    id: speech.id,
    captionIds: speech.captionIds,
    userItemId: user?.id ?? speech.userItemId,
    awaitingLink: speech.awaitingLink,
    text: speech.text,
    blocks: [],
  }
  if (!card)
    return {
      reply: caption,
      example: written || (speech?.incomplete === false && !speech.pendingSource) ? null : carry,
    }
  const sameCard = card.sourceId === carry?.sourceId && sameRequest
  const spoken =
    speech?.sourceId === written?.id && written && !speech?.incomplete ? speech?.text.trim() : ''
  const first =
    spoken && spoken.length <= 110 ? spoken : spoken?.match(/^.{1,110}?[.!?](?:\s|$)/)?.[0].trim()
  const short = first && !/[[\]{}_=\x60]/.test(first) ? first : undefined
  const language = card.blocks[0]?.language
  const label = language
    ? language.charAt(0).toUpperCase() + language.slice(1) + ' example'
    : 'Code example'
  const text = short ?? (sameCard ? carry?.caption : undefined) ?? label
  const exampleId = JSON.stringify([card.session, card.sourceId, user?.id ?? null])
  return {
    example: { ...card, userItemId: user?.id, caption: text },
    reply: {
      ...caption,
      id: caption?.id ?? exampleId,
      userItemId: user?.id,
      exampleId,
      text,
      blocks: card.blocks,
    },
  }
}
