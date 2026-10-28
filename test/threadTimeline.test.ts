import { afterEach, expect, it, vi } from 'vitest'
import { ThreadTimelineService } from '../src/main/threadTimeline'
import type { StreamUpdate } from '../src/main/codex/threadStream'
import type { AdapterRead } from '../src/main/threadRead/types'
import type { TimelineItem, ThreadTimeline } from '../src/shared/threadTimeline'

const id = 'codex:11111111-1111-4111-8111-111111111111'
const item = (id: string, text = id): TimelineItem => ({
  id,
  text,
  role: 'assistant',
  phase: 'progress',
  kind: 'message',
  at: null,
  turnId: 'turn',
  complete: false,
  source: 'test',
})
const page = (items: TimelineItem[], more = false): AdapterRead => ({
  items,
  sources: [{ source: 'test', health: 'ok', checkedAt: 1 }],
  status: { state: 'working', basis: 'provider_turn', at: 1, turnId: 'turn' },
  coverage: [],
  changedDuringRead: false,
  cursor: more ? { identity: 'file', boundary: 100, position: 50 } : undefined,
})
const services: ThreadTimelineService[] = []
afterEach(() => {
  services.forEach((s) => s.close())
  services.length = 0
  vi.useRealTimers()
})

function setup() {
  vi.useFakeTimers()
  let emit!: (value: StreamUpdate) => void
  const changed: ThreadTimeline[] = []
  const read = vi.fn(async () => page([item('a'), item('b')], true))
  const stop = vi.fn(),
    allowed = vi.fn(() => true)
  const service = new ThreadTimelineService({
    read,
    allowed,
    follow: (_id, cb) => {
      emit = cb
      return stop
    },
    changed: (value) => changed.push(structuredClone(value)),
  })
  services.push(service)
  const request = (action: 'open' | 'close' | 'older', subscriptionId = 'view') =>
    service.request({ threadId: id, subscriptionId, action })
  return {
    service,
    request,
    read,
    stop,
    allowed,
    changed,
    emit: (value: StreamUpdate) => emit(value),
  }
}

it('uses native IDs for streaming updates and retains loaded pages and content through failures', async () => {
  const s = setup()
  await s.request('open')
  await vi.advanceTimersByTimeAsync(0)
  s.emit({ connection: 'live', items: [item('a'), item('b', 'Streaming')] })
  s.emit({ connection: 'live', items: [item('a'), item('b', 'Streaming text')] })
  expect(s.changed.at(-1)?.items.map((i) => i.id)).toEqual(['a', 'b'])
  s.read.mockResolvedValueOnce(page([item('older'), item('a')]))
  await s.request('older')
  expect(s.changed.at(-1)?.items.map((i) => i.id)).toEqual(['older', 'a', 'b'])
  s.emit({ connection: 'reconnecting', notice: 'Connection lost' })
  s.read.mockRejectedValueOnce(Error('Offline'))
  await vi.advanceTimersByTimeAsync(1600)
  expect(s.changed.at(-1)?.items.at(-1)?.text).toBe('Streaming text')
  expect(s.changed.at(-1)?.items[0]?.id).toBe('older')
  s.emit({ connection: 'live', items: [item('a'), item('b', 'Done')] })
  expect(s.changed.at(-1)?.items.map((i) => i.id)).toEqual(['older', 'a', 'b'])
})

it('shares subscriptions, stops at last collapse and restores retained history on reopen', async () => {
  const s = setup()
  await s.request('open')
  await s.request('open', 'other')
  await vi.advanceTimersByTimeAsync(0)
  s.emit({ connection: 'live', items: [item('b', 'Retained')] })
  await s.request('close')
  expect(s.stop).not.toHaveBeenCalled()
  await s.request('close', 'other')
  expect(s.stop).toHaveBeenCalledTimes(1)
  const reopened = await s.request('open')
  expect(reopened).toMatchObject({
    ok: true,
    timeline: { items: [expect.objectContaining({ text: 'Retained' })] },
  })
})

it('does not allow late fallback reads to overwrite a newer native snapshot', async () => {
  const s = setup()
  let resolve!: (value: AdapterRead) => void
  s.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await s.request('open')
  s.emit({ connection: 'live', items: [item('native', 'Current')] })
  resolve(page([item('stale')], true))
  await vi.advanceTimersByTimeAsync(0)
  expect(s.changed.at(-1)?.items.map((i) => i.id)).toEqual(['native'])
  expect(s.changed.at(-1)?.hasMore).toBe(true)
})

it('stops live observation when monitoring is disabled and refuses unowned pagination', async () => {
  const s = setup()
  expect(await s.request('older')).toMatchObject({ ok: false })
  await s.request('open')
  await vi.advanceTimersByTimeAsync(0)
  s.emit({ connection: 'live', items: [item('a')] })
  s.allowed.mockReturnValue(false)
  await vi.advanceTimersByTimeAsync(1600)
  expect(s.stop).toHaveBeenCalledOnce()
  expect(s.changed.at(-1)?.connection).toBe('unavailable')
  expect(await s.request('open', 'new')).toMatchObject({ ok: false })
})

it('polls Claude saved history without starting a Codex stream', async () => {
  vi.useFakeTimers()
  const changed = vi.fn(),
    follow = vi.fn(),
    read = vi.fn(async () => page([item('claude')]))
  const service = new ThreadTimelineService({ allowed: () => true, read, changed, follow })
  services.push(service)
  await service.request({ threadId: id.slice(6), subscriptionId: 'view', action: 'open' })
  await vi.advanceTimersByTimeAsync(0)
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'history' }))
  expect(follow).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1600)
  expect(read).toHaveBeenCalledTimes(2)
})

it('retains live messages when a lagging fallback projection is empty', async () => {
  const s = setup()
  await s.request('open')
  await vi.advanceTimersByTimeAsync(0)
  s.emit({ connection: 'live', items: [item('native', 'Keep this message')] })
  s.emit({ connection: 'reconnecting', notice: 'Reconnecting' })
  s.read.mockResolvedValueOnce(page([]))
  await vi.advanceTimersByTimeAsync(1600)
  expect(s.changed.at(-1)?.items).toEqual([item('native', 'Keep this message')])
})

it('does not publish pagination from a subscription closed during its read', async () => {
  const s = setup()
  await s.request('open')
  await vi.advanceTimersByTimeAsync(0)
  let finish!: (value: AdapterRead) => void
  s.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const older = s.request('older')
  await s.request('close')
  const count = s.changed.length
  finish(page([item('late')]))
  await older
  expect(s.changed).toHaveLength(count)
})

it('resolves previews only for recorded images in an open, allowed thread', async () => {
  const s = setup()
  await s.request('open')
  await vi.advanceTimersByTimeAsync(0)
  s.emit({
    connection: 'live',
    items: [
      { ...item('image'), role: 'activity', activity: 'image', detail: 'C:/screenshots/first.png' },
      {
        ...item('command'),
        role: 'activity',
        activity: 'command',
        detail: 'C:/screenshots/private.png',
      },
    ],
  })
  expect(s.service.imagePath(id, 'image')).toBe('C:/screenshots/first.png')
  expect(s.service.imagePath(id, 'command')).toBeNull()
  expect(s.service.imagePath('other', 'image')).toBeNull()
  expect(s.service.imagePath(id, 'unknown')).toBeNull()
  s.allowed.mockReturnValue(false)
  expect(s.service.imagePath(id, 'image')).toBeNull()
  s.allowed.mockReturnValue(true)
  await s.request('close')
  expect(s.service.imagePath(id, 'image')).toBeNull()
})
