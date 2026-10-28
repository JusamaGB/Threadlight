import { describe, expect, it, vi } from 'vitest'
import { ArtifactCatalog } from '../src/shared/artifactCatalog'
import type { ArtifactReply } from '../src/shared/artifacts'

const result = (title: string): ArtifactReply => ({
  ok: true,
  items: [{ id: 'a', title, kind: 'text', mime: 'text/plain', createdAt: 1 }],
})
const deferred = () => {
  let resolve!: (reply: ArtifactReply) => void
  const promise = new Promise<ArtifactReply>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('shared artifact catalog', () => {
  it('shares discovery between rows and viewers, retaining chips across view remounts', async () => {
    const pending = deferred()
    const fetch = vi.fn(() => pending.promise)
    const cache = new ArtifactCatalog(fetch)
    const unsubscribe = cache.subscribe('codex:one', vi.fn())
    const read = cache.refresh('codex:one')
    expect(fetch).toHaveBeenCalledTimes(1)
    pending.resolve(result('Storyboard'))
    await read
    unsubscribe()
    const before = cache.get('codex:one')
    cache.subscribe('codex:one', vi.fn())
    expect(cache.get('codex:one')).toBe(before)
    expect(before?.items[0]?.title).toBe('Storyboard')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps newer push events when an older discovery request completes', async () => {
    const pending = deferred()
    const cache = new ArtifactCatalog(() => pending.promise)
    const read = cache.refresh('one')
    cache.accept('one', result('New'))
    pending.resolve(result('Old'))
    await read
    expect(cache.get('one')?.items[0]?.title).toBe('New')
  })

  it('keeps last known metadata through transient failures without retaining content bytes', async () => {
    const cache = new ArtifactCatalog(
      async () => {
        throw new Error('offline')
      },
      () => 10000,
    )
    cache.accept('one', { ok: true, items: [], content: 'large private file bytes' })
    expect(await cache.refresh('one', 0)).toEqual({ ok: true, items: [] })
    expect(cache.get('one')).not.toHaveProperty('content')
  })

  it('limits concurrency and warms only twelve hidden threads per tick', async () => {
    const pending: ReturnType<typeof deferred>[] = []
    const fetch = vi.fn(() => {
      const next = deferred()
      pending.push(next)
      return next.promise
    })
    const cache = new ArtifactCatalog(fetch)
    cache.tick(Array.from({ length: 100 }, (_, i) => `thread-${i}`))
    expect(fetch).toHaveBeenCalledTimes(4)
    for (let batch = 0; batch < 3; batch++) {
      for (const next of pending.splice(0)) next.resolve(result('Warm'))
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(Math.min(12, (batch + 2) * 4)))
    }
    expect(fetch).toHaveBeenCalledTimes(12)
  })

  it('evicts old unobserved entries while keeping mounted rows', () => {
    let now = 0
    const cache = new ArtifactCatalog(
      async () => result('Fresh'),
      () => ++now,
      2,
    )
    cache.accept('mounted', result('Mounted'))
    cache.subscribe('mounted', vi.fn())
    cache.accept('old', result('Old'))
    cache.accept('new', result('New'))
    expect(cache.get('mounted')).toBeDefined()
    expect(cache.get('old')).toBeUndefined()
    expect(cache.get('new')).toBeDefined()
  })
})
