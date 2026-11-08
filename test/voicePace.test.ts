import { expect, it, vi } from 'vitest'
import { CodexLive } from '../src/main/agent/codexLive'
import type { CodexTransport } from '../src/main/agent/codexClient'
import { VOICE_PACE, VOICE_PACES } from '../src/shared/voicePace'

it.each([false, true])(
  'applies pacing outside the quoted answer in a new session (playback only: %s)',
  async (playbackOnly) => {
    const request = vi.fn(async () => ({}))
    const live = new CodexLive(
      { request } as unknown as CodexTransport,
      'thread',
      'session',
      () => {},
      () => {},
    )
    const starting = live.start('offer', playbackOnly, 'slightly-slower')
    live.event('thread/realtime/sdp', { threadId: 'thread', sdp: 'answer' })
    await expect(starting).resolves.toBe('answer')
    const cue = VOICE_PACE['slightly-slower'].instruction
    expect(request).toHaveBeenCalledWith(
      'thread/realtime/start',
      expect.objectContaining({
        prompt: expect.stringContaining(cue),
        initialItems: [expect.objectContaining({ text: expect.stringContaining(cue) })],
      }),
    )
    await live.speakAnswer('Look at the highlighted line.')
    expect(request).toHaveBeenCalledWith(
      'thread/realtime/appendSpeech',
      expect.objectContaining({ text: expect.stringContaining('"Look at the highlighted line."') }),
    )
    live.disconnect('done')
  },
)

it('keeps the normal provider voice unchanged and maps all five Windows rates', () => {
  expect(VOICE_PACE.normal.instruction).toBe('')
  expect(VOICE_PACES.map((p) => VOICE_PACE[p].windowsRate)).toEqual([-2, -1, 0, 1, 2])
})
