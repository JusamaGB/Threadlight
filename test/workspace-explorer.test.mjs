import { describe, expect, it } from 'vitest'
import { workspaceExplorer, searchWorkspaces } from '../src/renderer/lib/workspaceExplorer'

describe('known workspace folder browser', () => {
  it('groups drive folders, deduplicates Windows device paths and retains the adapter selection ID', () => {
    const shared = { id: 'codex:\\\\?\\c:\\Projects\\Shared', name: 'Shared' }
    const { folders, roots } = workspaceExplorer([
      { id: 'claude:C:/Projects/Shared/', name: 'Shared' },
      shared,
      { id: 'claude:C:/Projects/Shared/lib', name: 'lib' },
      { id: 'codex:Z:/Other', name: 'Other' },
    ])
    expect(roots.map((root) => [root.path, root.count])).toEqual([
      ['C:', 2],
      ['Z:', 1],
    ])
    expect(folders.get('c:/projects').children.map((folder) => folder.name)).toEqual(['Shared'])
    expect(folders.get('c:/projects/shared').workspace).toEqual(shared)
    expect(folders.get('c:/projects/shared/lib').parent).toBe('c:/projects/shared')
    expect(folders.get('c:/projects').workspace).toBeUndefined()
  })

  it('treats UNC shares as separate locations, including root workspaces', () => {
    const { folders, roots } = workspaceExplorer([
      { id: 'claude:\\\\server\\team', name: 'team' },
      { id: 'codex:\\\\?\\UNC\\SERVER\\team\\App', name: 'App' },
      { id: 'claude:\\\\server\\other\\App', name: 'App' },
    ])
    expect(roots.map((root) => [root.key, root.count])).toEqual([
      ['//server/other', 1],
      ['//server/team', 2],
    ])
    expect(folders.get('//server/team').workspace.id).toBe('claude:\\\\server\\team')
    expect(folders.get('//server/team/app').parent).toBe('//server/team')
  })

  it('searches nested names and paths across all drives, with disambiguating paths and no duplicate folders', () => {
    const { folders } = workspaceExplorer([
      { id: 'claude:C:/Projects/shared', name: 'shared' },
      { id: 'codex:C:/Archive/shared', name: 'shared' },
      { id: 'codex:Z:/Projects/shared', name: 'shared' },
      { id: 'codex:C:/Projects/shared/lib', name: 'lib' },
    ])
    const entries = [...folders.values()]
    expect(searchWorkspaces(entries, 'SHARED').map((folder) => folder.path)).toEqual([
      'C:/Archive/shared',
      'C:/Projects/shared',
      'Z:/Projects/shared',
      'C:/Projects/shared/lib',
    ])
    expect(searchWorkspaces(entries, 'Projects\\shared lib').map((folder) => folder.path)).toEqual([
      'C:/Projects/shared/lib',
    ])
    expect(searchWorkspaces(entries, 'missing')).toEqual([])
  })

  it('keeps POSIX roots navigable without confusing them with the all-drives view', () => {
    const { folders, roots } = workspaceExplorer([
      { id: '/home/dev/app', name: 'app' },
      { id: '/opt/app', name: 'app' },
    ])
    expect(roots.map((root) => root.key)).toEqual(['/'])
    expect(folders.get('/home').parent).toBe('/')
    expect(folders.get('/').parent).toBe('')
  })
})
