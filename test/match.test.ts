import { describe, expect, it } from 'vitest'

import { matchThread, parseVoiceCommand, similarity, type Candidate } from '../src/shared/match'

describe('parseVoiceCommand', () => {
  it('splits the thread name from the message', () => {
    expect(parseVoiceCommand('Message docs site, check the build passed.')).toEqual({
      thread: 'docs site',
      message: 'Check the build passed.',
    })
    expect(parseVoiceCommand('tell the billing thread to rerun the tests')).toEqual({
      thread: 'billing',
      message: 'Rerun the tests',
    })
    expect(parseVoiceCommand('Send a message to Release notes saying ship it')).toEqual({
      thread: 'Release notes',
      message: 'Ship it',
    })
    expect(parseVoiceCommand('Hey, ask onboarding: how far along are you?')).toEqual({
      thread: 'onboarding',
      message: 'How far along are you?',
    })
  })

  it('returns null for speech that is not addressed to a thread', () => {
    expect(parseVoiceCommand('check the build passed')).toBeNull()
    expect(parseVoiceCommand('message')).toBeNull()
    expect(parseVoiceCommand('')).toBeNull()
  })
})

const threads: Candidate[] = [
  { id: '1', title: 'Docs site rebuild' },
  { id: '2', title: 'Billing API' },
  { id: '3', title: 'Release notes for v2' },
  { id: '4', title: 'Onboarding E2E run' },
  { id: '5', title: 'Diary settings' },
]

describe('matchThread', () => {
  it('finds a thread from part of its name, ignoring case and punctuation', () => {
    expect(matchThread('docs site', threads)?.id).toBe('1')
    expect(matchThread('billing', threads)?.id).toBe('2')
    expect(matchThread('release notes', threads)?.id).toBe('3')
    expect(matchThread('Onboarding E2E', threads)?.id).toBe('4')
  })

  it('tolerates small mishearings and word prefixes', () => {
    expect(matchThread('onbording', threads)?.id).toBe('4') // one letter dropped
    expect(matchThread('diary setting', threads)?.id).toBe('5')
  })

  it('refuses to guess when nothing fits or two fit equally', () => {
    expect(matchThread('weather forecast', threads)).toBeNull()
    const twins: Candidate[] = [
      { id: 'a', title: 'Docs site' },
      { id: 'b', title: 'Docs site' },
    ]
    expect(matchThread('docs site', twins)).toBeNull()
    expect(matchThread('anything', [])).toBeNull()
  })

  it('prefers the title the speaker covered more of', () => {
    const close: Candidate[] = [
      { id: 'short', title: 'Docs' },
      { id: 'long', title: 'Docs site rebuild and migration' },
    ]
    expect(similarity('docs', 'Docs')).toBeGreaterThan(
      similarity('docs', 'Docs site rebuild and migration'),
    )
    expect(matchThread('docs', close)?.id).toBe('short')
  })
})
