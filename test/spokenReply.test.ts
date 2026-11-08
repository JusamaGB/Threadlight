import { describe, expect, it } from 'vitest'
import type { AgentItem } from '../src/shared/agent'
import { latestSpokenReply, spokenExample } from '../src/shared/spokenReply'

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
  it('displays the saved receipt example through its exact delegated turn, without a narration link', () => {
    const code = 'for entry in order:\n    print(entry, inv[entry])'
    const fence = String.fromCharCode(96).repeat(3)
    const source =
      'Sorry—I should have made the Python clearer. Here it is:\n\n' +
      fence +
      'python\n' +
      code +
      '\n' +
      fence +
      '\n\n`order` contains names like `"apple"`. The loop puts each name into `entry`, then `inv[entry]` looks up its price.'
    const nativeUser: AgentItem = {
      id: 'live:user',
      kind: 'you',
      text: 'Why didn’t you provide me the Python?',
      voiceDelegationIds: ['request'],
    }
    const envelope: AgentItem = {
      id: 'request',
      kind: 'you',
      text: 'delegation',
      backingTurnId: 'turn',
    }
    const backing = { ...answer, text: source }
    const native = {
      ...caption(
        'speech',
        'Sorry, I should have made the Python clearer. Here it is: order contains names like "apple". The loop puts each name into entry, then `inv[entry]` looks up its price.',
      ),
      liveAfter: 'answer',
      liveComplete: true,
    }
    const selection = latestSpokenReply([envelope, nativeUser, backing, native], prior)!
    expect(
      latestSpokenReply(
        [envelope, nativeUser, backing, { ...native, text: 'I cannot approve that' }],
        prior,
      )?.source,
    ).toBe('')
    expect(selection.source).toBe(source)
    expect(selection.text).toBe(native.text)
    const blocks = [{ language: 'python', start: 0, value: code }]
    const seen = spokenExample(null, selection, blocks)
    expect(seen.example?.sourceId).toBe('answer')
    const follow = {
      ...selection,
      sourceId: 'followup',
      source: 'The print expression `print(entry, inv[entry])` is otherwise right.',
    }
    expect(spokenExample(seen.example, follow, []).blocks).toEqual(blocks)
    expect(
      spokenExample(
        seen.example,
        { ...follow, source: 'Look at the price lookup.\n\n<!--threadlight:current-example-->' },
        [],
      ).blocks,
    ).toEqual(blocks)
    expect(
      spokenExample(
        seen.example,
        { ...follow, source: 'How is an `entry` different from a file?' },
        [],
      ),
    ).toEqual({ blocks: [], example: null })
    expect(
      spokenExample(seen.example, { ...follow, sourceSession: 'another-call' }, []).blocks,
    ).toEqual([])
    expect(spokenExample(null, follow, []).blocks).toEqual([])
    const jsExample = {
      ...seen.example!,
      blocks: [{ language: 'javascript', start: 0, value: 'function demo() {\n  return 1\n}' }],
    }
    expect(
      spokenExample(
        jsExample,
        { ...follow, source: 'In the new JSON file what does `}` mean?' },
        [],
      ),
    ).toEqual({ example: null, blocks: [] })
    for (const changed of [
      { ...envelope, backingTurnId: 'other-turn' },
      { ...envelope, id: 'other-request' },
    ])
      expect(latestSpokenReply([changed, nativeUser, backing, native], prior)?.source).toBe('')
    expect(
      latestSpokenReply(
        [envelope, nativeUser, backing, { ...native, liveAfter: 'unrelated' }],
        prior,
      )?.source,
    ).toBe('')
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
