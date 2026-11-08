import { useEffect, useState } from 'react'

import type { Settings } from '../../shared/settings'

/** Current settings from the main process, or null until they have loaded. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let current = true
    let generation = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const accept = (settings: Settings) => {
      if (!current) return
      generation++
      clearTimeout(retry)
      setSettings(settings)
    }
    const ask = () => {
      clearTimeout(retry)
      const requested = generation
      void window.threadlight
        .getSettings()
        .then((settings) => {
          if (current && generation === requested) accept(settings)
        })
        .catch(() => {
          // Startup ordering prevents missing handlers; recover transient IPC failures too.
          if (current && generation === requested) retry = setTimeout(ask, 2000)
        })
    }
    const unsubscribe = window.threadlight.onSettings(accept)
    const offOpened = window.threadlight.onPanelOpened(ask)
    ask()
    return () => {
      current = false
      clearTimeout(retry)
      unsubscribe()
      offOpened()
    }
  }, [])
  return settings
}
