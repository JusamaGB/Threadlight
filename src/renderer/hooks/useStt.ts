import { useEffect, useState } from 'react'

import type { SttStatus } from '../../shared/stt'

/** The speech model's status: missing, downloading, loading, ready or error. */
export function useStt(): SttStatus {
  const [status, setStatus] = useState<SttStatus>({ state: 'loading' })
  useEffect(() => {
    let current = true
    void window.threadlight.getStt().then((s) => current && setStatus(s))
    const unsubscribe = window.threadlight.onStt(setStatus)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return status
}
