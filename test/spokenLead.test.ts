import { describe, expect, it, vi } from 'vitest'
import { CodexLive } from '../src/main/agent/codexLive'
import { spokenLead } from '../src/main/agent/spokenLead'
import type { CodexTransport } from '../src/main/agent/codexClient'

const lead = 'Ordering lets each comparison eliminate half of the candidates.'
const final = {
  id: 'message',
  type: 'agentMessage',
  phase: 'final_answer',
  text: lead + '\n\n```python\nprint(1)\n```',
}
function setup() {
  const request = vi.fn(async () => ({})),
    interrupt = vi.fn()
  const live = new CodexLive(
    { request } as unknown as CodexTransport,
    'thread',
    'session',
    vi.fn(),
    vi.fn(),
    false,
    interrupt,
  )
  live.beginTurn('turn')
  return { live, request, interrupt }
}
describe('delegated spoken lead', () => {
  it('waits for a complete prose sentence and leaves incomplete or code-first text alone', () => {
    for (const text of [
      lead,
      'The average is 3.',
      'Use the following e.g. result',
      '```python\na = 2.',
      '# A heading.\n',
      'Try `return` in the loop. Then',
    ])
      expect(spokenLead(text)).toBeNull()
    expect(spokenLead(final.text)).toBe(lead)
    expect(spokenLead('The `return` statement sends the value back.\n\nThe caller')).toBe(
      'The return statement sends the value back.',
    )
  })
  it('submits one stable lead before completion, with no code or final replay', async () => {
    const { live, request } = setup()
    live.streamFinal('turn', 'message', lead)
    expect(request).not.toHaveBeenCalled()
    live.streamFinal('turn', 'message', lead + '\n')
    live.streamFinal('turn', 'message', final.text)
    expect(request).toHaveBeenCalledTimes(1)
    await live.finishTurn({ id: 'turn', status: 'completed', items: [final] })
    live.beginTurn('turn')
    live.streamFinal('turn', 'message', final.text)
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(request.mock.calls)).not.toContain('print(1)')
  })
  it('waits for the matching playback boundary, and cancels obsolete delayed speech', async () => {
    const { live, request } = setup()
    live.playbackBoundary('assistant', 'previous')
    live.streamFinal('turn', 'message', final.text)
    const pending = live.finishTurn({ id: 'turn', status: 'completed', items: [final] })
    live.playbackBoundary('done', 'unrelated')
    expect(request).not.toHaveBeenCalled()
    live.playbackBoundary('done', 'previous')
    await pending
    expect(request).toHaveBeenCalledTimes(1)
    live.playbackBoundary('assistant', 'audible')
    live.beginTurn('two')
    const stale = live.finishTurn({ id: 'two', status: 'completed', items: [final] })
    live.playbackBoundary('user', 'barge-in')
    live.playbackBoundary('done', 'audible')
    await stale
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each(['skip', 'user', 'new', 'end'] as const)('cancels a queued tail on %s', async (kind) => {
    const { live, request } = setup()
    live.streamFinal('turn', 'message', lead + '\n\n')
    live.playbackBoundary('assistant', 'lead')
    const pending = live.finishTurn({
      id: 'turn',
      status: 'completed',
      items: [{ ...final, text: lead + '\n\nMore details follow.' }],
    })
    await Promise.resolve()
    if (kind === 'new') live.beginTurn('another')
    else if (kind === 'end') live.disconnect('ended')
    else live.playbackBoundary(kind, 'interrupted')
    live.playbackBoundary('done', 'lead')
    await pending
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('waits for progress playback, then speaks a streamed lead before turn completion', async () => {
    const { live, request } = setup()
    vi.useFakeTimers()
    try {
      const note =
        'I’ll reconnect to the active buffer and continue with the unknown-item message change.'
      live.completedCommentary('turn', {
        id: 'opening',
        type: 'agentMessage',
        phase: 'commentary',
        text: note,
      })
      live.editorActivity('turn', 'review', false, {})
      await vi.advanceTimersByTimeAsync(6500)
      expect(request).toHaveBeenCalledTimes(1)
      live.streamFinal('turn', 'message', lead + '\n\n')
      live.playbackBoundary('assistant', 'progress')
      live.playbackBoundary('done', 'different')
      expect(request).toHaveBeenCalledTimes(1)
      live.playbackBoundary('done', 'progress', note)
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(2)
      await live.finishTurn({ id: 'turn', status: 'completed', items: [final] })
    } finally {
      vi.useRealTimers()
    }
  })
  it('preserves explicit Stop when a revised delegation arrives in the same turn', async () => {
    const { live, request } = setup()
    live.delegatedInput('turn', 'Please explain.')
    live.playbackBoundary('skip', '')
    live.playbackBoundary('user', 'late')
    live.delegatedInput('turn', 'Please explain. Hello.')
    live.streamFinal('turn', 'message', final.text)
    await live.finishTurn({ id: 'turn', status: 'completed', items: [final] })
    expect(request).not.toHaveBeenCalled()
  })
  it('cancels a superseded proposal before it can speak over a status update', async () => {
    const { live, request } = setup()
    vi.useFakeTimers()
    try {
      live.completedCommentary('turn', {
        id: 'opening',
        type: 'agentMessage',
        phase: 'commentary',
        text: 'I’ll review the receipt calculation.',
      })
      live.editorActivity('turn', 'context', true, {
        result: { content: [{ text: '{"outcome":"ok"}' }] },
      })
      await vi.advanceTimersByTimeAsync(7000)
      expect(request).toHaveBeenCalledTimes(1)
      live.playbackBoundary('assistant', 'progress')
      const queued = live.coachStep('The editor confirmed this change.', true, true)
      live.interruptProposal()
      await expect(queued).rejects.toThrow('interrupted')
      live.playbackBoundary('done', 'progress')
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('preserves guide pacing, Stop speaking and interrupted speech', async () => {
    const { live, request, interrupt } = setup()
    live.protectGuide('turn')
    live.streamFinal('turn', 'message', final.text)
    live.beginTurn('two')
    live.setGuideActive(true)
    live.streamFinal('two', 'message', final.text)
    live.setGuideActive(false)
    live.playbackBoundary('skip', '')
    live.streamFinal('two', 'message', final.text)
    expect(request).not.toHaveBeenCalled()
    live.beginTurn('three')
    live.streamFinal('three', 'message', final.text)
    live.playbackBoundary('assistant', 'native-id')
    live.event('thread/realtime/item/completed', {
      threadId: 'thread',
      item: { type: 'transcriptSegment', role: 'assistant', id: 'lead-caption', text: lead },
    })
    await live.finishTurn({ id: 'three', status: 'interrupted', items: [final] })
    expect(interrupt).toHaveBeenCalledWith('native-id')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
