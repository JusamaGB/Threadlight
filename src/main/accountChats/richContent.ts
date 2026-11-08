import { z } from 'zod'
import { chatLink, type ChatMessage } from '../../shared/accountChats'

const source = z.object({ name: z.string().max(4000).optional(), url: z.string().max(8000) })
const goal = z.object({
  id: z.string().min(1).max(300),
  description: z.string().trim().min(1).max(4000),
  todo_task_status: z.string().max(100).optional(),
})
const plan = z.object({ goals: z.array(z.unknown()).max(500).optional() })
const results = z.object({ web_results: z.array(z.unknown()).max(500) })
const statuses: Record<string, string> = {
  INCOMPLETE: 'Incomplete',
  COMPLETE: 'Complete',
  COMPLETED: 'Complete',
  IN_PROGRESS: 'In progress',
  PENDING: 'Pending',
  BLOCKED: 'Blocked',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
}

/** Project only observed display fields. Tokens, raw tool payloads and inferred actions stay out. */
export function perplexityContent(
  blocks: { web_result_block?: unknown; plan_block?: unknown }[],
  related: unknown,
): Pick<ChatMessage, 'sources' | 'steps' | 'followUps'> {
  const sources = new Map<string, { title: string; url: string }>()
  const steps = new Map<string, { id: string; title: string; status?: string }>()
  for (const block of blocks) {
    const web = results.safeParse(block.web_result_block)
    if (web.success)
      for (const value of web.data.web_results) {
        const parsed = source.safeParse(value)
        if (!parsed.success) continue
        const url = chatLink(parsed.data.url)
        if (url && sources.size < 50)
          sources.set(url, { url, title: parsed.data.name?.trim() || new URL(url).hostname })
      }
    const parsed = plan.safeParse(block.plan_block)
    if (parsed.success)
      for (const value of parsed.data.goals ?? []) {
        const item = goal.safeParse(value)
        if (!item.success) continue
        const { id, description, todo_task_status } = item.data
        // A final plan block does not mean its goals completed. Use only explicit goal state.
        if (steps.has(id) || steps.size < 50)
          steps.set(id, {
            id,
            title: description,
            ...(todo_task_status && Object.hasOwn(statuses, todo_task_status)
              ? { status: statuses[todo_task_status] }
              : {}),
          })
      }
  }
  const followUps = Array.isArray(related)
    ? [
        ...new Set(
          related
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => v.length > 0 && v.length <= 2000),
        ),
      ].slice(0, 6)
    : []
  return {
    ...(sources.size ? { sources: [...sources.values()] } : {}),
    ...(steps.size ? { steps: [...steps.values()] } : {}),
    ...(followUps.length ? { followUps } : {}),
  }
}
