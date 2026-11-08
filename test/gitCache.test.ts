import { describe, expect, it, vi } from 'vitest'
import { CaptureCache } from '../src/main/changes/cache'

describe('shared root comparison capture', () => {
  it('keeps one in-flight scan even when the cache age has elapsed', async () => {
    let finish!: (value: number) => void
    const read = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve
        }),
    )
    const cache = new CaptureCache<number>()
    const first = cache.get('root/current', read, 0)
    const second = cache.get('root/current', read, 6000)
    expect(read).toHaveBeenCalledTimes(1)
    finish(42)
    expect(await first).toBe(42)
    expect(await second).toBe(42)
  })
  it('drains invalidated work before capturing a fresh generation', async () => {
    const pending: ((value: number) => void)[] = []
    const read = vi.fn(() => new Promise<number>((resolve) => pending.push(resolve)))
    const cache = new CaptureCache<number>()
    const old = cache.get('root/current', read, 0)
    cache.invalidate((key) => key === 'root/current')
    const fresh = cache.get('root/current', read, 0)
    expect(read).toHaveBeenCalledTimes(1)
    pending.shift()!(1)
    expect(await old).toBe(1)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    pending.shift()!(2)
    expect(await fresh).toBe(2)
  })
  it('never shares captures across worktrees or lenses and retries failures', async () => {
    const cache = new CaptureCache<number>()
    await expect(
      cache.get(
        'root/current',
        async () => {
          throw Error('offline')
        },
        0,
      ),
    ).rejects.toThrow('offline')
    expect(await cache.get('root/current', async () => 1, 0)).toBe(1)
    expect(await cache.get('root/staged', async () => 2, 0)).toBe(2)
    expect(await cache.get('worktree/current', async () => 3, 0)).toBe(3)
  })
})
