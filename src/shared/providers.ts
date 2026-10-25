import type { Provider, Session, Snapshot, TreeView } from './types'

export const PROVIDERS: Provider[] = ['claude', 'codex']
export const DEFAULT_ENABLED_PROVIDERS: Provider[] = ['claude']
export const providerName = (provider: Provider) => (provider === 'claude' ? 'Claude' : 'Codex')
export const sessionProvider = (id: string): Provider =>
  id.startsWith('codex:') ? 'codex' : 'claude'
export const workspaceKey = (provider: Provider, id: string) => `${provider}:${id}`

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
  const order = { working: 0, waiting: 1, idle: 2 }
  const sessions: Session[] = providers.flatMap((provider) =>
    snapshots[provider].sessions.map((session) => ({ ...session, provider })),
  )
  sessions.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      b.lastActiveAt - a.lastActiveAt ||
      a.id.localeCompare(b.id),
  )
  const current = [...providers].sort(
    (a, b) =>
      Math.max(0, ...snapshots[b].sessions.map((s) => s.lastActiveAt)) -
      Math.max(0, ...snapshots[a].sessions.map((s) => s.lastActiveAt)),
  )[0]
  const currentWorkspace = current && snapshots[current].currentWorkspace
  return {
    providers,
    codexUsage: providers.includes('codex') ? snapshots.codex.codexUsage : undefined,
    sessions: sessions.slice(0, max),
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
