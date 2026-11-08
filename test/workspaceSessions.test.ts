import { describe, expect, it } from 'vitest'
import { workspaceSessions } from '../src/shared/workspaceSessions'
import { recentSessions } from '../src/shared/sessionOrder'
import type { Session, Snapshot, Workspace } from '../src/shared/types'

const chat = (id: string, cwd: string, at = 100, state = 'idle') =>
  ({ id, cwd, lastActiveAt: at, state }) as Session
const group = (id: string, sessions: Session[]): Workspace => ({
  id,
  name: id,
  threads: sessions.map((session) => ({ session, children: [] })),
  threadCount: sessions.length,
  activeCount: 0,
  anyWorking: false,
  hiddenCount: 0,
  worktrees: 1,
})
const snapshot = (workspaces: Workspace[], sessions: Session[] = []) =>
  ({ workspaces, sessions, allWorkspaces: [], currentWorkspace: null }) as unknown as Snapshot

describe('shared workspace scope', () => {
  it('filters before the Recent limit, keeping both apps and excluding adjacent worktrees', () => {
    const own = [chat('claude-a', 'Z:/repo', 101), chat('codex:a', '\\\\?\\Z:\\repo', 102)]
    const outside = chat('codex:other', 'Z:/repo-worktree', 200)
    const data = snapshot(
      [
        group('claude:Z:/repo', [own[0]!]),
        group('codex:\\\\?\\Z:\\repo', [own[1]!]),
        group('codex:Z:/repo-worktree', [outside]),
      ],
      [outside],
    )
    expect(
      recentSessions(workspaceSessions(data, 'Z:/repo', false, 50), 1).map((s) => s.id),
    ).toEqual(['codex:a'])
    expect(workspaceSessions(data, 'z:\\repo', false, 50).map((s) => s.id)).toEqual([
      'codex:a',
      'claude-a',
    ])
    expect(workspaceSessions(data, 'Z:/repo-worktree', false, 50).map((s) => s.id)).toEqual([
      'codex:other',
    ])
  })

  it('keeps side threads with their owning workspace rather than adopting their other cwd', () => {
    const parent = group('C:/project', [chat('parent', 'C:/project')])
    parent.threads[0]!.children.push({ session: chat('child', 'D:/elsewhere'), children: [] })
    const data = snapshot([parent], [chat('child', 'D:/elsewhere')])
    expect(workspaceSessions(data, 'C:/project', false, 0).map((s) => s.id)).toEqual([
      'child',
      'parent',
    ])
    expect(workspaceSessions(data, 'D:/elsewhere', false, 0)).toEqual([])
  })

  it('supports drive/share scope and explicit All drives without prefix collisions', () => {
    const rows = [
      chat('drive', 'Z:/repo'),
      chat('share', '//server/share/repo'),
      chat('other', '//server/shared/repo'),
    ]
    const data = snapshot([], rows)
    expect(workspaceSessions(data, 'Z:', false, 0).map((s) => s.id)).toEqual(['drive'])
    expect(workspaceSessions(data, '//server/share', false, 0).map((s) => s.id)).toEqual(['share'])
    expect(workspaceSessions(data, null, true, 0)).toHaveLength(3)
    expect(workspaceSessions(data, null, false, 0)).toEqual([])
    expect(workspaceSessions(data, 'C:/absent', false, 0)).toEqual([])
  })

  it('deduplicates fresh recent records and excludes expired idle ancestors', () => {
    const data = snapshot(
      [group('C:/project', [chat('one', 'C:/project', 1), chat('old', 'C:/project', 1)])],
      [chat('one', 'C:/project', 110, 'working'), chat('live', 'C:/project', 1, 'waiting')],
    )
    const ignored = { ...chat('ignored', 'C:/project', 1, 'waiting'), ignored: true }
    data.lookupSessions = [ignored]
    expect(workspaceSessions(data, 'C:/project', false, 50)).toMatchObject([
      { id: 'one', lastActiveAt: 110, state: 'working' },
      { id: 'live' },
    ])
  })
})
