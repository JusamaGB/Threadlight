import { describe, expect, it } from 'vitest'
import { MicSessionRouter } from '../src/shared/voiceCommands'

describe('microphone session routing', () => {
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
    expect(session.route('Please send a message', threads)).toEqual({ kind: 'ignored' })
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
    expect(session.route('Codex support', [])).toEqual({ kind: 'ignored' })
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
    expect(session.route('code', threads)).toEqual({ kind: 'ignored' })
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
    expect(session.route('Please review the build')).toEqual({ kind: 'ignored' })
    expect(session.route('agent')).toEqual({ kind: 'ignored' })
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
    expect(session.route('Open the docs and check the plan.')).toEqual({
      kind: 'agent',
      text: 'Open the docs and check the plan.',
    })
    expect(session.route('Open.')).toEqual({ kind: 'agent', text: 'Open.' })
    expect(session.mode).toBe('agent')
  })

  it('does not select a route from empty transcription', () => {
    const session = new MicSessionRouter()
    expect(session.route('  ')).toEqual({ kind: 'ignored' })
    expect(session.mode).toBe('undecided')
  })
})
