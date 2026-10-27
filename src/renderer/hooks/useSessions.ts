import { useEffect, useState } from 'react'

import type { Session } from '../../shared/types'

/** The live session list from the main process. */
export function useSessions(): Session[] {
  const [sessions, setSessions] = useState<Session[]>([])
  useEffect(() => {
    let current = true
    void window.threadlight.getSessions().then((list) => current && setSessions(list))
    const unsubscribe = window.threadlight.onSessions(setSessions)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return sessions
}
