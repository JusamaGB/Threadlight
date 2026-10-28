import { useCallback, useEffect, useRef, useState } from 'react'

import type { Snapshot } from '../../shared/types'
import { startArtifactCatalog } from './useArtifactCatalog'
import { ThreadReadReceipts } from '../../shared/threadReadReceipts'

const RECEIPTS_KEY = 'threadlight.thread-read-receipts.v1'
function loadReceipts() {
  try {
    return localStorage.getItem(RECEIPTS_KEY)
  } catch {
    return null
  }
}
function saveReceipts(receipts: ThreadReadReceipts) {
  try {
    localStorage.setItem(RECEIPTS_KEY, receipts.serialize())
  } catch {
    /* Memory still works if storage is unavailable. */
  }
}

const EMPTY: Snapshot = {
  sessions: [],
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
}

/** Recent sessions plus the workspace tree, from the main process. */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [receipts] = useState(() => new ThreadReadReceipts(loadReceipts()))
  const latest = useRef(EMPTY)
  const markThreadRead = useCallback(
    (id: string) => {
      if (!receipts.markRead(id)) return
      saveReceipts(receipts)
      setSnapshot(receipts.decorate(latest.current))
    },
    [receipts],
  )
  useEffect(() => {
    let current = true
    let received = false
    const accept = (s: Snapshot) => {
      latest.current = s
      if (receipts.observe(s)) saveReceipts(receipts)
      setSnapshot(receipts.decorate(s))
    }
    const unsubscribe = window.threadlight.onSnapshot((s) => {
      received = true
      if (current) accept(s)
    })
    void window.threadlight.getSnapshot().then((s) => {
      if (current && !received) accept(s)
    })
    const stopCatalog = startArtifactCatalog(() => latest.current)
    return () => {
      current = false
      unsubscribe()
      stopCatalog()
    }
  }, [receipts])
  return { snapshot, markThreadRead }
}
