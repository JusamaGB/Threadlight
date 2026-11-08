import { useEffect, useState } from 'react'

import { IDLE_AGENT, type AgentState } from '../../shared/agent'
import type { AgentClient } from '../lib/agentClient'

/** The agent conversation, kept current. */
export function useAgent(client?: AgentClient): AgentState {
  const api = client ?? window.threadlight
  const [state, setState] = useState<AgentState>(IDLE_AGENT)
  useEffect(() => {
    let live = true
    let revision = -1
    const receive = (next: AgentState) => {
      if (live && next.revision >= revision) {
        revision = next.revision
        setState(next)
      }
    }
    const stop = api.onAgent(receive)
    void api.getAgent().then(receive)
    return () => {
      live = false
      stop()
    }
  }, [api])
  return state
}
