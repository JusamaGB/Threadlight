import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { timing } from '../src/shared/liveTiming'
import { setLiveTimingFile, recordLiveTiming } from '../src/main/agent/liveTiming'
it('writes only phase, numbered call, monotonic time and queue duration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'threadlight-timing-')),
    file = join(dir, 'timing.jsonl')
  const id = '00000000-0000-4000-8000-000000000001'
  setLiveTimingFile(file)
  try {
    const mark = timing(id, 'ready', 4512)
    recordLiveTiming({ ...mark, phase: 'unknown' } as unknown as typeof mark)
    recordLiveTiming({ ...mark, transcript: 'sensitive fixture text' } as typeof mark)
    const line = await vi.waitFor(async () => {
      const value = await readFile(file, 'utf8')
      expect(value.trim()).not.toBe('')
      return value
    })
    expect(JSON.parse(line)).toEqual({
      call: expect.any(Number),
      phase: 'ready',
      at: mark.at,
      queueMs: 4512,
    })
    expect(line).not.toContain(id)
    expect(line).not.toContain('sensitive')
  } finally {
    setLiveTimingFile()
    await rm(dir, { recursive: true, force: true })
  }
})
