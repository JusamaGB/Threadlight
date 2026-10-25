import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOLD_MS, Holds } from '../src/main/holds'

const questions = [
  { question: 'Which colour?', header: 'Colour', options: [{ label: 'Blue' }, { label: 'Green' }] },
  { question: 'Which size?', header: 'Size', options: [{ label: 'Small' }, { label: 'Large' }] },
]
const asked = (sessionId = 'session-a') => ({
  session_id: sessionId,
  tool_name: 'AskUserQuestion',
  tool_input: { questions },
})
const nextStep = {
  ask: 'Publish it?',
  actions: [
    { label: 'Yes, publish', message: 'Yes, publish the page.' },
    { label: 'Commit', message: null },
  ],
}

let holds: Holds
let changes: number
let replies: (string | null)[]
const reply = (body: string | null) => replies.push(body)

beforeEach(() => {
  vi.useFakeTimers()
  changes = 0
  replies = []
  holds = new Holds(() => (changes += 1))
})
afterEach(() => vi.useRealTimers())

describe('question cards', () => {
  it('holds a card and hands back every answer in the PreToolUse shape', () => {
    expect(holds.holdQuestion(asked(), reply)).toBe(true)
    expect(holds.held('session-a')?.kind).toBe('question')
    expect(
      holds.answerQuestion('session-a', { 'Which colour?': 'Green', 'Which size?': 'Small' }),
    ).toEqual({ ok: true })
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
    holds.holdQuestion(asked(), reply)
    expect(holds.answerQuestion('session-a', { 'Which shape?': 'Round' }).ok).toBe(false)
    expect(holds.answerQuestion('session-a', {}).ok).toBe(false)
    expect(replies).toEqual([]) // still held
    holds.release('session-a')
    expect(replies).toEqual([null])
    expect(holds.answerQuestion('session-a', { 'Which colour?': 'Blue' }).ok).toBe(false)
  })

  it('ignores anything that is not a question card', () => {
    expect(
      holds.holdQuestion({ session_id: 'session-a', tool_name: 'Bash', tool_input: {} }, reply),
    ).toBe(false)
    expect(
      holds.holdQuestion({ tool_name: 'AskUserQuestion', tool_input: { questions } }, reply),
    ).toBe(false)
    expect(holds.sessionIds()).toEqual([])
  })
})

describe('next steps', () => {
  it('hands back a picked button as the reason to carry on, with that button’s own message', () => {
    holds.holdNextStep('session-a', nextStep, reply)
    expect(holds.held('session-a')?.kind).toBe('next-step')
    expect(holds.answerNextStep('session-a', { label: 'Yes, publish' })).toEqual({ ok: true })
    expect(JSON.parse(replies[0]!)).toEqual({
      decision: 'block',
      reason:
        'The user answered your question "Publish it?" in Threadlight, choosing "Yes, publish": Yes, publish the page.',
    })
  })

  it('hands back words of the user’s own, and refuses an unknown or app-only button', () => {
    holds.holdNextStep('session-a', nextStep, reply)
    expect(holds.answerNextStep('session-a', { label: 'Delete everything' }).ok).toBe(false)
    expect(holds.answerNextStep('session-a', { label: 'Commit' }).ok).toBe(false) // app action
    expect(holds.answerNextStep('session-a', { text: '   ' }).ok).toBe(false)
    expect(holds.answerNextStep('session-a', { text: 'Not yet, fix the title first' })).toEqual({
      ok: true,
    })
    expect(JSON.parse(replies[0]!).reason).toBe(
      'The user answered your question "Publish it?" in Threadlight, in their own words: Not yet, fix the title first',
    )
  })

  it('does not take a question card’s answers, or the other way round', () => {
    holds.holdNextStep('session-a', nextStep, reply)
    expect(holds.answerQuestion('session-a', { 'Which colour?': 'Blue' }).ok).toBe(false)
    holds.holdQuestion(asked('session-b'), reply)
    expect(holds.answerNextStep('session-b', { label: 'Yes, publish' }).ok).toBe(false)
  })
})

describe('letting go', () => {
  it('lets a card go on its own after the hold time', () => {
    holds.holdQuestion(asked(), reply)
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(replies).toEqual([])
    vi.advanceTimersByTime(1)
    expect(replies).toEqual([null])
    expect(holds.held('session-a')).toBeNull()
  })

  it('lets every card go at once, and forgets one whose hook stopped waiting', () => {
    const other: (string | null)[] = []
    holds.holdQuestion(asked('session-a'), reply)
    holds.holdNextStep('session-b', nextStep, (body) => other.push(body))
    holds.dropped(reply)
    expect(holds.sessionIds()).toEqual(['session-b'])
    holds.releaseAll()
    expect(other).toEqual([null])
    expect(replies).toEqual([]) // a dropped hook is not answered
    expect(changes).toBeGreaterThanOrEqual(3)
  })
})
