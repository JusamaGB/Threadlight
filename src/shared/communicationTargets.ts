import { z } from 'zod'

// Preserve existing Claude IDs while keeping account chats distinct from work sessions.
export const communicationTarget = z
  .string()
  .regex(
    /^(?:(?:codex|chatgpt|perplexity):)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )

export function accountChatTarget(target: string) {
  if (!communicationTarget.safeParse(target).success) return undefined
  const match = /^(chatgpt|perplexity):(.+)$/.exec(target)
  return match ? { source: match[1] as 'chatgpt' | 'perplexity', id: match[2]! } : undefined
}
