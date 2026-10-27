import { useEffect, useState } from 'react'

import type { RelayStatus } from '../../shared/types'

/** Relay statuses from the main process, keyed by session id. */
export function useRelays(): Map<string, RelayStatus> {
  const [relays, setRelays] = useState(() => new Map<string, RelayStatus>())
  useEffect(() => {
    const apply = (list: RelayStatus[]) => setRelays(new Map(list.map((s) => [s.sessionId, s])))
    let current = true
    void window.threadlight.getRelays().then((list) => current && apply(list))
    const unsubscribe = window.threadlight.onRelays(apply)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return relays
}
