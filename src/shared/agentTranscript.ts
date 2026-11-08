import { matchesSpeech, plainSpeech } from './speechCaption'
import { spokenProse } from './spokenProse'
import type { AgentItem } from './agent'
import type { ConversationCard } from './conversationEvents'

export function agentDisplayText(text: string): string {
  return text
    .replace(/^\s*<threadlight-briefing>[\s\S]*?<\/threadlight-briefing>\s*/, '')
    .replace(/^\s*<threadlight-app-state>[\s\S]*?<\/threadlight-app-state>\s*/, '')
}

export function voiceInput(text: string): string | null {
  const record =
    /^<realtime_delegation>\s*<input>([\s\S]*?)<\/input>\s*<transcript_delta>([\s\S]*?)<\/transcript_delta>\s*<\/realtime_delegation>$/.exec(
      agentDisplayText(text).trim(),
    )
  if (
    !record ||
    [record[1]!, record[2]!].some((value) =>
      /<\/?(?:input|transcript_delta|realtime_delegation)>/.test(value),
    ) ||
    !/^(?:user|assistant):/i.test(record[2]!.trim())
  )
    return null
  return record[1]!.trim()
}

export function liveUser(item: AgentItem) {
  return item.kind === 'you' && /^live:[^:]+$/.test(item.id ?? '')
}

// Speech recognition can repunctuate an earlier partial when it adds another phrase.
// Only use this comparison inside the observed segment and backing turn.
const words = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.,!?:;]+(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')

/** A transport record belongs to a native segment, never to a globally matching sentence. */
export function delegationLinks(items: AgentItem[]): Map<string, string> {
  const links = new Map<string, string>()
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const item of items)
    if (liveUser(item)) for (const id of item.voiceDelegationIds ?? []) links.set(id, item.id!)
  let segment: AgentItem | undefined, boundTurn: string | undefined
  let unmatched: AgentItem[] = []
  const link = (native: AgentItem, envelope: AgentItem) => {
    if (
      !envelope.id ||
      !envelope.backingTurnId ||
      (boundTurn && boundTurn !== envelope.backingTurnId)
    )
      return
    if (links.has(envelope.id)) {
      if (links.get(envelope.id) === native.id) boundTurn = envelope.backingTurnId
      return
    }
    const input = voiceInput(envelope.text)
    if (!input || !native.text.trim()) return
    const spoken = words(native.text),
      request = words(input)
    if (
      spoken !== request &&
      !spoken.startsWith(request + ' ') &&
      !(!native.liveComplete && request.startsWith(spoken))
    )
      return
    links.set(envelope.id, native.id!)
    boundTurn = envelope.backingTurnId
  }
  for (const item of items) {
    if (liveUser(item)) {
      segment = item
      boundTurn = undefined
      const predecessor = item.liveAfter && byId.get(item.liveAfter)
      if (predecessor)
        for (const envelope of unmatched)
          if (
            envelope.id === item.liveAfter ||
            envelope.backingTurnId === predecessor.backingTurnId
          )
            link(item, envelope)
      unmatched = []
    } else if (item.kind === 'you' && voiceInput(item.text) !== null) {
      if (segment) link(segment, item)
      if (!item.id || !links.has(item.id)) unmatched.push(item)
    } else if (
      item.kind === 'you' ||
      (!boundTurn && item.kind === 'agent' && item.id?.startsWith('live:'))
    ) {
      segment = undefined
      boundTurn = undefined
      unmatched = []
    }
  }
  return links
}

// Compare only a transcript tied to a specific appendSpeech handoff. Preserve code and operators.
const spokenText = plainSpeech

function representsAnswer(item: AgentItem, byId: Map<string, AgentItem>) {
  if (!item.narrationOf || item.kind !== 'agent') return false
  const answer = byId.get(item.narrationOf.itemId)
  if (
    answer?.kind !== 'agent' ||
    !answer.text.trim() ||
    (answer.backingTurnId && answer.backingTurnId !== item.narrationOf.turnId)
  )
    return false
  const full = spokenText(spokenProse(answer.text))
  const lead = item.narrationOf.tailAfter && spokenText(item.narrationOf.tailAfter)
  if (lead && !full.startsWith(lead)) return false
  const source = lead
    ? full.slice(lead.length).trimStart()
    : item.narrationOf.excerpt
      ? spokenText(item.narrationOf.excerpt)
      : full
  if (!lead && !full.startsWith(source)) return false
  return matchesSpeech(source, item.text, item.liveComplete === false)
}

export type TranscriptRow =
  | { kind: 'message'; key: string; item: AgentItem }
  | { kind: 'activity'; key: string; items: AgentItem[] }
  | { kind: 'card'; key: string; card: ConversationCard }

/** Reinsert saved Live items at observed predecessors when native history arrives on another page. */
type Entry = { item: AgentItem; key: string }
function historicalOrder(items: Entry[]) {
  const byId = new Set(items.map((i) => i.item.id))
  const after = new Map<string, Entry[]>()
  for (const entry of items) {
    const { item } = entry
    if (!item.liveAfter || !byId.has(item.liveAfter)) continue
    const siblings = after.get(item.liveAfter) ?? []
    siblings.push(entry)
    after.set(item.liveAfter, siblings)
  }
  const seen = new Set<Entry>(),
    result: Entry[] = []
  function append(first: Entry) {
    const stack = [first]
    while (stack.length) {
      const item = stack.pop()!
      if (seen.has(item)) continue
      seen.add(item)
      result.push(item)
      if (item.item.id) stack.push(...(after.get(item.item.id) ?? []).slice().reverse())
    }
  }
  items.filter(({ item }) => !item.liveAfter || !byId.has(item.liveAfter)).forEach(append)
  items.forEach(append)
  return result
}

export function agentTranscript(
  items: AgentItem[],
  cards: ConversationCard[],
  historical: boolean,
): TranscriptRow[] {
  const byId = new Map(items.flatMap((i) => (i.id ? [[i.id, i] as const] : [])))
  // Positional anchors refer to the original array, including a hidden narration.
  const entries = items.map((item, index) => ({ item, key: item.id ?? 'line:' + index }))
  const anchored = new Map<string, ConversationCard[]>()
  for (const card of cards) {
    const key = card.anchor ?? ''
    const list = anchored.get(key) ?? []
    list.push(card)
    anchored.set(key, list)
  }
  const ordered = historical ? historicalOrder(entries) : entries
  const links = delegationLinks(ordered.map(({ item }) => item))
  const details = new Map<string, string[]>()
  for (const { item, key } of ordered) {
    const segmentId = links.get(key)
    if (!segmentId || !byId.has(segmentId)) continue
    const records = details.get(segmentId) ?? []
    records.push(agentDisplayText(item.text))
    details.set(segmentId, records)
  }
  const captions = new Map<string, string[]>()
  const folded = new Set<AgentItem>()
  for (const { item } of ordered) {
    if (!representsAnswer(item, byId)) continue
    folded.add(item)
    const id = item.narrationOf!.itemId
    const details = captions.get(id) ?? []
    details.push(item.text)
    captions.set(id, details)
  }
  const shown = new Set<string>()
  const rows: TranscriptRow[] = []
  const addCard = (card: ConversationCard) =>
    rows.push({ kind: 'card', key: 'card:' + card.id, card })
  for (const { item, key } of ordered) {
    const id = links.get(key) ?? key,
      records = details.get(id)
    if (records && !shown.has(id)) {
      const original = byId.get(id)!
      rows.push({ kind: 'message', key: id, item: { ...original, audioDetails: records } })
      shown.add(id)
    } else if (
      !records &&
      !folded.has(item) &&
      !(item.kind === 'agent' && item.id?.startsWith('live:') && !item.text.trim())
    ) {
      if (item.kind === 'step' && !item.source) {
        const previous = rows.at(-1)
        if (previous?.kind === 'activity') previous.items.push(item)
        else rows.push({ kind: 'activity', key: 'activity:' + key, items: [item] })
      } else
        rows.push({
          kind: 'message',
          key,
          item: captions.has(key) ? { ...item, spokenDetails: captions.get(key) } : item,
        })
    }
    anchored.get(key)?.forEach(addCard)
    anchored.delete(key)
  }
  for (const card of cards) if (anchored.has(card.anchor ?? '')) addCard(card)
  return rows
}
