import { describe, expect, it } from 'vitest'
import { IgnoredInput } from '../src/main/ignoredInput'
import { attentionThreads } from '../src/shared/attentionMotion'
import { recentSessions } from '../src/shared/sessionOrder'
import type { Session, Snapshot } from '../src/shared/types'

const session = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    state: 'idle',
    attention: null,
    lastActiveAt: 0,
    ...extra,
  }) as Session
const question = (holdId: string): Session['attention'] => ({
  kind: 'question',
  holdId,
  questions: [],
  answerableUntil: null,
})
const waiting = (id: string, holdId = 'hold-1', lastActiveAt = 1) =>
  session(id, { state: 'waiting', attention: question(holdId), lastActiveAt })
const snapshot = (sessions: Session[]): Snapshot => ({
  sessions,
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
})

describe('IgnoredInput', () => {
  it('sets aside a pending request and lets it be flagged again', () => {
    const ignored = new IgnoredInput()
    const thread = waiting('a')
    expect(ignored.isIgnored(thread)).toBe(false)
    ignored.set(thread, true)
    expect(ignored.isIgnored(thread)).toBe(true)
    ignored.set(thread, false)
    expect(ignored.isIgnored(thread)).toBe(false)
  })

  it('only ever applies to a thread that is waiting on the user', () => {
    const ignored = new IgnoredInput()
    const idle = session('a')
    ignored.set(idle, true)
    expect(ignored.isIgnored(idle)).toBe(false)
    expect(ignored.isIgnored({ ...idle, state: 'waiting' })).toBe(false)
  })

  it('flags a new question from the same thread again', () => {
    const ignored = new IgnoredInput()
    ignored.set(waiting('a', 'hold-1'), true)
    expect(ignored.isIgnored(waiting('a', 'hold-1'))).toBe(true)
    expect(ignored.isIgnored(waiting('a', 'hold-2'))).toBe(false)
  })

  it('tells a plain waiting state from a card, and forgets a mark once the thread moves on', () => {
    const ignored = new IgnoredInput()
    const plain = session('a', { state: 'waiting' })
    ignored.set(plain, true)
    const [flagged] = ignored.annotate(snapshot([plain])).sessions
    expect(flagged?.ignored).toBe(true)
    // It answers, works, then waits for something else: the old mark must not come back.
    ignored.annotate(snapshot([session('a', { state: 'working' })]))
    expect(ignored.isIgnored(plain)).toBe(false)
    expect(ignored.annotate(snapshot([plain])).sessions[0]?.ignored).toBeUndefined()
  })

  it('flags the same thread wherever the snapshot lists it', () => {
    const ignored = new IgnoredInput()
    const thread = waiting('a')
    ignored.set(thread, true)
    const result = ignored.annotate({
      ...snapshot([thread]),
      lookupSessions: [thread, session('b')],
      workspaces: [
        {
          id: 'w',
          name: 'w',
          threadCount: 1,
          activeCount: 1,
          anyWorking: false,
          threads: [{ session: thread, children: [{ session: waiting('c'), children: [] }] }],
          hiddenCount: 0,
          worktrees: 0,
        },
      ],
    })
    expect(result.sessions[0]?.ignored).toBe(true)
    expect(result.lookupSessions?.[0]?.ignored).toBe(true)
    expect(result.workspaces[0]?.threads[0]?.session.ignored).toBe(true)
    expect(result.workspaces[0]?.threads[0]?.children[0]?.session.ignored).toBeUndefined()
  })
})

describe('an ignored thread', () => {
  it('stops being held in Recent beyond the normal list', () => {
    const old = waiting('old', 'hold-1', 1)
    const fresh = [10, 20, 30].map((n) => session(`idle-${n}`, { lastActiveAt: n }))
    const all = [old, ...fresh]
    // Waiting threads keep a place however old...
    expect(recentSessions(all, 2).map((s) => s.id)).toContain('old')
    // ...until the user sets one aside; then it competes like any other thread.
    const ignored = new IgnoredInput()
    ignored.set(old, true)
    const pinned = (s: Session) => s.state !== 'idle' && !ignored.isIgnored(s)
    expect(recentSessions(all, 2, pinned).map((s) => s.id)).toEqual(['idle-30', 'idle-20'])
    expect(recentSessions(all, 4, pinned).map((s) => s.id)).toContain('old')
  })

  it('no longer drips', () => {
    const a = waiting('a', 'hold-1', 5)
    const b = { ...waiting('b', 'hold-2', 10), ignored: true }
    expect(attentionThreads([a, b]).map((s) => s.id)).toEqual(['a'])
  })
})
