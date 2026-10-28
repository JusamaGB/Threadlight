import { expect, it, vi } from 'vitest'
import { ProviderSnapshots } from '../src/main/sessions/providerSnapshots'
import { SessionService } from '../src/main/sessions/service'
import type { Snapshot } from '../src/shared/types'

const snapshot = (currentThreadId: string): Snapshot => ({
  sessions: [],
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId,
})

it('retains the last complete pair until both providers finish, then publishes once', async () => {
  const changed = vi.fn()
  const cache = new ProviderSnapshots(changed)
  cache.update('claude', snapshot('claude-old'))
  cache.update('codex', snapshot('codex-old'))
  changed.mockClear()
  let finish!: () => void
  const batch = cache.batch(async () => {
    cache.update('claude', snapshot('claude-new'))
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    cache.update('codex', snapshot('codex-new'))
  })
  expect(cache.snapshots.claude.currentThreadId).toBe('claude-old')
  expect(cache.snapshots.codex.currentThreadId).toBe('codex-old')
  expect(changed).not.toHaveBeenCalled()
  finish()
  await batch
  expect(cache.snapshots.claude.currentThreadId).toBe('claude-new')
  expect(cache.snapshots.codex.currentThreadId).toBe('codex-new')
  expect(changed).toHaveBeenCalledTimes(1)
  cache.update('codex', snapshot('hook'))
  expect(cache.snapshots.codex.currentThreadId).toBe('hook')
})

it('releases a failed batch without leaving later hook updates blocked', async () => {
  const cache = new ProviderSnapshots(vi.fn())
  await expect(
    cache.batch(async () => {
      throw new Error('failed')
    }),
  ).rejects.toThrow('failed')
  cache.update('claude', snapshot('hook'))
  expect(cache.snapshots.claude.currentThreadId).toBe('hook')
})

it('preloads workspace rows and does not rescan identical view requests', async () => {
  const scan = vi.fn(async () => snapshot('current'))
  const service = new SessionService({ snapshot: scan }, vi.fn())
  const view = { expanded: ['workspace'], showAll: [] }
  expect(service.setView(view, false)).toBe(true)
  await service.refresh()
  expect(scan).toHaveBeenCalledExactlyOnceWith({ ...view, preload: true })
  expect(service.setView({ ...view })).toBe(false)
  expect(scan).toHaveBeenCalledTimes(1)
})
