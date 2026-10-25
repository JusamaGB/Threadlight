import { describe, expect, it } from 'vitest'

import { briefing, readableFolders } from '../src/main/agent/briefing'
import type { Session, Snapshot } from '../src/shared/types'

const NOW = Date.parse('2026-01-01T12:00:00Z')
const thread = (over: Partial<Session>): Session =>
  ({
    id: 'id',
    title: 'Docs site',
    state: 'idle',
    cwd: 'Z:\\work',
    lastActiveAt: NOW - 5 * 60_000,
    currentStep: null,
    attention: null,
    git: null,
    ...over,
  }) as Session
const snapshot = (sessions: Session[]): Snapshot => ({
  sessions,
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
})

describe('briefing', () => {
  it('lists each thread with its state, folder and git numbers', () => {
    const git = {
      root: 'Z:/work',
      branch: 'main',
      files: 1,
      newFiles: 1,
      added: 847,
      removed: 0,
      ahead: 0,
      behind: 0,
      worktrees: ['Z:/work'],
    }
    const text = briefing(snapshot([thread({ git })]), NOW)
    expect(text).toContain(
      '- "Docs site" · idle · folder Z:\\work · git Z:/work on main, 1 files uncommitted (1 new), +847 −0 · active 5m ago',
    )
    expect(text.startsWith('<threadlight-briefing>')).toBe(true)
  })

  it('names the folders it may look in: each thread’s folder and repository', () => {
    const git = { root: 'Z:/work/api' } as Session['git']
    expect(
      readableFolders(snapshot([thread({ git }), thread({ id: 'b', cwd: 'Z:\\other' })])),
    ).toEqual(['Z:\\work', 'Z:/work/api', 'Z:\\other'])
  })
})
