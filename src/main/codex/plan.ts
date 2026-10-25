import type { PlanItem } from '../../shared/types'
import { isObject, str } from '../sessions/json'

export interface CodexPlan {
  plan: PlanItem[]
  planText: string | null
}

/** Plans are explicit Codex events, never guessed from ordinary replies or reasoning. */
export function readCodexPlan(record: Record<string, unknown>): CodexPlan | null {
  const item = isObject(record['payload']) ? record['payload'] : record
  const type = str(item['type'])
  let value: unknown
  if (record['method'] === 'turn/plan/updated' && isObject(record['params']))
    value = record['params']['plan']
  else if (type === 'plan_update' || type === 'turn_plan_updated') value = item['plan']
  else if (
    (type === 'function_call' || type === 'functionCall') &&
    /(?:^|\.)update_plan$/.test(str(item['name']) || '')
  ) {
    try {
      const args: unknown =
        typeof item['arguments'] === 'string' ? JSON.parse(item['arguments']) : item['arguments']
      if (isObject(args)) value = args['plan']
    } catch {
      /* incomplete streaming arguments */
    }
  }
  if (Array.isArray(value)) {
    const plan: PlanItem[] = []
    for (const entry of value) {
      if (!isObject(entry)) return null
      const content = str(entry['step']) || str(entry['content'])
      const status = entry['status'] === 'inProgress' ? 'in_progress' : entry['status']
      if (!content || !['pending', 'in_progress', 'completed'].includes(String(status))) return null
      plan.push({ content, status: status as PlanItem['status'] })
    }
    return { plan, planText: null }
  }
  if (type === 'plan' && typeof item['text'] === 'string')
    return { plan: [], planText: item['text'].trim() || null }
  if (
    type === 'agentMessage' ||
    type === 'agent_message' ||
    (type === 'message' && item['role'] === 'assistant')
  ) {
    const text =
      str(item['text']) ||
      str(item['message']) ||
      (Array.isArray(item['content'])
        ? item['content']
            .filter(isObject)
            .map((part) => str(part['text']) || '')
            .join('\n')
        : '')
    const proposed = text.match(/<proposed_plan>([\s\S]*?)<\/proposed_plan>/)
    if (proposed) return { plan: [], planText: proposed[1]!.trim() || null }
  }
  return null
}
