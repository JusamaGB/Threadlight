import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOLD_MS, QuestionHolds } from '../src/main/questionHolds'

const questions = [
  { question: 'Which colour?', header: 'Colour', options: [{ label: 'Blue' }, { label: 'Green' }] },
  { question: 'Which size?', header: 'Size', options: [{ label: 'Small' }, { label: 'Large' }] },
]
const asked = (sessionId = 'session-a') => ({
  session_id: sessionId,
  tool_name: 'AskUserQuestion',
  tool_input: { questions },
})

let holds: QuestionHolds
let changes: number
let replies: (string | null)[]
const reply = (body: string | null) => replies.push(body)

beforeEach(() => {
  vi.useFakeTimers()
  changes = 0
  replies = []
  holds = new QuestionHolds(() => (changes += 1))
})
afterEach(() => vi.useRealTimers())

describe('QuestionHolds', () => {
  it('holds a question card and hands back every answer in the PreToolUse shape', () => {
    expect(holds.hold(asked(), reply)).toBe(true)
    expect(holds.held('session-a')).not.toBeNull()
    expect(holds.answer('session-a', { 'Which colour?': 'Green', 'Which size?': 'Small' })).toEqual(
      { ok: true },
    )
    expect(JSON.parse(replies[0]!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { questions, answers: { 'Which colour?': 'Green', 'Which size?': 'Small' } },
      },
    })
    expect(holds.held('session-a')).toBeNull()
  })

  it('refuses answers to questions that were not asked, and anything once let go', () => {
    holds.hold(asked(), reply)
    expect(holds.answer('session-a', { 'Which shape?': 'Round' }).ok).toBe(false)
    expect(holds.answer('session-a', {}).ok).toBe(false)
    expect(replies).toEqual([]) // still held
    holds.release('session-a')
    expect(replies).toEqual([null])
    expect(holds.answer('session-a', { 'Which colour?': 'Blue' }).ok).toBe(false)
  })

  it('lets the card go on its own after the hold time', () => {
    holds.hold(asked(), reply)
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(replies).toEqual([])
    vi.advanceTimersByTime(1)
    expect(replies).toEqual([null])
    expect(holds.held('session-a')).toBeNull()
  })

  it('lets every card go at once, and forgets one whose hook stopped waiting', () => {
    const other: (string | null)[] = []
    holds.hold(asked('session-a'), reply)
    holds.hold(asked('session-b'), (body) => other.push(body))
    holds.dropped(reply)
    expect(holds.sessionIds()).toEqual(['session-b'])
    holds.releaseAll()
    expect(other).toEqual([null])
    expect(replies).toEqual([]) // a dropped hook is not answered
    expect(changes).toBeGreaterThanOrEqual(3)
  })

  it('ignores anything that is not a question card', () => {
    expect(holds.hold({ session_id: 'session-a', tool_name: 'Bash', tool_input: {} }, reply)).toBe(
      false,
    )
    expect(holds.hold({ tool_name: 'AskUserQuestion', tool_input: { questions } }, reply)).toBe(
      false,
    )
    expect(holds.sessionIds()).toEqual([])
  })
})
