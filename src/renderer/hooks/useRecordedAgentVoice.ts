import { useCallback, useEffect, useRef, useState } from 'react'

/** Recorded speech uses the same Agent conversation and delivery rules as typed messages. */
export function useRecordedAgentVoice(enabled: boolean) {
  const generation = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const close = useCallback(() => {
    generation.current++
  }, [])
  useEffect(() => close, [enabled, close])

  const send = useCallback(async (text: string) => {
    const mine = ++generation.current
    setError(null)
    setDraft(text)
    try {
      const result = await window.threadlight.agentSend(text)
      if (!result.ok) throw new Error(result.reason)
    } catch (cause) {
      if (mine === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  return { send, close, error: enabled ? error : null, draft }
}
