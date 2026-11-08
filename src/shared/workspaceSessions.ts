import type { Session, Snapshot, ThreadNode } from './types'
import { workspaceInScope } from './providers'
import { compareSessionOrder } from './sessionOrder'

/** Use tree ownership for side threads, and cwd for recent chats not yet in a tree. */
export function workspaceSessions(
  snapshot: Snapshot,
  scope: string | null,
  allDrives: boolean,
  cutoff: number,
): Session[] {
  const selected = new Map<string, Session>()
  const owned = new Map<string, boolean>()
  const inScope = (folder: string) => allDrives || (!!scope && workspaceInScope(folder, scope))
  const add = (session: Session) => {
    if (session.lastActiveAt >= cutoff || (session.state !== 'idle' && !session.ignored))
      selected.set(session.id, session)
    else selected.delete(session.id)
  }
  const visit = (nodes: ThreadNode[], include: boolean) => {
    for (const node of nodes) {
      owned.set(node.session.id, include)
      if (include) add(node.session)
      visit(node.children, include)
    }
  }
  for (const workspace of snapshot.workspaces) visit(workspace.threads, inScope(workspace.id))
  for (const session of [...(snapshot.lookupSessions ?? []), ...snapshot.sessions]) {
    if (owned.get(session.id) ?? inScope(session.cwd)) add(session)
  }
  return [...selected.values()].sort(compareSessionOrder)
}
