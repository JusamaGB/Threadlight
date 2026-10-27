import type { ThreadProvider, ThreadVisibleItem, ThreadStatus } from '../../shared/threadRead'
import { isObject, str } from '../sessions/json'
import { codexDisplayText, codexUserRequest } from '../codex/presentation'
import { readCodexPlan } from '../codex/plan'
import { unknownStatus } from './types'

export const timestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value
  const n = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) ? n : null
}
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(isObject)
          .filter((b) => ['text', 'input_text', 'output_text'].includes(String(b.type)))
          .map((b) => str(b.text) ?? '')
          .join('\n')
      : ''

function visibleRequest(text: string): string | null {
  // Provider-generated context can share a user record with a real request.
  const cleaned = text
    .replace(/^\s*<threadlight-briefing>[\s\S]*?<\/threadlight-briefing>\s*/, '')
    .replace(/^# AGENTS\.md instructions\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
    .trim()
  return codexUserRequest(cleaned)
}

/** Allowlist visible forms. Raw tool outputs and internal envelopes never enter model context. */
export function normalize(
  provider: ThreadProvider,
  raw: unknown,
  source: string,
  fallbackId: string,
): ThreadVisibleItem[] {
  if (!isObject(raw)) return []
  const item = isObject(raw.payload) ? raw.payload : raw
  if (
    [item.channel, item.phase, raw.channel, raw.phase].some((value) =>
      ['analysis', 'reasoning', 'thinking'].includes(String(value)),
    )
  )
    return []
  const base = {
    id: str(item.id) ?? str(raw.uuid) ?? fallbackId,
    source,
    at: timestamp(raw.timestamp ?? item.timestamp),
    turnId: str(raw.turn_id) ?? str(item.turn_id) ?? str(item.turnId),
    complete: true,
  }
  if (provider === 'codex') {
    if (['function_call_output', 'functionCallOutput'].includes(String(item.type)))
      return [
        {
          ...base,
          role: 'activity',
          kind: 'tool',
          phase: 'progress',
          text: 'Tool response received.',
          resolvedCallId: str(item.call_id) ?? undefined,
        },
      ]
    // Rollout event messages duplicate response_item text. Keep one authoritative representation.
    if (raw.type === 'event_msg' && ['user_message', 'agent_message'].includes(String(item.type)))
      return []
    const plan = readCodexPlan(raw)
    if (plan)
      return [
        {
          ...base,
          role: 'activity',
          kind: 'plan',
          phase: 'progress',
          text: plan.planText ?? plan.plan.map((p) => `${p.status}: ${p.content}`).join('\n'),
        },
      ]
    if (item.type === 'userMessage' || (item.type === 'message' && item.role === 'user')) {
      const text = visibleRequest(textOf(item.content) || str(item.message) || '')
      return text ? [{ ...base, text, role: 'user', kind: 'message', phase: 'request' }] : []
    }
    if (item.type === 'agentMessage' || (item.type === 'message' && item.role === 'assistant')) {
      const text = codexDisplayText(str(item.text) || textOf(item.content))
      const phase =
        item.phase === 'commentary' || item.channel === 'commentary'
          ? 'progress'
          : item.phase === 'final_answer' ||
              item.channel === 'final' ||
              item.type === 'agentMessage'
            ? 'final'
            : 'unknown'
      return text
        ? [
            {
              ...base,
              text,
              role: 'assistant',
              kind: 'message',
              phase,
              complete: item.status !== 'inProgress' && phase === 'final',
            },
          ]
        : []
    }
    if (
      ['function_call', 'functionCall', 'mcpToolCall', 'commandExecution'].includes(
        String(item.type),
      )
    ) {
      const name = str(item.name) ?? str(item.tool) ?? String(item.type)
      let args: unknown = item.arguments
      try {
        if (typeof args === 'string') args = JSON.parse(args)
      } catch {
        args = null
      }
      if (
        /request_user_input(?:_async)?$/.test(name) &&
        isObject(args) &&
        Array.isArray(args.questions)
      ) {
        const text = args.questions
          .filter(isObject)
          .map((q) => str(q.question) ?? str(q.title) ?? '')
          .filter(Boolean)
          .join('\n')
        return text
          ? [
              {
                ...base,
                text: `Observed question (response availability unverified): ${text}`,
                role: 'activity',
                kind: 'attention',
                phase: 'progress',
                complete: false,
                callId: str(item.call_id) ?? str(item.id) ?? undefined,
                blocking: !name.endsWith('_async'),
              },
            ]
          : []
      }
      return [
        {
          ...base,
          text: `Tool: ${name.slice(0, 200)}`,
          role: 'activity',
          kind: 'tool',
          phase: 'progress',
        },
      ]
    }
    return []
  }
  if (
    raw.isMeta === true ||
    raw.type === 'system' ||
    raw.type === 'progress' ||
    raw.isSidechain === true
  )
    return []
  const message = isObject(raw.message) ? raw.message : {}
  const role = raw.type ?? message.role
  if (role !== 'user' && role !== 'assistant') return []
  const content = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: message.content }]
  const items: ThreadVisibleItem[] = []
  for (const [i, block] of content.entries()) {
    if (!isObject(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = role === 'user' ? visibleRequest(block.text) : block.text
      if (role === 'user' && /^\s*<task-notification>/.test(block.text)) {
        const summary = block.text.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]
        if (summary)
          items.push({
            ...base,
            id: `${base.id}:${i}`,
            text: summary.slice(0, 2000),
            role: 'activity',
            kind: 'task',
            phase: 'progress',
          })
        continue
      }
      if (!text || /^\s*<(?:system-reminder|local-command|command-name)/.test(text)) continue
      items.push({
        ...base,
        id: `${base.id}:${i}`,
        text,
        role,
        kind: 'message',
        phase:
          role === 'user' ? 'request' : message.stop_reason === 'end_turn' ? 'final' : 'progress',
        complete: role === 'user' || message.stop_reason === 'end_turn',
      })
    } else if (block.type === 'tool_use') {
      const name = str(block.name) ?? 'Tool'
      const input = isObject(block.input) ? block.input : {}
      const plan =
        name === 'TodoWrite' && Array.isArray(input.todos)
          ? input.todos
              .filter(isObject)
              .map((t) => `${str(t.status) ?? ''}: ${str(t.content) ?? ''}`)
              .join('\n')
          : null
      const question =
        name === 'AskUserQuestion' && Array.isArray(input.questions)
          ? input.questions
              .filter(isObject)
              .map((q) => str(q.question) ?? '')
              .join('\n')
          : null
      items.push({
        ...base,
        id: str(block.id) ?? `${base.id}:${i}`,
        text: plan || question || `Tool: ${name.slice(0, 200)}`,
        role: 'activity',
        kind: plan ? 'plan' : question ? 'attention' : 'tool',
        phase: 'progress',
        complete: !question,
        callId: str(block.id) ?? undefined,
        blocking: !!question,
      })
    } else if (block.type === 'tool_result') {
      items.push({
        ...base,
        id: `${base.id}:${i}`,
        role: 'activity',
        kind: 'tool',
        phase: 'progress',
        text: block.is_error ? 'Tool reported an error.' : 'Tool response received.',
        resolvedCallId: str(block.tool_use_id) ?? undefined,
      })
    }
  }
  return items
}

export function rolloutStatus(records: unknown[]): ThreadStatus {
  let status = unknownStatus()
  for (const raw of records) {
    if (!isObject(raw)) continue
    const item = isObject(raw.payload) ? raw.payload : raw
    const state = (
      { task_started: 'working', turn_aborted: 'interrupted', task_complete: 'completed' } as const
    )[String(item.type) as 'task_started']
    if (state)
      status = {
        state,
        basis: 'provider_turn',
        at: timestamp(raw.timestamp),
        turnId: str(item.turn_id),
      }
  }
  return status
}

/** A synthetic request identity is explicit when the source has no native turn id. */
export function associateTurns(items: ThreadVisibleItem[]): ThreadVisibleItem[] {
  let turn: string | null = null
  return items.map((item) => {
    if (item.role === 'user') turn = item.turnId ?? `request:${item.id}`
    return { ...item, turnId: item.turnId ?? turn }
  })
}

export function normalizeRollout(
  records: { value: unknown; offset: number }[],
  nativeId: string,
): ThreadVisibleItem[] {
  let turnId: string | null = null
  return records.flatMap(({ value, offset }) => {
    if (!isObject(value)) return []
    const payload = isObject(value.payload) ? value.payload : value
    if (value.type === 'turn_context' || payload.type === 'task_started')
      turnId = str(payload.turn_id) ?? str(payload.id) ?? turnId
    return normalize('codex', value, 'codex_rollout', `rollout:${nativeId}:${offset}`).map(
      (item) => ({ ...item, turnId: item.turnId ?? turnId }),
    )
  })
}

/** Final-channel text may still be streaming while its native turn is active. */
export function applyTurnCompletion(
  items: ThreadVisibleItem[],
  status: ThreadStatus,
): ThreadVisibleItem[] {
  const associated = associateTurns(items)
  if (!['working', 'waiting'].includes(status.state)) return associated
  const latestRequest = associated.findLast((item) => item.role === 'user')
  return associated.map((item) => {
    const active = status.turnId && item.turnId === status.turnId
    const uncertain = !item.turnId || item.turnId.startsWith('request:')
    const latest = !latestRequest || item.turnId === latestRequest.turnId
    return item.role === 'assistant' && (active || (uncertain && latest))
      ? { ...item, complete: false }
      : item
  })
}
