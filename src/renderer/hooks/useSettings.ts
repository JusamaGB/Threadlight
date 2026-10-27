import { useEffect, useState } from 'react'

import type { Settings } from '../../shared/settings'

/** Current settings from the main process, or null until they have loaded. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let current = true
    void window.threadlight.getSettings().then((s) => current && setSettings(s))
    const unsubscribe = window.threadlight.onSettings(setSettings)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return settings
}
