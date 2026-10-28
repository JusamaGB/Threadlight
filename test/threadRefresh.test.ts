import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { ThreadChanges } from '../src/main/sessions/threadChanges'
import { UncommittedThreads } from '../src/main/sessions/threadUncommitted'
import type { Session, Snapshot } from '../src/shared/types'

it('retains settled entries for every listed chat beyond the idle cache budget', async () => {
  const transcript = vi.fn(() => null)
  const service = new ThreadChanges({
    history: '',
    transcript,
    changed: () => {},
    now: () => 0,
  })
  const sessions = Array.from(
    { length: 140 },
    (_, i) =>
      ({
        id: `claude-${i}`,
        cwd: 'workspace',
        git: { root: 'workspace' },
        lastActiveAt: 0,
      }) as Session,
  )
  const snapshot = { sessions, workspaces: [] } as unknown as Snapshot
  service.annotate(snapshot)
  await Promise.all(sessions.map((session) => service.changes(session)))
  expect(transcript).toHaveBeenCalledTimes(140)
  const next = service.annotate({
    ...snapshot,
    sessions: [
      ...sessions,
      {
        ...sessions[0]!,
        id: 'newly-listed',
      },
    ],
  })
  expect(
    next.sessions.slice(0, 140).every((session) => session.threadDiffStatus === 'unavailable'),
  ).toBe(true)
  await Promise.all(sessions.map((session) => service.changes(session)))
  expect(transcript).toHaveBeenCalledTimes(140)
})

it('does not show initial loading again while retrying an unavailable diff', async () => {
  let now = 0
  const service = new ThreadChanges({
    history: '',
    transcript: () => null,
    changed: () => {},
    now: () => now,
  })
  const session = { id: 'claude-one', cwd: 'workspace', git: { root: 'workspace' } } as Session
  const snapshot = { sessions: [session], workspaces: [] } as unknown as Snapshot
  expect(service.annotate(snapshot).sessions[0]!.threadDiffStatus).toBe('loading')
  await service.changes(session)
  now = 6000
  expect(service.annotate(snapshot).sessions[0]!.threadDiffStatus).toBe('unavailable')
  await service.changes(session)
})

it('publishes a valid diff despite ongoing native activity, then coalesces a follow-up read', async () => {
  const home = await mkdtemp(join(tmpdir(), 'threadlight-busy-refresh-'))
  const history = join(home, 'history.sqlite'),
    db = new DatabaseSync(history)
  let now = 0
  let first!: () => void, second!: () => void
  const firstRead = new Promise<void>((resolve) => {
    first = resolve
  })
  const secondRead = new Promise<void>((resolve) => {
    second = resolve
  })
  const project = vi
    .spyOn(UncommittedThreads.prototype, 'project')
    .mockImplementationOnce(async (ledger) => {
      await firstRead
      return ledger.data(home)
    })
    .mockImplementationOnce(async (ledger) => {
      await secondRead
      return ledger.data(home)
    })
  const service = new ThreadChanges({
    history,
    transcript: () => null,
    changed: () => {},
    now: () => now,
  })
  const session = { id: 'codex:busy', cwd: home, git: { root: home }, lastActiveAt: 0 } as Session
  try {
    db.exec(
      'CREATE TABLE thread_items(thread_id TEXT,item_json TEXT,rollout_ordinal INTEGER,item_type TEXT)',
    )
    db.prepare('INSERT INTO thread_items VALUES (?,?,?,?)').run(
      'busy',
      JSON.stringify({
        type: 'fileChange',
        id: 'edit',
        status: 'completed',
        changes: [
          {
            path: join(home, 'own.ts'),
            kind: { type: 'update' },
            diff: '@@ -1 +1 @@\n-before\n+after\n',
          },
        ],
      }),
      1,
      'fileChange',
    )
    service.annotate({ sessions: [session], workspaces: [] } as unknown as Snapshot)
    const reading = service.changes(session)
    expect(service.summary(session)).toBeNull()
    await vi.waitFor(() => expect(project).toHaveBeenCalledTimes(1))
    service.summary({ ...session, lastActiveAt: 1 })
    const latest = { ...session, lastActiveAt: 2 }
    service.summary(latest)
    service.invalidate(home)
    first()
    await vi.waitFor(() => expect(project).toHaveBeenCalledTimes(2))
    // The follow-up is still blocked. The first valid result must already be usable.
    expect(service.summary(latest)).toMatchObject({ files: 1, added: 1, removed: 1 })
    expect((await reading)?.files).toHaveLength(1)
    second()
    expect((await service.changes(latest))?.files).toHaveLength(1)
    expect(project).toHaveBeenCalledTimes(2)
    project.mockResolvedValueOnce(null)
    now = 6000
    expect((await service.changes(latest))?.files).toHaveLength(1)
    expect(service.summary(latest)).toMatchObject({ files: 1, added: 1, removed: 1 })
  } finally {
    first()
    second()
    await service.changes({ ...session, lastActiveAt: 2 })
    project.mockRestore()
    db.close()
    await rm(home, { recursive: true, force: true })
  }
})
