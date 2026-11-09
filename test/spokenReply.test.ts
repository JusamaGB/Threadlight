import { describe, expect, it } from 'vitest'
import type { AgentItem } from '../src/shared/agent'
import { latestSpokenReply, presentSpokenReply, spokenExample } from '../src/shared/spokenReply'

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

  it('keeps the written receipt example through unlinked dictation and explicitly replays it', () => {
    const code = 'order[choice] += 1\n\nelif choice == "done":\n    break'
    const fence = '\x60\x60\x60'
    const user: AgentItem = {
      kind: 'you',
      id: 'live:ask',
      text: 'Could you show me the example string in the thread, please',
      voiceDelegationIds: ['req'],
    }
    const envelope: AgentItem = {
      kind: 'you',
      id: 'req',
      backingTurnId: 'turn',
      text: 'delegation',
    }
    const source = {
      ...answer,
      text:
        fence +
        'python\n' +
        code +
        '\n' +
        fence +
        '\n\nThis is the proposed example from the live diff.',
    }
    const voice = {
      ...caption('one', 'This is the proposed example from the live diff.'),
      narrationOf: origin,
      liveAfter: 'answer',
    }
    const dictation = {
      ...caption(
        'two',
        'total = 0.0 for name, info in items dot items(): total += info["quantity"] * info["price"]',
      ),
      liveAfter: 'live:one',
    }
    const base = [user, envelope]
    const replyCodeBlocks = (text: string) =>
      text === source.text ? [{ language: 'python', value: code, start: 0 }] : []
    const project = (
      items: AgentItem[],
      previous: ReturnType<typeof presentSpokenReply>['example'] = null,
    ) => presentSpokenReply(items, prior, new Set(), previous, replyCodeBlocks)
    const first = project([...base, source])
    expect(first.reply?.blocks[0]?.value).toBe(code)
    const speaking = project([...base, source, voice], first.example)
    const full = [...base, source, voice, dictation]
    const later = project(full, speaking.example)
    expect(later.reply).toMatchObject({
      exampleId: first.reply?.exampleId,
      blocks: first.reply?.blocks,
      text: voice.text,
    })
    expect(project([...base, voice, dictation]).reply?.blocks).toEqual([])
    expect(project([...base, voice, dictation, source]).reply?.blocks[0]?.value).toBe(code)
    expect(
      project([...full, { ...answer, id: 'status', text: 'Finished.' }]).reply?.blocks[0]?.value,
    ).toBe(code)
    const again = [
      ...full,
      { ...user, id: 'live:again', voiceDelegationIds: [], text: 'Sorry, can you repeat that?' },
    ]
    const restored = project(again, later.example)
    expect(restored.reply?.blocks).toEqual(first.reply?.blocks)
    expect(restored.reply?.exampleId).not.toBe(first.reply?.exampleId)
    const different = {
      ...user,
      id: 'live:new-question',
      text: 'Show me the file.',
      voiceDelegationIds: ['req2'],
    }
    expect(project([...full, different], later.example).reply).toBeNull()
    const nextCode = 'print("next")'
    const nextAnswer = {
      ...answer,
      id: 'new-answer',
      backingTurnId: 'turn2',
      text: fence + 'python\n' + nextCode + '\n' + fence,
    }
    const switched = presentSpokenReply(
      [...full, different, { ...envelope, id: 'req2', backingTurnId: 'turn2' }, nextAnswer],
      prior,
      new Set(),
      later.example,
      (text) =>
        text === nextAnswer.text
          ? [{ language: 'python', start: 0, value: nextCode }]
          : replyCodeBlocks(text),
    )
    expect(switched.reply?.blocks[0]?.value).toBe(nextCode)
    const ambiguous = {
      ...later.example!,
      blocks: [...later.example!.blocks, { language: 'python', start: 200, value: nextCode }],
    }
    expect(
      project([...full, { ...different, text: 'Show me the Python file again.' }], ambiguous).reply,
    ).toBeNull()
    const next = [
      ...again,
      { ...user, id: 'live:next', voiceDelegationIds: [], text: 'Check the new VS Code diff.' },
    ]
    expect(project(next, restored.example).reply).toBeNull()
    expect(
      project(
        [...next, { ...voice, id: 'live:late-linked', liveAfter: undefined }],
        restored.example,
      ).reply,
    ).toBeNull()
    expect(project([...next, { ...dictation, id: 'live:late' }], restored.example).reply).toBeNull()
    expect(
      project([...next, caption('next-reply', 'Checking the editor.')], restored.example).example,
    ).toBeNull()
    expect(
      presentSpokenReply(full, prior, new Set(['answer']), null, replyCodeBlocks).reply?.blocks,
    ).toEqual([])
  })
})
