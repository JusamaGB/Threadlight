import { describe, expect, it } from 'vitest'
import { MicSessionRouter } from '../src/shared/voiceCommands'

describe('microphone session routing', () => {
  it('treats a long conversational opening as conversation even when it begins with open', () => {
    const text =
      'Open the project and help me understand why all the tests started failing yesterday'
    const session = new MicSessionRouter()
    expect(session.preview('Open the project')).toBe(false)
    expect(session.mode).toBe('undecided')
    expect(session.preview(text)).toBe(true)
    expect(session.mode).toBe('undecided')
    expect(session.route(text)).toEqual({ kind: 'agent', text })
    expect(session.route('Open')).toEqual({ kind: 'agent', text: 'Open' })
  })

  it('preserves long known titles and their incomplete previews as commands', () => {
    const title = 'Review all the changes to the voice agent and the microphone session routing'
    const names = [{ id: 'long', title }]
    const session = new MicSessionRouter()
    expect(
      session.preview('Open Review all the changes to the voice agent and the microphone', names),
    ).toBe(false)
    expect(session.route(`Open ${title}`, names)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'long' },
    })
    expect(session.preview('Please help me discuss an entirely different subject now')).toBe(false)
  })
  const threads = [
    { id: 'one', title: 'Review ThreadLight Codex support' },
    { id: 'two', title: 'Review ThreadLight layouts' },
    { id: 'three', title: 'Café — release 2' },
  ]

  it('opens a named thread immediately and keeps subsequent speech in commands', () => {
    const session = new MicSessionRouter()
    expect(session.route('Open Codex support.', threads)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'one' },
    })
    expect(session.mode).toBe('commands')
    expect(session.route('Please send a message', threads)).toEqual({
      kind: 'unmatched',
      text: 'Please send a message',
    })
    expect(session.route('Café release 2!', threads)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'three' },
    })
  })

  it('accepts a title after open and resolves against the latest list', () => {
    const session = new MicSessionRouter()
    session.route('Open')
    expect(session.route('review threadlight codex support', threads)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'one' },
    })
    expect(session.route('open New thread', [{ id: 'new', title: 'New thread' }])).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'new' },
    })
    expect(session.route('Codex support', [])).toEqual({ kind: 'unmatched', text: 'Codex support' })
  })

  it('keeps ambiguous names in commands without choosing a thread', () => {
    const session = new MicSessionRouter()
    expect(session.route('Open Review ThreadLight', threads)).toEqual({
      kind: 'command',
      command: { kind: 'ambiguous', titles: threads.slice(0, 2).map((t) => t.title) },
    })
    expect(session.mode).toBe('commands')
    expect(session.route('layouts', threads)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'two' },
    })
  })

  it('prefers full titles, deduplicates IDs, and rejects duplicate titles and word fragments', () => {
    const session = new MicSessionRouter()
    session.route('open')
    const exact = { id: 'exact', title: 'Codex' }
    expect(session.route('Codex', [...threads, exact, exact])).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'exact' },
    })
    expect(session.route('Codex', [exact, { ...exact, id: 'duplicate' }])).toEqual({
      kind: 'command',
      command: { kind: 'ambiguous', titles: ['Codex', 'Codex'] },
    })
    expect(session.route('code', threads)).toEqual({ kind: 'unmatched', text: 'code' })
  })

  it('treats spoken compound-word spacing as equivalent and prefers the complete title', () => {
    const names = [
      { id: 'review', title: 'Review Threadlight' },
      { id: 'support', title: 'Review ThreadLight Codex support' },
    ]
    const session = new MicSessionRouter()
    expect(session.route('Open review thread light.', names)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'review' },
    })
    expect(session.route('review thread light', names)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'review' },
    })
    expect(session.route('thread light codex', names)).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'support' },
    })
    expect(session.route('review thread', names)).toEqual({
      kind: 'unmatched',
      text: 'review thread',
    })
    expect(
      session.route('reviewthreadlight', [{ id: 'split', title: 'Review Thread Light' }]),
    ).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'split' },
    })
    expect(
      session.route('review thread light', [
        ...names,
        { id: 'duplicate', title: 'Review Thread Light' },
      ]),
    ).toEqual({
      kind: 'command',
      command: { kind: 'ambiguous', titles: ['Review Threadlight', 'Review Thread Light'] },
    })
  })

  it('requires open before a bare title and preserves agent routing once chosen', () => {
    const session = new MicSessionRouter()
    expect(session.route('Codex support', threads)).toEqual({
      kind: 'agent',
      text: 'Codex support',
    })
    expect(session.route('Open Codex support', threads)).toEqual({
      kind: 'agent',
      text: 'Open Codex support',
    })
  })

  it('keeps commands latched until a new microphone session', () => {
    const session = new MicSessionRouter()
    expect(session.route('Open.')).toEqual({ kind: 'command', command: { kind: 'open' } })
    expect(session.route('Please review the build')).toEqual({
      kind: 'unmatched',
      text: 'Please review the build',
    })
    expect(session.route('agent')).toEqual({ kind: 'unmatched', text: 'agent' })
    expect(session.mode).toBe('commands')
    expect(session.route('open')).toEqual({ kind: 'command', command: { kind: 'open' } })
    const reopened = new MicSessionRouter()
    expect(reopened.route('Please review the build')).toEqual({
      kind: 'agent',
      text: 'Please review the build',
    })
  })

  it('keeps ordinary speech, including later command words, in the agent message', () => {
    const session = new MicSessionRouter()
    expect(session.route('Please check the plan.')).toEqual({
      kind: 'agent',
      text: 'Please check the plan.',
    })
    expect(session.route('Open.')).toEqual({ kind: 'agent', text: 'Open.' })
    expect(session.mode).toBe('agent')
  })

  it.each([
    'Open review thread lines.',
    'Open missing thread',
    'Open the docs and check the plan.',
  ])('reserves command mode for an unmatched initial "%s"', (text) => {
    const session = new MicSessionRouter()
    expect(session.route(text, [])).toEqual({ kind: 'unmatched', text })
    expect(session.mode).toBe('commands')
    expect(
      session.route('Open review thread light.', [{ id: 'review', title: 'Review Threadlight' }]),
    ).toEqual({
      kind: 'command',
      command: { kind: 'focus', threadId: 'review' },
    })
    expect(session.route('Please help')).toEqual({ kind: 'unmatched', text: 'Please help' })
    expect(new MicSessionRouter().route('Please help')).toEqual({
      kind: 'agent',
      text: 'Please help',
    })
  })

  it('does not select a route from empty transcription', () => {
    const session = new MicSessionRouter()
    expect(session.route('  ')).toEqual({ kind: 'ignored' })
    expect(session.mode).toBe('undecided')
  })
})
