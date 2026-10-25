import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOLD_MS, Holds } from '../src/main/holds'

/** Every next-step answer ends by asking the thread to redraw the Claude app's box. */
const REFRESH =
  ' When you have done that, if you have the wrap_up tool, call it again so the Claude app replaces the box the user just answered with where things stand now.'

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
    { label: 'Yes, publish', message: 'Yes, publish the page.', appAction: null },
    { label: 'Commit', message: null, appAction: 'commit' },
    { label: 'Mystery', message: null, appAction: 'teleport' },
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
        'The user answered your question "Publish it?" in Threadlight, choosing "Yes, publish": Yes, publish the page.' +
        REFRESH,
    })
  })

  it('asks the thread to do an app action itself, but not one it does not know', () => {
    holds.holdNextStep('session-a', nextStep, reply)
    expect(holds.answerNextStep('session-a', { label: 'Mystery' }).ok).toBe(false)
    expect(holds.answerNextStep('session-a', { label: 'Commit' })).toEqual({ ok: true })
    expect(JSON.parse(replies[0]!)).toEqual({
      decision: 'block',
      reason:
        'The user answered your question "Publish it?" in Threadlight, choosing "Commit" (the Claude app\'s commit button, which Threadlight cannot press), so commit the changes now.' +
        REFRESH,
    })
  })

  it('hands back words of the user’s own, and refuses an unknown button', () => {
    holds.holdNextStep('session-a', nextStep, reply)
    expect(holds.answerNextStep('session-a', { label: 'Delete everything' }).ok).toBe(false)
    expect(holds.answerNextStep('session-a', { text: '   ' }).ok).toBe(false)
    expect(holds.answerNextStep('session-a', { text: 'Not yet, fix the title first' })).toEqual({
      ok: true,
    })
    expect(JSON.parse(replies[0]!).reason).toBe(
      'The user answered your question "Publish it?" in Threadlight, in their own words: Not yet, fix the title first' +
        REFRESH,
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

describe('approvals', () => {
  const permission = (tool: string, tool_input: object = {}, sessionId = 'session-a') => ({
    session_id: sessionId,
    hook_event_name: 'PermissionRequest',
    tool_name: tool,
    tool_input,
  })

  it('holds a tool with the gist of what it wants, and allows it', () => {
    expect(holds.holdApproval(permission('Bash', { command: 'git push' }), reply)).toBe(true)
    expect(holds.held('session-a')).toMatchObject({
      kind: 'approval',
      tool: 'Bash',
      detail: 'git push',
    })
    expect(holds.answerApproval('session-a', { allow: true })).toEqual({ ok: true })
    expect(JSON.parse(replies[0]!)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
  })

  it('denies a plan with the user’s reason', () => {
    holds.holdApproval(permission('ExitPlanMode', { plan: '# Plan' }), reply)
    expect(holds.held('session-a')?.detail).toBe('# Plan')
    expect(holds.answerApproval('session-a', { allow: false, message: 'Smaller steps' })).toEqual({
      ok: true,
    })
    expect(JSON.parse(replies[0]!).hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'The user denied this in Threadlight, saying: Smaller steps',
    })
  })

  it('holds a session start, leaves question cards to their own hold, and refuses odd answers', () => {
    expect(holds.holdApproval(permission('AskUserQuestion'), reply)).toBe(false)
    expect(
      holds.holdApproval(permission('mcp__ccd_session__start_session', {}, 'session-b'), reply),
    ).toBe(true)
    holds.holdApproval(permission('Write', { file_path: 'a.txt' }), reply)
    expect(holds.answerApproval('session-a', { allow: 'yes' }).ok).toBe(false)
    expect(holds.answerQuestion('session-a', { 'Which colour?': 'Blue' }).ok).toBe(false)
    expect(replies).toEqual([])
  })
})

describe('session offers', () => {
  const offer = (tool_input: object, sessionId = 'session-a') => ({
    session_id: sessionId,
    tool_name: 'mcp__ccd_session__start_session',
    tool_input,
  })

  it('holds only an offer’s first call', () => {
    expect(holds.holdOffer(offer({ initiation: 'user_asked', title: 'Fix it' }), reply)).toBe(false)
    expect(
      holds.holdOffer(
        offer({ initiation: 'offer', title: 'Fix it', proposal_id: 'task_1' }),
        reply,
      ),
    ).toBe(false)
    expect(holds.holdOffer(offer({ initiation: 'offer', title: 'Fix it' }), reply)).toBe(true)
    expect(holds.held('session-a')).toMatchObject({ kind: 'offer', detail: 'Fix it' })
  })

  it('denies the call with the user’s choice, so the thread acts on it', () => {
    holds.holdOffer(offer({ initiation: 'offer', title: 'Fix it' }), reply)
    expect(holds.answerOffer('session-a', 'somewhere').ok).toBe(false)
    expect(holds.answerOffer('session-a', 'new-session')).toEqual({ ok: true })
    const output = JSON.parse(replies[0]!).hookSpecificOutput
    expect(output.permissionDecision).toBe('deny')
    expect(output.permissionDecisionReason).toContain('initiation "user_asked", title "Fix it"')

    holds.holdOffer(offer({ initiation: 'offer', title: 'Fix it' }, 'session-b'), reply)
    holds.answerOffer('session-b', 'here')
    expect(JSON.parse(replies[1]!).hookSpecificOutput.permissionDecisionReason).toContain(
      'choosing "Do it here"',
    )
  })
})
