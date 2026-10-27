import { describe, expect, it, vi } from 'vitest'
import { ThreadDiffLedger } from '../src/main/sessions/threadDiff'
import { UncommittedThreads } from '../src/main/sessions/threadUncommitted'
import { runGit } from '../src/main/sessions/gitProcess'

vi.mock('../src/main/sessions/gitProcess', () => ({ runGit: vi.fn() }))

describe('shared uncommitted snapshot', () => {
  it('keeps one in-flight scan even when the cache age has elapsed', async () => {
    const pending: ((value: string) => void)[] = []
    vi.mocked(runGit).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const cache = new UncommittedThreads(),
      ledger = new ThreadDiffLedger()
    const first = cache.project(ledger, '/same-repo', 0)
    const second = cache.project(ledger, '/same-repo', 6000)
    expect(runGit).toHaveBeenCalledTimes(3)
    pending.forEach((resolve) => resolve(''))
    expect((await first)?.summary.files).toBe(0)
    expect((await second)?.summary.files).toBe(0)
  })

  it('waits for invalidated in-flight work and then obtains a new snapshot', async () => {
    vi.mocked(runGit).mockReset()
    const pending: ((value: string) => void)[] = []
    vi.mocked(runGit).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const cache = new UncommittedThreads(),
      ledger = new ThreadDiffLedger()
    const old = cache.project(ledger, '/same-repo', 0)
    cache.invalidate('/same-repo')
    const fresh = cache.project(ledger, '/same-repo', 0)
    expect(runGit).toHaveBeenCalledTimes(3)
    pending.splice(0).forEach((resolve) => resolve(''))
    await old
    await vi.waitFor(() => expect(runGit).toHaveBeenCalledTimes(6))
    pending.splice(0).forEach((resolve) => resolve(''))
    expect((await fresh)?.summary.files).toBe(0)
  })
})
