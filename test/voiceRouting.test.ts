import { describe, expect, it } from 'vitest'
import { MicSessionRouter } from '../src/shared/voiceCommands'

describe('microphone session routing', () => {
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
