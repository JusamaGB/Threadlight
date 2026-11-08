import { z } from 'zod'

const id = z.string().uuid()
export const perplexityCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('discover') }).strict(),
  z.object({ action: z.literal('connect') }).strict(),
  z.object({ action: z.literal('disconnect') }).strict(),
  z.object({ action: z.literal('reconcile') }).strict(),
  z.object({ action: z.literal('read'), threadId: id }).strict(),
  z.object({ action: z.literal('open'), threadId: id }).strict(),
  z
    .object({
      action: z.literal('send'),
      message: z.string().trim().min(1).max(16000),
      threadId: id.optional(),
      operationId: id,
    })
    .strict(),
  z.object({ action: z.literal('cancel'), threadId: id, operationId: id }).strict(),
])
export type PerplexityCommand = z.infer<typeof perplexityCommand>
export interface PerplexityChat {
  id: string
  title: string
  preview: string
  status: string
  updatedAt: string | null
  archived: boolean
}
export interface PerplexityThread {
  id: string
  text: string
  status: string
  event: string
  truncated: boolean
  needsInput: boolean
}
export interface PerplexitySnapshot {
  desktop: {
    state: 'unchecked' | 'ready' | 'unavailable'
    checkedAt: number | null
    reason?: string
    hasMore: boolean
    chats: PerplexityChat[]
  }
  computer: {
    state: 'disconnected' | 'connecting' | 'authorizing' | 'connected' | 'error'
    reason?: string
    tools: string[]
  }
  busy: boolean
  thread: PerplexityThread | null
  /** Only IDs obtained from successful Computer operations may be read or continued. */
  computerThreads: { id: string; title: string }[]
  uncertainSend: boolean
}
export type PerplexityReply =
  | { ok: true; snapshot: PerplexitySnapshot }
  | { ok: false; reason: string; snapshot: PerplexitySnapshot }
export const emptyPerplexity = (): PerplexitySnapshot => ({
  desktop: { state: 'unchecked', checkedAt: null, hasMore: false, chats: [] },
  computer: { state: 'disconnected', tools: [] },
  busy: false,
  thread: null,
  computerThreads: [],
  uncertainSend: false,
})
