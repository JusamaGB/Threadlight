import type { Session, Snapshot, ThreadNode } from './types'

/** Finds a session in the recent list or anywhere in an open workspace's tree. */
export function findInSnapshot(snapshot: Snapshot, id: string): Session | undefined {
  const recent = snapshot.sessions.find((s) => s.id === id)
  if (recent) return recent
  const search = (nodes: ThreadNode[]): Session | undefined => {
    for (const node of nodes) {
      if (node.session.id === id) return node.session
      const found = search(node.children)
      if (found) return found
    }
    return undefined
  }
  for (const workspace of snapshot.workspaces) {
    const found = search(workspace.threads)
    if (found) return found
  }
  return undefined
}
