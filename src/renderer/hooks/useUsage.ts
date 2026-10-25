import { useEffect, useState } from 'react'

import type { Usage } from '../../shared/usage'

/** How often an open panel asks again; the main side checks only once a reading is old. */
const ASK_EVERY_MS = 60_000

/** The plan's usage limits as last read, kept up to date while the panel is open. */
export function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null)
  useEffect(() => {
    let live = true
    const ask = () =>
      void window.threadlight.getUsage().then((found) => live && found && setUsage(found))
    ask()
    const timer = setInterval(ask, ASK_EVERY_MS)
    const offOpened = window.threadlight.onPanelOpened(ask)
    const offUsage = window.threadlight.onUsage(setUsage)
    return () => {
      live = false
      clearInterval(timer)
      offOpened()
      offUsage()
    }
  }, [])
  return usage
}
