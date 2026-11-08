import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentClient } from '../lib/agentClient'

/** Recorded speech uses the same Agent conversation and delivery rules as typed messages. */
export function useRecordedAgentVoice(enabled: boolean, client?: AgentClient) {
  const api = client ?? window.threadlight
  const generation = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const close = useCallback(() => {
    generation.current++
  }, [])
  useEffect(() => close, [enabled, close, api])

  const send = useCallback(
    async (text: string) => {
      const mine = ++generation.current
      setError(null)
      setDraft(text)
      try {
        const result = await api.agentSend(text)
        if (!result.ok) throw new Error(result.reason)
      } catch (cause) {
        if (mine === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [api],
  )

  return { send, close, error: enabled ? error : null, draft }
}
