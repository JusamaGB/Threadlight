import { describe, expect, it } from 'vitest'
import type { AgentItem } from '../src/shared/agent'
import { latestSpokenReply } from '../src/shared/spokenReply'

describe('collapsed Agent captions', () => {
  const prior = new Set(['live:prior'])
  const origin = { sessionId: 'call', turnId: 'turn', itemId: 'answer' }
  const caption = (id: string, text: string): AgentItem => ({
    id: 'live:' + id,
    kind: 'agent',
    text,
  })
  const lead = {
    ...caption('lead', 'Start here.'),
    narrationOf: { ...origin, excerpt: 'Start here.' },
  }
  const tail = {
    ...caption('tail', 'Now run it.'),
    narrationOf: { ...origin, tailAfter: 'Start here.' },
  }
  const answer: AgentItem = {
    kind: 'agent',
    id: 'answer',
    backingTurnId: 'turn',
    timingSession: 'call',
    text: 'Formatted thread message',
  }
  it('combines the latest versions of related opening and tail captions, including partial updates', () => {
    expect(latestSpokenReply([answer, lead, { ...tail, text: 'Now' }], prior)).toMatchObject({
      text: 'Start here. Now',
    })
    expect(latestSpokenReply([answer, lead, tail], prior)).toMatchObject({
      text: 'Start here. Now run it.',
      source: answer.text,
    })
  })
  it('keeps direct speech while omitting older, mismatched and unrelated source text', () => {
    expect(
      latestSpokenReply(
        [caption('prior', 'Old call'), answer, { kind: 'you', text: 'Question' }],
        prior,
      ),
    ).toBeNull()
    expect(
      latestSpokenReply([answer, lead, caption('direct', 'A new reply')], prior),
    ).toMatchObject({ text: 'A new reply', source: '' })
    for (const changed of [{ timingSession: 'other' }, { backingTurnId: 'other' }]) {
      expect(latestSpokenReply([{ ...answer, ...changed }, lead, tail], prior)).toMatchObject({
        text: 'Start here. Now run it.',
        source: '',
      })
    }
    expect(latestSpokenReply([lead, tail], prior)?.source).toBe('')
  })
})
