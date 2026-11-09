import { describe, expect, it, vi } from 'vitest'
import type { AgentItem } from '../src/shared/agent'
import { agentTranscript } from '../src/shared/agentTranscript'
import { LeadPlayback } from '../src/main/agent/leadPlayback'
import { CodexLive } from '../src/main/agent/codexLive'
import { matchesSpeech } from '../src/shared/speechCaption'
import type { CodexTransport } from '../src/main/agent/codexClient'
const lead =
  'I can see this file: you said the server was restarted and the editor reconnected, and I confirmed the connection.'
const voiced =
  'In this file, I see you said the server was restarted and the editor was reconnected, and then I confirmed the connection.'
const tail = 'If you show me the example again, I can continue from there.'
const voicedTail = 'If you show me the example again, I’ll continue from there.'
function fixture(
  request = vi.fn(async () => ({})),
  readout?: (value: { session: string; token: string } | null) => void,
) {
  const items = new Map<string, AgentItem>()
  const interrupt = vi.fn()
  const live = new CodexLive(
    { request } as unknown as CodexTransport,
    'thread',
    'session',
    (item) => items.set(item.id!, item),
    () => {},
    false,
    interrupt,
    readout,
  )
  live.beginTurn('turn')
  const caption = (
    id: string,
    text: string,
    role = 'assistant',
    native?: string,
    session = 'session',
  ) =>
    live.event('thread/realtime/item/completed', {
      threadId: 'thread',
      voiceSessionId: session,
      item: { type: 'transcriptSegment', id, role, text, turnId: native },
    })
  return { live, request, items, interrupt, caption }
}
describe('native answer and spoken captions', () => {
  const acknowledgment = {
    type: 'agentMessage',
    id: 'note',
    phase: 'commentary',
    text: 'I’ll check the current editor buffer.',
  }
  it('continues the Coach call after Live captions problem.py as problem-dot-py', async () => {
    const offered = vi.fn()
    const { live, request, items, caption } = fixture(undefined, offered)
    const opening =
      'I’ll select the Threadlight Coach skill, then check the current VS Code coaching guidance and the `problem.py` pin before proposing the ghost text change.'
    const heard = opening.replace('`problem.py`', 'problem-dot-py')
    const next =
      'Coach is active. The coaching instructions route this through VS Code’s ghost practice copy, which preserves the source file. I’m checking the connected editor and loading the requested file’s code now.'
    const final =
      'Threadlight Coach is selected. VS Code is connected, but its loaded companion doesn’t expose the ghost practice actions, so I couldn’t load `problem.py` or prepare its code for ghost narration. The source file was not changed. Activate or update the Threadlight VS Code companion, then ask me to try again.'
    live.completedCommentary('turn', { ...acknowledgment, text: opening })
    live.playbackBoundary('assistant', 'first')
    caption('opening', ' ' + heard)
    live.playbackBoundary('done', 'first', heard)
    await Promise.resolve()
    expect(items.get('live:opening')?.narrationOf?.itemId).toBe('note')
    live.completedCommentary('turn', { ...acknowledgment, id: 'next', text: next })
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(request.mock.lastCall)).toContain(next)
    const finish = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: final }],
    })
    live.playbackBoundary('assistant', 'second')
    live.playbackBoundary('done', 'second', next)
    await finish
    expect(request).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(request.mock.lastCall)).toContain(final.replaceAll('`', ''))
    expect(offered).not.toHaveBeenCalled()
  })

  it('recognizes streamed filename spellings while preserving the filename, question and negation', () => {
    const requested = 'Open my-file.test.py.'
    const heard = 'Open my-file dot test-dot-py.'
    for (let i = 1; i <= heard.length; i++)
      expect(matchesSpeech(requested, heard.slice(0, i), true)).toBe(true)
    expect(matchesSpeech(requested, heard)).toBe(true)
    for (const different of [
      'Open my file dot test-dot-py.',
      'Open my-file dot test-dot-js.',
      'Open my-file dot test-dot-py?',
      'Do not open my-file dot test-dot-py.',
    ])
      expect(matchesSpeech(requested, different)).toBe(false)
  })

  it.each([true, false])(
    'continues independent prose after a reworded progress readout (RPC first: %s)',
    async (rpcFirst) => {
      let accept!: () => void
      const request = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              accept = resolve
            }),
        )
        .mockResolvedValue({})
      const { live, items, caption } = fixture(request)
      live.delegatedInput('turn', 'Check the file.')
      live.completedCommentary('turn', acknowledgment)
      const next = 'I found the file and am checking the highlighted line.'
      live.completedCommentary('turn', { ...acknowledgment, id: 'next', text: next })
      const finish = live.finishTurn({
        id: 'turn',
        status: 'completed',
        items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: tail }],
      })
      if (rpcFirst) accept()
      live.playbackBoundary('assistant', 'first')
      caption('paraphrase', 'Let me look at the file.')
      live.playbackBoundary('done', 'first', 'Let me look at the file.')
      if (!rpcFirst) {
        await Promise.resolve()
        expect(request).toHaveBeenCalledTimes(1)
        accept()
      }
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
      expect(JSON.stringify(request.mock.lastCall)).toContain(next)
      expect(items.get('live:paraphrase')?.narrationOf).toBeUndefined()
      live.playbackBoundary('assistant', 'second')
      live.playbackBoundary('done', 'second', 'I have the file open.')
      await finish
      expect(request).toHaveBeenCalledTimes(3)
      expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
      live.disconnect('done')
    },
  )
  it('automatically speaks the approval outcome when a corrected caption completes after playback', async () => {
    const offered = vi.fn()
    const { live, request, caption } = fixture(undefined, offered)
    const first = 'I found the Threadlight space.'
    const second =
      'I’ll start a Codex thread there with a brief opening message, then check the operation receipt.'
    live.streamCommentary('turn', 'opening', first + ' I’ll')
    live.completedCommentary('turn', {
      ...acknowledgment,
      id: 'opening',
      text: first + ' ' + second,
    })
    live.playbackBoundary('assistant', 'first')
    live.playbackBoundary('done', 'first', '"' + first + '"')
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
    live.playbackBoundary('assistant', 'second')
    live.event('thread/realtime/item/started', {
      threadId: 'thread',
      item: { type: 'transcriptSegment', id: 's2', role: 'assistant', text: '"I’ll start a code' },
    })
    const finish = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [
        {
          id: 'receipt',
          type: 'agentMessage',
          phase: 'final_answer',
          text: 'The space needs an active communication period.',
        },
      ],
    })
    live.playbackBoundary('done', 'second')
    caption('s2', '"' + second + '"')
    await finish
    expect(request).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(request.mock.lastCall)).toContain(
      'The space needs an active communication period.',
    )
    expect(offered).not.toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }))
  })
  it('releases the Shared Space final reply after the recorded quoted opening and no server caption', async () => {
    const { live, request } = fixture()
    const text =
      'I’ll check what the current Threadlight tools support for creating or starting a chat in a Shared Space, then I can set up the right kind of agent there.'
    const answer =
      'I found the **Threadlight** Shared Space and prepared a Claude Code agent for UI updates on request.'
    live.completedCommentary('turn', { ...acknowledgment, text })
    const finish = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: answer }],
    })
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('assistant', 'opening')
    live.playbackBoundary('done', 'opening', '“ ' + text + '”')
    await finish
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(request.mock.lastCall)).toContain('I found the Threadlight Shared Space')
  })
  it('delivers the final tail when the opening transcript arrives only on WebRTC', async () => {
    const { live, request } = fixture()
    live.streamFinal('turn', 'message', lead + '\n\n')
    const finish = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [
        { id: 'message', type: 'agentMessage', phase: 'final_answer', text: lead + '\n\n' + tail },
      ],
    })
    live.playbackBoundary('assistant', 'lead')
    live.playbackBoundary('done', 'lead', '“' + lead + '”')
    await finish
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
  })

  it('requires the final opening’s own caption and playback after a progress readout', async () => {
    const { live, request, caption } = fixture()
    live.completedCommentary('turn', acknowledgment)
    live.playbackBoundary('assistant', 'direct')
    caption('direct', 'I cannot approve that.')
    live.streamFinal('turn', 'a', lead + '\n\n')
    live.playbackBoundary('done', 'direct')
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('assistant', 'progress')
    caption('progress', acknowledgment.text)
    live.playbackBoundary('done', 'progress')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    const finish = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ id: 'a', type: 'agentMessage', text: lead + '\n\n' + tail }],
    })
    live.playbackBoundary('done', 'progress')
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
    live.playbackBoundary('assistant', 'opening')
    caption('lead', voiced)
    live.playbackBoundary('done', 'opening')
    await finish
    expect(request).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
    expect(JSON.stringify(request.mock.lastCall)).not.toContain(lead)
  })

  it('uses the final WebRTC words when a progress caption is available only on the receiver', async () => {
    const { live, request } = fixture()
    live.completedCommentary('turn', acknowledgment)
    const shown = live.coachStep('The highlighted line is ready.', true, true)
    live.playbackBoundary('assistant', 'foreign')
    live.playbackBoundary('done', 'foreign', 'I cannot approve that.')
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('assistant', 'progress')
    live.playbackBoundary('done', 'stale', acknowledgment.text)
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('done', 'progress', acknowledgment.text)
    await shown
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(request.mock.lastCall)).toContain('highlighted line')
  })

  it.each(['finish', 'skip', 'user'] as const)(
    'orders a completed final answer behind progress (%s)',
    async (outcome) => {
      const { live, request, caption } = fixture()
      live.completedCommentary('turn', acknowledgment)
      live.playbackBoundary('assistant', 'progress')
      caption('progress', acknowledgment.text)
      const finish = live.finishTurn({
        id: 'turn',
        status: 'completed',
        items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: tail }],
      })
      expect(request).toHaveBeenCalledTimes(1)
      if (outcome !== 'finish') live.playbackBoundary(outcome, 'interrupt')
      live.playbackBoundary('done', 'progress')
      await finish
      expect(request).toHaveBeenCalledTimes(outcome === 'finish' ? 2 : 1)
      if (outcome === 'finish') expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
    },
  )

  it('keeps the conversation audible in a guide and ignores stale or closed sessions', () => {
    const { live, request } = fixture()
    live.editorActivity('turn', 'guide', false, {})
    live.setGuideActive(true)
    live.completedCommentary('turn', acknowledgment)
    expect(request).toHaveBeenCalledTimes(1)
    live.beginTurn('next')
    live.completedCommentary('turn', acknowledgment)
    live.disconnect('closed')
    live.completedCommentary('next', acknowledgment)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['skip', 'user', 'close', 'new'] as const)(
    'cancels a queued proposal behind progress on %s',
    async (reason) => {
      const { live, request } = fixture()
      live.completedCommentary('turn', acknowledgment)
      live.playbackBoundary('assistant', 'progress')
      const shown = live.coachStep('Shown proposal narration', true, true)
      const cancelled = expect(shown).rejects.toThrow()
      if (reason === 'new') live.beginTurn('new')
      else if (reason === 'close') live.disconnect('ended')
      else live.playbackBoundary(reason, 'stop')
      await cancelled
      live.playbackBoundary('done', 'progress')
      expect(request).toHaveBeenCalledTimes(1)
    },
  )

  it('never releases an instruction on timeout after a foreign completion', async () => {
    vi.useFakeTimers()
    try {
      const { live, request } = fixture()
      live.completedCommentary('turn', acknowledgment)
      const shown = live.coachStep('The verified proposal is visible.', true, true)
      const timeout = expect(shown).rejects.toThrow(/confirmed playback boundary/)
      live.playbackBoundary('assistant', 'foreign')
      live.playbackBoundary('done', 'foreign', 'Unrelated words.')
      await vi.advanceTimersByTimeAsync(30001)
      await timeout
      expect(request).toHaveBeenCalledTimes(1)
      live.playbackBoundary('assistant', 'actual')
      live.playbackBoundary('done', 'actual', acknowledgment.text)
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(1)
      live.disconnect('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([true, false])(
    'requires the commentary’s playback after a foreign completion (matching playback arrives: %s)',
    async (matched) => {
      vi.useFakeTimers()
      try {
        const { live, request } = fixture()
        live.completedCommentary('turn', {
          ...acknowledgment,
          text: "I'll check the current buffer, but first indent line ten.",
        })
        live.editorActivity('turn', 'capabilities', false, {})
        await vi.advanceTimersByTimeAsync(1)
        const status = "I'll check the current buffer, but first indent line ten."
        expect(request).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(request.mock.lastCall)).toContain(status)
        const proposal = live.coachStep('The highlighted change is visible.', true, true)
        const outcome = matched
          ? expect(proposal).resolves.toBeUndefined()
          : expect(proposal).rejects.toThrow(/confirmed playback boundary/)
        live.playbackBoundary('assistant', 'foreign')
        live.playbackBoundary('done', 'foreign', 'I cannot approve that.')
        await Promise.resolve()
        expect(request).toHaveBeenCalledTimes(1)
        if (matched) {
          live.playbackBoundary('assistant', 'status')
          live.playbackBoundary('done', 'status', status)
        } else await vi.advanceTimersByTimeAsync(30001)
        await outcome
        expect(request).toHaveBeenCalledTimes(matched ? 2 : 1)
        live.disconnect('done')
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('offers an explicit one-shot prose readout instead of submitting on an uncertain progress timeout', async () => {
    vi.useFakeTimers()
    try {
      const offered = vi.fn()
      const { live, request } = fixture(undefined, offered)
      live.completedCommentary('turn', acknowledgment)
      live.completedCommentary('turn', {
        ...acknowledgment,
        id: 'next',
        text: 'I’m checking the supported creation path.',
      })
      const finish = live.finishTurn({
        id: 'turn',
        status: 'completed',
        items: [{ id: 'a', type: 'agentMessage', phase: 'final_answer', text: tail }],
      })
      live.playbackBoundary('assistant', 'other')
      live.playbackBoundary('done', 'other', 'A separate reply.')
      await vi.advanceTimersByTimeAsync(30001)
      await finish
      expect(request).toHaveBeenCalledTimes(1)
      const token = offered.mock.lastCall?.[0]?.token
      expect(token).toBeTypeOf('string')
      await live.readRemaining(token)
      expect(request).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
      live.playbackBoundary('assistant', 'final-readout')
      live.playbackBoundary('done', 'final-readout', tail)
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(2)
      await expect(live.readRemaining(token)).rejects.toThrow()
      live.disconnect('done')
    } finally {
      vi.useRealTimers()
    }
  })
  it('automatically reads the offered final once when matching playback arrives after the deadline', async () => {
    vi.useFakeTimers()
    try {
      const offered = vi.fn()
      const { live, request } = fixture(undefined, offered)
      live.completedCommentary('turn', acknowledgment)
      const finish = live.finishTurn({
        id: 'turn',
        status: 'completed',
        items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: tail }],
      })
      await vi.advanceTimersByTimeAsync(30001)
      await finish
      const token = offered.mock.lastCall?.[0]?.token
      expect(token).toBeTypeOf('string')
      live.playbackBoundary('assistant', 'matching')
      live.playbackBoundary('done', 'matching', acknowledgment.text)
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
      expect(offered.mock.lastCall?.[0]).toBeNull()
      await expect(live.readRemaining(token)).rejects.toThrow()
      live.disconnect('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps tool results, reasoning, code blocks and stand-alone filler out of speech', async () => {
    vi.useFakeTimers()
    try {
      const { live, request } = fixture()
      for (const action of ['capabilities', 'review', 'context', 'proposal_status']) {
        live.editorActivity('turn', action, false, {})
        live.editorActivity('turn', action, true, {
          result: { content: [{ text: '{"outcome":"ok"}' }] },
        })
      }
      for (const [id, type, text] of [
        ['tool', 'mcpToolCall', 'raw result'],
        ['thinking', 'reasoning', 'planning'],
        ['filler', 'agentMessage', 'Just a sec.'],
        ['code', 'agentMessage', '```py\nprint(1)\n```'],
      ])
        live.completedCommentary('turn', { ...acknowledgment, id, type, text })
      await vi.advanceTimersByTimeAsync(8000)
      expect(request).not.toHaveBeenCalled()
      live.disconnect('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('speaks the first complete thought immediately and drains every queued paragraph before the final answer', async () => {
    const { live, request } = fixture()
    const opening =
      'I’ll reconnect to the active buffer and continue with the unknown-item message change.'
    const rest = 'Then we can check what happens when the item is missing.'
    const next = 'Your receipt already covers items that are in stock.'
    live.streamCommentary('turn', 'opening', opening.slice(0, 20))
    expect(request).not.toHaveBeenCalled()
    live.streamCommentary('turn', 'opening', opening + ' Then')
    expect(request).toHaveBeenCalledTimes(1)
    const item = { ...acknowledgment, id: 'opening', text: opening + ' ' + rest }
    live.completedCommentary('turn', item)
    live.completedCommentary('turn', item)
    live.completedCommentary('turn', { ...acknowledgment, id: 'second', text: next })
    const done = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ ...item, id: 'final', phase: 'final_answer', text: tail }],
    })
    for (const [i, words] of [opening, rest, next].entries()) {
      expect(request).toHaveBeenCalledTimes(i + 1)
      expect(JSON.stringify(request.mock.lastCall)).toContain(words)
      live.playbackBoundary('assistant', 'audio' + i)
      live.playbackBoundary('done', 'audio' + i, words)
      await Promise.resolve()
    }
    await done
    expect(request).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
  })

  it.each(['skip', 'user'] as const)(
    'drops the remaining paragraph and queued updates on %s',
    async (reason) => {
      const { live, request } = fixture()
      live.streamCommentary('turn', 'opening', acknowledgment.text + ' Next')
      live.completedCommentary('turn', {
        ...acknowledgment,
        id: 'opening',
        text: acknowledgment.text + ' Next I’ll inspect the receipt.',
      })
      live.completedCommentary('turn', {
        ...acknowledgment,
        id: 'other',
        text: 'I found the receipt loop.',
      })
      live.playbackBoundary('assistant', 'first')
      live.playbackBoundary(reason, 'interrupted')
      live.playbackBoundary('done', 'first', acknowledgment.text)
      await live.finishTurn({
        id: 'turn',
        status: 'completed',
        items: [{ ...acknowledgment, id: 'final', phase: 'final_answer', text: tail }],
      })
      expect(request).toHaveBeenCalledTimes(1)
    },
  )

  it('speaks a distinct written reply after a shown step finishes playing', async () => {
    const { live, request } = fixture()
    const step = 'The receipt loop already knows the quantity.'
    await live.coachStep(step, true, true)
    live.playbackBoundary('assistant', 'step')
    const done = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ ...acknowledgment, id: 'final', phase: 'final_answer', text: tail }],
    })
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('done', 'step', step)
    await done
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
  })

  it('offers a manual fallback after the deadline without discarding a later valid playback boundary', async () => {
    vi.useFakeTimers()
    try {
      const gate = new LeadPlayback()
      const offer = vi.fn()
      gate.onUncertain = offer
      const pending = gate.wait()
      gate.caption('opening', true, true)
      expect(gate.awaitingMatchedTurn).toBe(true)
      await vi.advanceTimersByTimeAsync(30000)
      expect(offer).toHaveBeenCalledOnce()
      expect(gate.awaitingMatchedTurn).toBe(false)
      gate.start('actual')
      gate.end('actual')
      await expect(pending).resolves.toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  it.each([false, true])(
    'preserves the direct refusal and user correction, and recognizes the actual lead/tail (caption first: %s)',
    async (captionFirst) => {
      const { live, request, items, caption } = fixture()
      live.streamFinal('turn', 'a', lead + '\n\n')
      caption('late-user', 'An earlier user transcript', 'user')
      live.playbackBoundary('assistant', 'direct')
      caption('refusal', 'I cannot approve that.')
      live.playbackBoundary('done', 'direct')
      const answer = {
        id: 'a',
        type: 'agentMessage',
        phase: 'final_answer',
        text: lead + '\n\n' + tail,
      }
      const finish = live.finishTurn({ id: 'turn', status: 'completed', items: [answer] })
      expect(items.get('live:refusal')?.narrationOf).toBeUndefined()
      if (captionFirst) caption('spoken', voiced, 'assistant', 'readout')
      live.playbackBoundary('assistant', 'readout')
      if (!captionFirst) caption('spoken', voiced, 'assistant', 'readout')
      expect(request).toHaveBeenCalledTimes(1)
      live.playbackBoundary('done', 'readout')
      await finish
      expect(request).toHaveBeenCalledTimes(2)
      caption('tail', voicedTail)
      const all: AgentItem[] = [
        { kind: 'agent', id: 'a', backingTurnId: 'turn', text: answer.text },
        ...items.values(),
      ]
      for (const earlier of [false, true]) {
        const rows = agentTranscript(all, [], earlier)
        expect(rows.map((r) => r.key)).toEqual(['a', 'live:late-user', 'live:refusal'])
        expect(rows[0]).toMatchObject({ item: { spokenDetails: [voiced, voicedTail] } })
      }
      expect(items.get('live:spoken')?.narrationOf).toMatchObject({
        sessionId: 'session',
        turnId: 'turn',
        itemId: 'a',
        playbackTurnId: 'readout',
        requestId: expect.any(String),
      })
    },
  )
  it('keeps every plausible partial in the same answer while the spoken wording is available', () => {
    const { live, items } = fixture()
    live.streamFinal('turn', 'a', lead + '\n\n')
    const item = { id: 'prefix', type: 'transcriptSegment', role: 'assistant', text: '' }
    live.event('thread/realtime/item/started', { threadId: 'thread', item })
    for (const char of voiced) {
      live.event('thread/realtime/item/transcript/delta', {
        threadId: 'thread',
        itemId: 'prefix',
        delta: char,
      })
      const rows = agentTranscript(
        [{ kind: 'agent', id: 'a', backingTurnId: 'turn', text: lead }, ...items.values()],
        [],
        false,
      )
      expect(
        rows.map((r) => r.key),
        items.get('live:prefix')?.text,
      ).toEqual(['a'])
    }
  })
  it('does not fold a question into a declaration or consume the link for the requested caption', async () => {
    const { live, caption, items } = fixture()
    const text = 'You want me to send the report to the team.'
    await live.speakAnswer(text, { sessionId: 'session', turnId: 'turn', itemId: 'a' })
    caption('question', 'You want me to send the report to the team?')
    caption('actual', text)
    expect(items.get('live:question')?.narrationOf).toBeUndefined()
    expect(items.get('live:actual')?.narrationOf?.itemId).toBe('a')
  })
  it.each([true, false])(
    'revokes ownership on a conflicting partial (completed before playback ends: %s)',
    async (completedBeforeDone) => {
      const { live, request, caption, items } = fixture()
      live.streamFinal('turn', 'a', lead + '\n\n')
      live.playbackBoundary('assistant', 'direct')
      live.event('thread/realtime/item/started', {
        threadId: 'thread',
        item: { type: 'transcriptSegment', id: 'refusal', role: 'assistant', text: 'I' },
      })
      caption('matched', voiced)
      live.event('thread/realtime/item/transcript/delta', {
        threadId: 'thread',
        itemId: 'refusal',
        delta: ' cannot approve that',
      })
      expect(items.get('live:refusal')?.text).toBe('I cannot approve that')
      if (completedBeforeDone) caption('refusal', 'I cannot approve that.')
      const finish = live.finishTurn({
        id: 'turn',
        status: 'completed',
        items: [{ id: 'a', type: 'agentMessage', text: lead + '\n\n' + tail }],
      })
      live.playbackBoundary('done', 'direct')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(request).toHaveBeenCalledTimes(1)
      expect(items.get('live:refusal')?.narrationOf).toBeUndefined()
      live.playbackBoundary('assistant', 'opening')
      if (!completedBeforeDone) caption('refusal', 'I cannot approve that.')
      live.playbackBoundary('done', 'opening')
      await finish
      expect(request).toHaveBeenCalledTimes(2)
    },
  )
  it('does not release the tail on an older done when the opening caption precedes its own playback', async () => {
    const { live, request, caption } = fixture()
    live.streamFinal('turn', 'a', lead + '\n\n')
    live.playbackBoundary('assistant', 'old')
    live.playbackBoundary('done', 'old')
    caption('matched', voiced)
    const finish = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ id: 'a', type: 'agentMessage', text: lead + '\n\n' + tail }],
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('assistant', 'opening')
    live.playbackBoundary('done', 'opening')
    await finish
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('cancels the waiting remainder when a guide takes over', async () => {
    const { live, request, caption } = fixture()
    live.streamFinal('turn', 'a', lead + '\n\n')
    live.playbackBoundary('assistant', 'lead')
    caption('actual', voiced)
    const pending = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ id: 'a', type: 'agentMessage', text: lead + '\n\n' + tail }],
    })
    await Promise.resolve()
    live.setGuideActive(true)
    live.playbackBoundary('done', 'lead')
    await pending
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('offers the unsent remainder explicitly for an unfamiliar paraphrase and submits only the remainder once', async () => {
    const request = vi.fn(async () => ({})),
      offer = vi.fn()
    const live = new CodexLive(
      { request } as unknown as CodexTransport,
      'thread',
      'session',
      () => {},
      () => {},
      false,
      undefined,
      offer,
    )
    live.beginTurn('turn')
    live.streamFinal('turn', 'a', lead + '\n\n')
    live.playbackBoundary('assistant', 'unclear')
    live.event('thread/realtime/item/completed', {
      threadId: 'thread',
      item: {
        id: 'could-be-direct',
        type: 'transcriptSegment',
        role: 'assistant',
        text: 'Your editor is back online and ready.',
      },
    })
    live.playbackBoundary('done', 'unclear')
    const pending = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ id: 'a', type: 'agentMessage', text: lead + '\n\n' + tail }],
    })
    await vi.waitFor(() => expect(offer).toHaveBeenCalled())
    const token = offer.mock.calls[0]![0].token
    expect(request).toHaveBeenCalledTimes(1)
    await live.readRemaining(token)
    await pending
    await expect(live.readRemaining(token)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(request.mock.lastCall)).toContain(tail)
    expect(JSON.stringify(request.mock.lastCall)).not.toContain(lead)
  })
  it('does not mute an unconfirmed direct response on interrupted completion', async () => {
    const { live, interrupt, caption } = fixture()
    live.streamFinal('turn', 'a', lead + ' ')
    live.playbackBoundary('assistant', 'direct')
    caption('other', 'I cannot approve that.')
    await live.finishTurn({ id: 'turn', status: 'interrupted' })
    expect(interrupt).not.toHaveBeenCalled()
  })
  it.each(['user', 'skip', 'new', 'closed'] as const)('retires an unclaimed link on %s', (kind) => {
    const { live, caption, items } = fixture()
    live.streamFinal('turn', 'a', lead + ' ')
    if (kind === 'closed') live.disconnect('ended')
    else if (kind === 'new') live.beginTurn('different')
    else live.playbackBoundary(kind, 'interrupt')
    caption('old', voiced, 'assistant', undefined, 'old-session')
    caption('current', voiced)
    expect(items.has('live:old')).toBe(false)
    expect(items.get('live:current')?.narrationOf).toBeUndefined()
  })
  it('leaves ambiguous, failed and novel speech as independent replies', async () => {
    const { live, caption, items } = fixture()
    const origin = { sessionId: 'session', turnId: 'turn', itemId: 'a' }
    await live.speakAnswer(lead, origin)
    await live.speakAnswer(lead, { ...origin, itemId: 'b' })
    caption('ambiguous', voiced)
    caption('different', 'I cannot see the server and did not confirm the connection.')
    expect([...items.values()].every((i) => !i.narrationOf)).toBe(true)
    const failed = fixture(
      vi.fn(async () => {
        throw new Error('failure')
      }),
    )
    await expect(failed.live.speakAnswer(lead, origin)).rejects.toThrow('failure')
    failed.caption('after', lead)
    expect(failed.items.get('live:after')?.narrationOf).toBeUndefined()
  })
})
