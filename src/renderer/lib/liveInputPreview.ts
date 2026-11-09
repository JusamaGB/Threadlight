import { createContext } from 'react'
import type { AgentItem, AgentState } from '../../shared/agent'
import { liveUser } from '../../shared/agentTranscript'

export interface InputCaption {
  session: string
  turn: string
  text: string
}
export interface LiveInputPreview extends InputCaption {
  owner: string | null
  after: string | undefined
  previousText?: string
}
export const LiveInputContext = createContext<LiveInputPreview | null>(null)

export function anchorInputCaption(
  caption: InputCaption,
  prior: LiveInputPreview | null,
  agent: AgentState,
): LiveInputPreview {
  if (
    prior?.session === caption.session &&
    prior.turn === caption.turn &&
    prior.owner === agent.conversationId
  )
    return { ...prior, text: caption.text }
  const last = agent.items.at(-1)
  const previousText =
    prior?.session === caption.session && prior.owner === agent.conversationId
      ? prior.text.trim()
      : undefined
  const currentPartial =
    last &&
    liveUser(last) &&
    !last.liveComplete &&
    (last.liveUserTurnId
      ? last.liveUserTurnId === caption.turn
      : !previousText || !previousText.startsWith(last.text.trim()))
  const anchor = currentPartial ? agent.items.at(-2) : last
  return { ...caption, owner: agent.conversationId, after: anchor?.id, previousText }
}

/** Project onto the current reader only. History and voice delegation use the
 * original native items, never speculative input from the display. */
export function withLiveInputPreview(
  items: AgentItem[],
  draft: LiveInputPreview | null,
): AgentItem[] {
  if (!draft?.text.trim()) return items
  const anchor = draft.after ? items.findIndex((item) => item.id === draft.after) : -1
  if (draft.after && anchor < 0) return items
  const at = anchor + 1
  let native = items.findIndex((item) => liveUser(item) && item.liveUserTurnId === draft.turn)
  if (native < 0)
    native = items.findIndex(
      (item, index) =>
        index >= at &&
        liveUser(item) &&
        !item.liveUserTurnId &&
        (!draft.previousText ||
          item.text.trim() !== draft.previousText ||
          draft.text.trim() === draft.previousText),
    )
  if (native >= 0) {
    const row = items[native]!
    if (row.liveComplete || row.text.trim().length >= draft.text.trim().length) return items
    const projected = items.slice()
    projected[native] = { ...row, text: draft.text }
    return projected
  }
  return [
    ...items.slice(0, at),
    { id: 'live:preview-' + draft.turn, kind: 'you', text: draft.text, liveComplete: false },
    ...items.slice(at),
  ]
}
