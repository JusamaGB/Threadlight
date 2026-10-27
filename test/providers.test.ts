import { describe, expect, it } from 'vitest'
import {
  combinedSnapshot,
  providerView,
  sessionProvider,
  workspaceFolder,
  workspaceKey,
  isWorkspaceRoot,
  workspaceInScope,
} from '../src/shared/providers'
import { parseSettings, validatePatch } from '../src/shared/settings'
import { findInSnapshot } from '../src/shared/snapshot'
import { matchThread } from '../src/shared/match'
import type { Provider, Session, Snapshot } from '../src/shared/types'

const folder = 'C:/synthetic/shared'

describe('workspace folder comparisons', () => {
  it.each([
    ['codex:Z:', 'claude:Z:\\General', true],
    ['claude:Z:/', 'codex:\\\\?\\z:\\General\\nested', true],
    ['Z:', 'codex:Z:/', true],
    ['Z:', 'codex:C:/General', false],
    ['Z:', 'codex:Z:relative', false],
    ['//server/team', 'codex:\\\\?\\UNC\\SERVER\\team\\project', true],
    ['//server/team', '//server/teammate/project', false],
    ['//server/team', '//other/team/project', false],
    ['/', '/home/project', true],
    ['/', '//server/share/project', false],
    ['Z:/General', 'codex:Z:/General', true],
    ['Z:/General', 'codex:Z:/General/nested', false],
    ['Z:/General', 'codex:Z:/General-other', false],
  ])('selects the correct scope %s -> %s: %s', (scope, path, expected) => {
    expect(workspaceInScope(path, scope)).toBe(expected)
  })

  it('recognizes drive/share roots without requiring a thread directly at the root', () => {
    expect(isWorkspaceRoot('codex:\\\\?\\Z:\\')).toBe(true)
    expect(isWorkspaceRoot('claude:\\\\server\\share')).toBe(true)
    expect(isWorkspaceRoot('Z:/General')).toBe(false)
  })
  it.each([
    ['claude:C:\\synthetic\\shared', 'codex:\\\\?\\C:\\synthetic\\shared'],
    ['claude:c:/SYNTHETIC/shared/', 'codex://?/C:/synthetic/shared'],
    ['claude:\\\\server\\share\\project', 'codex:\\\\?\\UNC\\server\\share\\project'],
    ['claude://SERVER/share/project/', 'codex://?/unc/server/share/project'],
  ])('matches equivalent folders: %s and %s', (claude, codex) => {
    expect(workspaceFolder(claude)).toBe(workspaceFolder(codex))
  })

  it.each([
    ['claude:C:/synthetic/shared', 'codex:\\\\?\\D:\\synthetic\\shared'],
    ['claude:C:/synthetic/shared', 'codex:\\\\?\\C:\\synthetic\\shared-other'],
    ['claude://server/share/project', 'codex://?/UNC/server/other/project'],
  ])('keeps different folders distinct: %s and %s', (claude, codex) => {
    expect(workspaceFolder(claude)).not.toBe(workspaceFolder(codex))
  })
})

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
  it('combines completion order and reserves limited places for active threads', () => {
    const before = structuredClone(sources)
    const both = combinedSnapshot(['claude', 'codex'], sources, 3)
    expect(both.sessions.map((s) => s.id)).toEqual(['codex:shared-id', 'codex:working', 'working'])
    expect(both.sessions.map((s) => s.provider)).toEqual(['codex', 'codex', 'claude'])
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
    expect(both.sessions.map((s) => s.id)).toEqual(['codex:shared-id'])
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
