import { z } from 'zod'

export const CHAT_RATE_LIMITED = 'The provider is limiting requests. Try again after the cooldown.'
export const chatSource = z.enum(['chatgpt', 'perplexity'])
export type ChatSource = z.infer<typeof chatSource>
export interface SharedDeliveryStatus {
  source: ChatSource
  sequence: number
  failed: boolean
}
export const conversationFilter = z.enum(['all', 'chat', 'code-computer'])
export type ConversationFilter = z.infer<typeof conversationFilter>
export const chatSourceName = (source: ChatSource) =>
  source === 'chatgpt' ? 'ChatGPT' : 'Perplexity'
export const chatCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('contexts') }).strict(),
  z
    .object({
      action: z.literal('list'),
      source: chatSource,
      callerId: z.string().uuid().optional(),
      more: z.boolean().optional(),
      poll: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('read'),
      source: chatSource,
      id: z.string().uuid(),
      older: z.boolean().optional(),
      latest: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('send'),
      source: chatSource,
      id: z.string().uuid(),
      operationId: z.string().uuid(),
      message: z.string().trim().min(1).max(20000),
    })
    .strict(),
  z
    .object({ action: z.literal('confirm-delivery'), source: chatSource, id: z.string().uuid() })
    .strict(),
  z.object({ action: z.literal('disconnect'), source: chatSource }).strict(),
])
export type ChatCommand = z.infer<typeof chatCommand>
export interface ChatSummary {
  id: string
  title: string
  updatedAt: number | null
  /** Only a reported provider state can make a chat active; recency is not activity. */
  activity?: 'active' | 'idle'
}
export function visibleAccountChats(
  chats: ChatSummary[],
  view: 'active' | 'recent' | 'workspace' | 'all',
  now: number,
  hours: number,
  limit: number,
): ChatSummary[] {
  // Account chats have no verified filesystem workspace association.
  if (view === 'workspace') return []
  const matching = chats
    .filter((chat) =>
      view === 'active'
        ? chat.activity === 'active'
        : view === 'recent'
          ? chat.updatedAt !== null && chat.updatedAt >= now - hours * 3600000
          : true,
    )
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return view === 'recent' ? matching.slice(0, limit) : matching
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  truncated: boolean
  sources?: { title: string; url: string }[]
  followUps?: string[]
  steps?: { id: string; title: string; status?: string }[]
}

/** Match the desktop's external-link policy; never navigate to provider-supplied schemes. */
export function chatLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}
export interface ChatPage {
  id: string
  messages: ChatMessage[]
  hasMore: boolean
  limited: boolean
  activity?: 'active' | 'idle'
  canSend?: boolean
  deliveryUncertain?: boolean
}
export type ChatReply =
  | { ok: false; reason: string; busy?: boolean; retryAt?: number }
  | { ok: true; kind: 'contexts'; contexts: { id: string; title: string }[] }
  | {
      ok: true
      kind: 'list'
      chats: ChatSummary[]
      hasMore: boolean
      recentOnly: boolean
      repliesAvailable?: boolean
      sharedDelivery?: SharedDeliveryStatus
    }
  | { ok: true; kind: 'read'; page: ChatPage }
  | { ok: true; kind: 'sent'; id: string; operationId: string }
  | { ok: true; kind: 'delivery-confirmed' }
  | { ok: true; kind: 'disconnected' }
