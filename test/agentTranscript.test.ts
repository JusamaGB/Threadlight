import { describe, expect, it } from 'vitest'
import type { AgentItem } from '../src/shared/agent'
import type { ConversationCard } from '../src/shared/conversationEvents'
import { agentTranscript, voiceInput } from '../src/shared/agentTranscript'

const answer: AgentItem = {
  kind: 'agent',
  id: 'final',
  text: 'The two words are “violet compass”.',
}
const link = { sessionId: 'voice', turnId: 'backing', itemId: 'final' }
const speech: AgentItem = {
  kind: 'agent',
  id: 'live:spoken',
  text: ' The two words are “violet compass.”',
  narrationOf: link,
  liveAfter: 'final',
  liveComplete: true,
}
const keys = (items: AgentItem[], historical = false) =>
  agentTranscript(items, [], historical).map((row) => row.key)
describe('continuous Agent transcript', () => {
  it('recognizes complete voice inputs without rewriting typed, nested or partial records', () => {
    const raw =
      '<realtime_delegation>\n<input>Explain this example?</input>\n<transcript_delta>user: earlier request</transcript_delta>\n</realtime_delegation>'
    expect(voiceInput(raw)).toBe('Explain this example?')
    expect(voiceInput('<threadlight-briefing>internal</threadlight-briefing>' + raw)).toBe(
      'Explain this example?',
    )
    for (const text of [
      raw.slice(0, -1),
      raw + ' more',
      'Example: ' + raw,
      raw.replace('example?', '<input>nested</input>'),
    ])
      expect(voiceInput(text)).toBeNull()
  })
  it('projects only confirmed answer narration, preserving raw speech and distinct messages', () => {
    expect(keys([answer, speech])).toEqual(['final'])
    expect(speech.text).toContain('compass.')
    expect(keys([answer, { ...speech, liveComplete: false, text: 'The two wo' }])).toEqual([
      'final',
    ])
    for (const other of [
      { ...speech, narrationOf: undefined },
      { ...speech, text: 'Another detail.' },
      { ...speech, text: 'The two' },
      { ...speech, narrationOf: { ...link, itemId: 'missing' } },
    ])
      expect(keys([answer, other])).toEqual(['final', 'live:spoken'])
    expect(keys([speech], true)).toEqual(['live:spoken'])
    expect(keys([speech, answer], true)).toEqual(['final'])
    // Do not equate different code operators.
    expect(
      keys([
        { ...answer, text: 'a+b' },
        { ...speech, text: 'a-b' },
      ]),
    ).toEqual(['final', 'live:spoken'])
  })
  it('attaches successively longer repunctuated walkthrough requests to their original utterance', () => {
    const opening =
      'Right, the walkthrough worked for my current code. Now I need a walkthrough of adding the output'
    const middle = 'You should be able to show me this with ghost text'
    const original: AgentItem = {
      kind: 'you',
      id: 'live:long',
      liveComplete: true,
      text: opening + '. ' + middle + '. Where necessary',
    }
    const variants = [opening, opening + '. ' + middle, original.text, original.text]
    const items: AgentItem[] = [original]
    for (const [i, text] of variants.entries()) {
      items.push({
        id: 'd' + i,
        kind: 'you',
        backingTurnId: 'walk',
        text:
          '<realtime_delegation><input>' +
          text +
          '</input><transcript_delta>user: ' +
          text +
          '</transcript_delta></realtime_delegation>',
      })
      items.push({
        id: 'step' + i,
        kind: 'step',
        backingTurnId: 'walk',
        text: 'Read editor context',
      })
    }
    for (const historical of [false, true]) {
      const rows = agentTranscript(items, [], historical)
      expect(rows.map((r) => r.key)).toEqual(['live:long', 'activity:step0'])
      expect(rows[0]).toMatchObject({
        item: {
          text: original.text,
          audioDetails: items.filter((i) => i.id?.startsWith('d')).map((i) => i.text),
        },
      })
    }
  })
  it('keeps repeated identical requests separate across backing turns and restores late-arriving envelopes', () => {
    const text = 'Try that again.'
    const env = (id: string, turn: string): AgentItem => ({
      id,
      kind: 'you',
      backingTurnId: turn,
      text:
        '<realtime_delegation><input>' +
        text +
        '</input><transcript_delta>user: ' +
        text +
        '</transcript_delta></realtime_delegation>',
    })
    const native = (id: string, liveAfter?: string): AgentItem => ({
      id: 'live:' + id,
      kind: 'you',
      text,
      liveAfter,
      liveComplete: true,
    })
    const one = native('one', 'previous'),
      two = native('two', 'd2')
    const rows = agentTranscript(
      [
        one,
        two,
        { id: 'previous', kind: 'agent', text: 'Ready' },
        env('d1', 'first'),
        env('d2', 'second'),
        env('d3', 'second'),
      ],
      [],
      true,
    )
    expect(rows.map((r) => r.key)).toEqual(['previous', 'live:one', 'live:two'])
    expect(rows[1]).toMatchObject({ item: { audioDetails: [env('d1', 'first').text] } })
    expect(rows[2]).toMatchObject({
      item: { audioDetails: [env('d2', 'second').text, env('d3', 'second').text] },
    })
  })
  it('keeps actual historical order and card anchors when a narration has no separate row', () => {
    const direct: AgentItem = {
      kind: 'agent',
      id: 'live:direct',
      text: 'Extra detail',
      liveAfter: 'final',
    }
    const next: AgentItem = { kind: 'you', id: 'next', text: 'Another question?' }
    const card = (id: string, anchor: string) =>
      ({ id, anchor, state: 'pending', kind: 'question' }) as ConversationCard
    const rows = agentTranscript(
      [speech, direct, answer, next],
      [card('at-speech', 'live:spoken'), card('missing', 'unknown')],
      true,
    )
    expect(rows.map((row) => row.key)).toEqual([
      'final',
      'card:at-speech',
      'live:direct',
      'next',
      'card:missing',
    ])
    const twin: AgentItem = { kind: 'agent', text: 'same fence' }
    expect(keys([twin, twin])).toEqual(['line:0', 'line:1'])
    expect(keys([{ kind: 'step', text: 'first' }, { kind: 'step', text: 'second' }, next])).toEqual(
      ['activity:line:0', 'next'],
    )
  })
})
