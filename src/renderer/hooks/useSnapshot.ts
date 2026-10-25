import { useEffect, useState } from 'react'

import type { Snapshot } from '../../shared/types'

const EMPTY: Snapshot = { sessions: [], workspaces: [], allWorkspaces: [], currentWorkspace: null }

/** Recent sessions plus the workspace tree, from the main process. */
export function useSnapshot(): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  useEffect(() => {
    let current = true
    void window.threadlight.getSnapshot().then((s) => current && setSnapshot(s))
    const unsubscribe = window.threadlight.onSnapshot(setSnapshot)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return snapshot
}
