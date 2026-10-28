import { useCallback, useSyncExternalStore } from 'react'
import type { Snapshot, ThreadNode } from '../../shared/types'
import { ArtifactCatalog } from '../../shared/artifactCatalog'

export const artifactCatalog = new ArtifactCatalog((id) => window.threadlight.artifacts(id, 'list'))

export function useArtifactCatalog(id: string) {
  return useSyncExternalStore(
    useCallback((listener) => artifactCatalog.subscribe(id, listener), [id]),
    useCallback(() => artifactCatalog.get(id), [id]),
  )
}

/** One refresh loop for the panel, including rows in views that are not currently mounted. */
export function startArtifactCatalog(snapshot: () => Snapshot): () => void {
  const changed = window.threadlight.onArtifactsChanged((change) =>
    artifactCatalog.accept(change.threadId, { ok: true, items: change.items }),
  )
  const tick = () => {
    const current = snapshot()
    const ids = new Set(current.sessions.map((session) => session.id))
    const collect = (nodes: ThreadNode[]) => {
      for (const node of nodes) {
        if (ids.size >= 300) return
        ids.add(node.session.id)
        collect(node.children)
      }
    }
    for (const workspace of current.workspaces) collect(workspace.threads)
    artifactCatalog.tick([...ids])
  }
  tick()
  const timer = setInterval(tick, 3000)
  return () => {
    clearInterval(timer)
    changed()
  }
}
