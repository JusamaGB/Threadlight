import type { Provider, Session, Snapshot, TreeView } from './types'
import { compareSessionOrder, recentSessions } from './sessionOrder'

export const PROVIDERS: Provider[] = ['claude', 'codex']
export const DEFAULT_ENABLED_PROVIDERS: Provider[] = ['claude']
export const providerName = (provider: Provider) => (provider === 'claude' ? 'Claude' : 'Codex')
export const sessionProvider = (id: string): Provider =>
  id.startsWith('codex:') ? 'codex' : 'claude'
export const workspaceKey = (provider: Provider, id: string) => `${provider}:${id}`

/** Compare folders across apps without changing their provider-owned workspace IDs. */
export const workspaceFolder = (id: string) =>
  id
    .replace(/^(claude|codex):/, '')
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\/UNC\//i, '//')
    .replace(/^\/\/\?\/(?=[a-z]:\/)/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()

/** Drive/share roots select their known workspaces; ordinary folders keep exact scope. */
export function isWorkspaceRoot(id: string): boolean {
  const key = workspaceFolder(id)
  return (
    /^[a-z]:$/.test(key) ||
    /^\/\/[^/]+\/[^/]+$/.test(key) ||
    id.replace(/^(claude|codex):/, '') === '/'
  )
}

export function workspaceInScope(id: string, selected: string): boolean {
  const folder = workspaceFolder(id)
  const root = workspaceFolder(selected)
  if (folder === root) return true
  if (!isWorkspaceRoot(selected)) return false
  if (!root) return folder.startsWith('/') && !folder.startsWith('//')
  return folder.startsWith(`${root}/`)
}

/** Workspace folders can be identical across apps; their tree state must stay separate. */
export function providerView(enabled: Provider[], provider: Provider, view: TreeView): TreeView {
  if (enabled.length < 2) return view
  const prefix = `${provider}:`
  const own = (ids: string[]) =>
    ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length))
  return {
    expanded: view.expanded === null ? null : own(view.expanded),
    showAll: own(view.showAll),
  }
}

/** The presentation layer combines snapshots; each adapter still owns its chats and actions. */
export function combinedSnapshot(
  enabled: Provider[],
  snapshots: Record<Provider, Snapshot>,
  max: number,
): Snapshot {
  const providers = PROVIDERS.filter((provider) => enabled.includes(provider))
  if (providers.length === 1)
    return { ...snapshots[providers[0]!], provider: providers[0], providers }
  const sessions: Session[] = providers.flatMap((provider) =>
    snapshots[provider].sessions.map((session) => ({ ...session, provider })),
  )
  sessions.sort(compareSessionOrder)
  const current = [...providers].sort(
    (a, b) =>
      Math.max(0, ...snapshots[b].sessions.map((s) => s.lastActiveAt)) -
      Math.max(0, ...snapshots[a].sessions.map((s) => s.lastActiveAt)),
  )[0]
  const currentWorkspace = current && snapshots[current].currentWorkspace
  return {
    providers,
    codexUsage: providers.includes('codex') ? snapshots.codex.codexUsage : undefined,
    sessions: recentSessions(sessions, max),
    lookupSessions: sessions,
    workspaces: providers.flatMap((provider) =>
      snapshots[provider].workspaces.map((workspace) => ({
        ...workspace,
        id: workspaceKey(provider, workspace.id),
        name: `${providerName(provider)} · ${workspace.name}`,
      })),
    ),
    allWorkspaces: providers.flatMap((provider) =>
      snapshots[provider].allWorkspaces.map((workspace) => ({
        id: workspaceKey(provider, workspace.id),
        name: `${providerName(provider)} · ${workspace.name}`,
      })),
    ),
    currentWorkspace: current && currentWorkspace ? workspaceKey(current, currentWorkspace) : null,
    currentThreadId: current ? snapshots[current].currentThreadId : null,
  }
}
