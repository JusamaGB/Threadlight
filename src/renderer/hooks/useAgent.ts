import { useEffect, useState } from 'react'

import { IDLE_AGENT, type AgentState } from '../../shared/agent'

/** The agent conversation, kept current. */
export function useAgent(): AgentState {
  const [state, setState] = useState<AgentState>(IDLE_AGENT)
  useEffect(() => {
    let live = true
    const receive = (next: AgentState) => {
      if (live) setState((previous) => (next.revision >= previous.revision ? next : previous))
    }
    const stop = window.threadlight.onAgent(receive)
    void window.threadlight.getAgent().then(receive)
    return () => {
      live = false
      stop()
    }
  }, [])
  return state
}
