import { randomUUID } from 'node:crypto'
import type { Attention, SessionState } from '../../shared/types'
import { isObject, str } from '../sessions/json'
import { CODEX_UUID, codexKey } from './identity'

/** Codex's waiting hooks give up after about a minute (codex-plugin/hooks), so holds do too. */
const HOLD_MS = 60_000

interface RecordState {
  state: SessionState
  at: number
  attention: Attention | null
}
interface Hold {
  id: string
  turn: string
  event: string
  at: number
  reply: (body: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

export function endQuestion(text: string | null): Attention | null {
  if (!text) return null
  const last =
    text
      .trim()
      .split(/\n\s*\n/)
      .at(-1)
      ?.trim() || ''
  if (!last.endsWith('?') || last.length > 4000) return null
  return { kind: 'next-step', recap: null, ask: last, actions: [], answerableUntil: null }
}

/** Separate from Claude holds: Codex decisions have a different wire contract. */
export class CodexHolds {
  readonly records = new Map<string, RecordState>()
  private holds = new Map<string, Hold>()
  constructor(
    private readonly changed: () => void,
    private readonly now = Date.now,
  ) {}

  event(payload: unknown): void {
    if (!isObject(payload)) return
    const id = str(payload['session_id']),
      event = str(payload['hook_event_name'])
    if (!id || !CODEX_UUID.test(id) || !event || payload['agent_id']) return
    const key = codexKey(id)
    const question = event === 'Stop' ? endQuestion(str(payload['last_assistant_message'])) : null
    const nativeQuestion =
      event === 'PreToolUse' &&
      /request_user_input(?:_async)?$/.test(str(payload['tool_name']) || '')
    const state: SessionState =
      event === 'PermissionRequest' || nativeQuestion || question
        ? 'waiting'
        : ['Stop', 'SessionEnd', 'Interrupt', 'SessionStart'].includes(event)
          ? 'idle'
          : 'working'
    if (['UserPromptSubmit', 'SessionEnd', 'Interrupt'].includes(event)) this.release(key)
    this.records.set(key, {
      state,
      at: this.now(),
      attention: event === 'PermissionRequest' ? approvalAttention(payload) : question,
    })
    for (const [oldKey, record] of this.records)
      if (this.now() - record.at > 10 * 60_000 && !this.holds.has(oldKey))
        this.records.delete(oldKey)
    this.changed()
  }

  hold(payload: unknown, reply: (body: string | null) => void): boolean {
    if (!isObject(payload)) return false
    const rawId = str(payload['session_id']),
      turn = str(payload['turn_id']),
      event = str(payload['hook_event_name'])
    if (!rawId || !CODEX_UUID.test(rawId) || !turn || payload['agent_id']) return false
    if (event !== 'PermissionRequest' && event !== 'Stop') return false
    if (event === 'Stop' && payload['stop_hook_active'] === true) return false
    const attention: Attention | null =
      event === 'PermissionRequest'
        ? approvalAttention(payload)
        : endQuestion(str(payload['last_assistant_message']))
    if (!attention) return false
    const key = codexKey(rawId)
    this.release(key)
    const at = this.now(),
      id = randomUUID()
    if (attention.kind === 'approval' || attention.kind === 'next-step') {
      attention.answerableUntil = at + HOLD_MS
      attention.holdId = id
    }
    this.records.set(key, { state: 'waiting', at, attention })
    this.holds.set(key, {
      id,
      turn,
      event,
      at,
      reply,
      timer: setTimeout(() => this.release(key), HOLD_MS),
    })
    this.changed()
    return true
  }

  answer(
    key: string,
    holdId: unknown,
    value: unknown,
  ): { ok: true } | { ok: false; reason: string } {
    const hold = this.holds.get(key)
    if (!hold || hold.id !== holdId)
      return { ok: false, reason: 'This card is no longer waiting here. Open it in Codex.' }
    if (this.now() >= hold.at + HOLD_MS) {
      this.release(key)
      return { ok: false, reason: 'This card has timed out. Open it in Codex.' }
    }
    let output: object
    if (hold.event === 'PermissionRequest') {
      if (value !== 'allow' && value !== 'deny')
        return { ok: false, reason: 'Choose Allow once or Deny.' }
      output = {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: value,
            ...(value === 'deny'
              ? { message: 'The user declined this request in Threadlight.' }
              : {}),
          },
        },
      }
    } else {
      if (typeof value !== 'string' || !value.trim() || value.length > 4000)
        return { ok: false, reason: 'Type an answer (up to 4000 characters).' }
      output = { decision: 'block', reason: `The user answered in Threadlight: ${value.trim()}` }
    }
    this.finish(key, JSON.stringify(output))
    return { ok: true }
  }

  release(key: string): void {
    this.finish(key, null)
  }
  releaseAll(): void {
    for (const key of [...this.holds.keys()]) this.release(key)
  }
  dropped(reply: (body: string | null) => void): void {
    for (const [key, hold] of this.holds) if (hold.reply === reply) this.release(key)
  }
  private finish(key: string, body: string | null): void {
    const hold = this.holds.get(key)
    if (!hold) return
    clearTimeout(hold.timer)
    this.holds.delete(key)
    const record = this.records.get(key)
    if (record?.attention?.kind === 'approval') {
      record.attention.answerableUntil = null
      delete record.attention.holdId
    }
    if (record?.attention?.kind === 'next-step') {
      record.attention.answerableUntil = null
      delete record.attention.holdId
    }
    if (record && body !== null) {
      record.attention = null
      record.state = 'working'
      record.at = this.now()
    }
    hold.reply(body)
    this.changed()
  }
}

function approvalAttention(payload: Record<string, unknown>): Attention {
  const input = isObject(payload['tool_input']) ? payload['tool_input'] : {}
  return {
    kind: 'approval',
    tool: str(payload['tool_name']) || null,
    answerableUntil: null,
    action:
      (str(input['description']) || str(input['command']) || str(payload['tool_name']))?.slice(
        0,
        4000,
      ) || null,
  }
}
