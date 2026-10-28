import { expect, it } from 'vitest'
import { ThreadReadReceipts } from '../src/shared/threadReadReceipts'
import type { Session, Snapshot } from '../src/shared/types'

const session = (state: Session['state'], extra: Partial<Session> = {}): Session =>
  ({
    id: 'codex:one',
    state,
    orderAt: 1,
    lastReply: null,
    recap: null,
    ...extra,
  }) as Session
const snapshot = (...sessions: Session[]): Snapshot => ({
  sessions,
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
})
const unread = (receipts: ThreadReadReceipts, value: Session) =>
  receipts.decorate(snapshot(value)).sessions[0]!.unread

it('quietly baselines historical replies, then marks a new completion until it is opened', () => {
  const receipts = new ThreadReadReceipts()
  const old = session('idle', { lastReply: 'Earlier result' })
  receipts.observe(snapshot(old))
  expect(unread(receipts, old)).toBe(false)
  receipts.observe(snapshot(session('working')))
  const done = session('idle', { orderAt: 2, lastReply: 'New result' })
  receipts.observe(snapshot(done))
  expect(unread(receipts, done)).toBe(true)
  receipts.observe(snapshot({ ...done, title: 'Renamed', focusedAt: 5, lastActiveAt: 99 }))
  expect(unread(receipts, done)).toBe(true)
  expect(receipts.markRead(done.id)).toBe(true)
  expect(receipts.markRead(done.id)).toBe(false)
  receipts.observe(snapshot(done))
  expect(unread(receipts, done)).toBe(false)
})

it('retains unread and read receipts across reloads without storing message text', () => {
  let receipts = new ThreadReadReceipts()
  receipts.observe(snapshot(session('working')))
  const done = session('idle', { lastReply: 'Private synthetic result' })
  receipts.observe(snapshot(done))
  expect(receipts.serialize()).not.toContain('Private synthetic result')
  receipts = new ThreadReadReceipts(receipts.serialize())
  receipts.observe(snapshot(done))
  expect(unread(receipts, done)).toBe(true)
  receipts.markRead(done.id)
  receipts = new ThreadReadReceipts(receipts.serialize())
  receipts.observe(snapshot(done))
  expect(unread(receipts, done)).toBe(false)
})

it('detects completion while the UI was closed and a new turn with the same final text', () => {
  let receipts = new ThreadReadReceipts()
  receipts.observe(snapshot(session('working')))
  receipts = new ThreadReadReceipts(receipts.serialize())
  const done = session('idle', { lastReply: 'Done' })
  receipts.observe(snapshot(done))
  expect(unread(receipts, done)).toBe(true)
  receipts.markRead(done.id)
  receipts.observe(snapshot(session('working')))
  receipts.observe(snapshot(done))
  expect(unread(receipts, done)).toBe(true)
})

it('keeps working and waiting states free of blue completion dots, with provider isolation', () => {
  const receipts = new ThreadReadReceipts()
  receipts.observe(snapshot(session('working'), session('idle', { id: 'claude-thread' })))
  const done = session('idle', { lastReply: 'Done' })
  receipts.observe(snapshot(done, session('idle', { id: 'claude-thread' })))
  expect(unread(receipts, done)).toBe(true)
  expect(unread(receipts, session('idle', { id: 'claude-thread' }))).toBe(false)
  receipts.observe(snapshot(session('waiting')))
  expect(unread(receipts, session('waiting'))).toBe(false)
  receipts.observe(snapshot(session('working')))
  expect(unread(receipts, session('working'))).toBe(false)
})

it('detects late final replies once, while metadata-only snapshots never recreate a read dot', () => {
  const receipts = new ThreadReadReceipts()
  const done = session('idle', { lastReply: 'First result' })
  receipts.observe(snapshot(done))
  receipts.observe(snapshot({ ...done, lastReply: 'Final result' }))
  expect(unread(receipts, done)).toBe(true)
  receipts.markRead(done.id)
  receipts.observe(
    snapshot({ ...done, lastReply: 'Final result', contextUsed: 0.8, title: 'Updated title' }),
  )
  expect(unread(receipts, done)).toBe(false)
})

it('decorates tree and lookup copies consistently without mutating provider snapshots', () => {
  const receipts = new ThreadReadReceipts()
  receipts.observe(snapshot(session('working')))
  const done = session('idle')
  const value = {
    ...snapshot(done),
    lookupSessions: [done],
    workspaces: [
      {
        id: 'workspace',
        name: 'Workspace',
        threadCount: 1,
        activeCount: 0,
        anyWorking: false,
        threads: [{ session: done, children: [] }],
        hiddenCount: 0,
        worktrees: 0,
      },
    ],
  }
  receipts.observe(value)
  const decorated = receipts.decorate(value)
  expect(decorated.sessions[0]?.unread).toBe(true)
  expect(decorated.lookupSessions?.[0]?.unread).toBe(true)
  expect(decorated.workspaces[0]?.threads[0]?.session.unread).toBe(true)
  expect(done.unread).toBeUndefined()
})

it('ignores invalid saved storage and bounds persisted receipt count', () => {
  const receipts = new ThreadReadReceipts('{bad json')
  receipts.observe(
    snapshot(...Array.from({ length: 600 }, (_, i) => session('idle', { id: String(i) }))),
  )
  expect(JSON.parse(receipts.serialize())).toHaveLength(500)
})
