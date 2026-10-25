import { useEffect, useState } from 'react'

import { IDLE_AGENT, type AgentState } from '../../shared/agent'

/** The agent conversation, kept current. */
export function useAgent(): AgentState {
  const [state, setState] = useState<AgentState>(IDLE_AGENT)
  useEffect(() => {
    let live = true
    void window.threadlight.getAgent().then((first) => live && setState(first))
    const stop = window.threadlight.onAgent(setState)
    return () => {
      live = false
      stop()
    }
  }, [])
  return state
}
