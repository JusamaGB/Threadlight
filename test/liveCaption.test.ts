import { describe, expect, it, vi } from 'vitest'
import type { AgentItem } from '../src/shared/agent'
import { agentTranscript } from '../src/shared/agentTranscript'
import { LeadPlayback } from '../src/main/agent/leadPlayback'
import { CodexLive } from '../src/main/agent/codexLive'
import type { CodexTransport } from '../src/main/agent/codexClient'
const lead =
  'I can see this file: you said the server was restarted and the editor reconnected, and I confirmed the connection.'
const voiced =
  'In this file, I see you said the server was restarted and the editor was reconnected, and then I confirmed the connection.'
const tail = 'If you show me the example again, I can continue from there.'
const voicedTail = 'If you show me the example again, I’ll continue from there.'
function fixture(request = vi.fn(async () => ({}))) {
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
