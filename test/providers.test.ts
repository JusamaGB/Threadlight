import { describe, expect, it } from 'vitest'
import {
  combinedSnapshot,
  providerView,
  sessionProvider,
  workspaceKey,
} from '../src/shared/providers'
import { parseSettings, validatePatch } from '../src/shared/settings'
import { findInSnapshot } from '../src/shared/snapshot'
import { matchThread } from '../src/shared/match'
import type { Provider, Session, Snapshot } from '../src/shared/types'

const folder = 'C:/synthetic/shared'
function snapshot(
  provider: Provider,
  states: { id: string; state: Session['state']; at: number }[],
): Snapshot {
  const sessions = states.map(
    ({ id, state, at }) =>
      ({
        id: provider === 'codex' ? `codex:${id}` : id,
        provider,
        state,
        lastActiveAt: at,
        title: 'Same chat name',
        cwd: folder,
      }) as Session,
  )
  return {
    sessions,
    workspaces: [
      {
        id: folder,
        name: 'shared',
        threadCount: sessions.length,
        activeCount: 1,
        anyWorking: true,
        threads: sessions.map((session) => ({ session, children: [] })),
        hiddenCount: 0,
        worktrees: 1,
      },
    ],
    allWorkspaces: [{ id: folder, name: 'shared' }],
    currentWorkspace: folder,
    currentThreadId: sessions[0]?.id ?? null,
  }
}

describe('provider settings', () => {
  it('migrates the exclusive selector and preserves explicit both/off choices', () => {
    expect(parseSettings({ provider: 'codex' }).enabledProviders).toEqual(['codex'])
    expect(parseSettings({ provider: 'claude' }).enabledProviders).toEqual(['claude'])
    expect(parseSettings({ provider: 'codex', enabledProviders: [] }).enabledProviders).toEqual([])
    expect(
      parseSettings({ provider: 'claude', enabledProviders: ['codex', 'claude'] }).enabledProviders,
    ).toEqual(['claude', 'codex'])
    expect(validatePatch({ enabledProviders: ['claude', 'claude'] }).ok).toBe(false)
    expect(validatePatch({ enabledProviders: ['other'] }).ok).toBe(false)
    expect(validatePatch({ enabledProviders: [] })).toEqual({
      ok: true,
      patch: { enabledProviders: [] },
    })
    expect(validatePatch({ maxSessions: 12 })).toEqual({ ok: true, patch: { maxSessions: 12 } })
  })
  it('keeps all three workspace selections independent', () => {
    expect(
      parseSettings({
        focusWorkspace: 'claude-folder',
        codexFocusWorkspace: 'codex-folder',
        combinedFocusWorkspace: 'codex:combined-folder',
      }),
    ).toMatchObject({
      focusWorkspace: 'claude-folder',
      codexFocusWorkspace: 'codex-folder',
      combinedFocusWorkspace: 'codex:combined-folder',
    })
  })
})

describe('combined provider snapshots', () => {
  const sources = {
    claude: snapshot('claude', [
      { id: 'shared-id', state: 'idle', at: 100 },
      { id: 'working', state: 'working', at: 10 },
    ]),
    codex: snapshot('codex', [
      { id: 'shared-id', state: 'waiting', at: 200 },
      { id: 'working', state: 'working', at: 20 },
    ]),
  }
  it('sorts both sources by state then recency and applies one total recent-list limit', () => {
    const before = structuredClone(sources)
    const both = combinedSnapshot(['claude', 'codex'], sources, 3)
    expect(both.sessions.map((s) => s.id)).toEqual(['codex:working', 'working', 'codex:shared-id'])
    expect(both.sessions.map((s) => s.provider)).toEqual(['codex', 'claude', 'codex'])
    expect(sources).toEqual(before)
    expect(both.currentWorkspace).toBe(`codex:${folder}`)
    expect(findInSnapshot(both, 'shared-id')?.provider).toBe('claude')
    expect(findInSnapshot(both, 'codex:shared-id')?.provider).toBe('codex')
  })
  it('keeps same-folder workspaces and expansion requests separate', () => {
    const both = combinedSnapshot(['claude', 'codex'], sources, 10)
    expect(both.workspaces.map((w) => [w.id, w.name])).toEqual([
      [`claude:${folder}`, 'Claude · shared'],
      [`codex:${folder}`, 'Codex · shared'],
    ])
    const view = {
      expanded: [workspaceKey('codex', folder)],
      showAll: [workspaceKey('claude', folder)],
    }
    expect(providerView(['claude', 'codex'], 'claude', view)).toEqual({
      expanded: [],
      showAll: [folder],
    })
    expect(providerView(['claude', 'codex'], 'codex', view)).toEqual({
      expanded: [folder],
      showAll: [],
    })
    expect(providerView(['claude', 'codex'], 'codex', { expanded: null, showAll: [] })).toEqual({
      expanded: null,
      showAll: [],
    })
  })
  it('keeps the composer target resolvable when another source pushes its row below the list limit', () => {
    const both = combinedSnapshot(
      ['claude', 'codex'],
      {
        claude: { ...sources.claude, workspaces: [] },
        codex: { ...sources.codex, workspaces: [] },
      },
      1,
    )
    expect(both.sessions.map((s) => s.id)).toEqual(['codex:working'])
    expect(findInSnapshot(both, 'shared-id')?.id).toBe('shared-id')
    const single = combinedSnapshot(['codex'], sources, 1)
    expect(findInSnapshot(single, 'shared-id')).toBeUndefined()
  })
  it('retains single-provider workspace ids and excludes disabled chats even from cached snapshots', () => {
    const single = combinedSnapshot(['codex'], sources, 10)
    expect(single.sessions).toEqual(sources.codex.sessions)
    expect(single.workspaces[0]?.id).toBe(folder)
    expect(single.providers).toEqual(['codex'])
    expect(findInSnapshot(single, 'shared-id')).toBeUndefined()
    const off = combinedSnapshot([], sources, 10)
    expect(off).toMatchObject({
      providers: [],
      sessions: [],
      workspaces: [],
      allWorkspaces: [],
      currentWorkspace: null,
      currentThreadId: null,
    })
  })
  it('keeps ambiguous voice names unresolved across providers', () => {
    const both = combinedSnapshot(['claude', 'codex'], sources, 10)
    expect(matchThread('Same chat name', both.sessions)).toBeNull()
    expect(sessionProvider('shared-id')).toBe('claude')
    expect(sessionProvider('codex:shared-id')).toBe('codex')
  })
})
