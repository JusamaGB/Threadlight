import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { TalkState } from '../shared/ipc'
import { FloatingDot } from './dot/Dot'
import { useSessions } from './hooks/useSessions'
import { useSettings } from './hooks/useSettings'
import { Panel } from './panel/Panel'
import './theme.css'

// Each window loads this page with ?view=… and renders only its own piece.
const view = new URLSearchParams(window.location.search).get('view') ?? 'dot'

function DotView() {
  const sessions = useSessions()
  const settings = useSettings()
  const [talk, setTalk] = useState<TalkState>('idle')
  useEffect(() => window.threadlight.onTalkState(setTalk), [])
  const [openMic, setOpenMic] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  useEffect(() => {
    let active = true
    let updated = false
    const offLive = window.threadlight.onOpenMicLive((live) => {
      updated = true
      setOpenMic(live)
      if (!live) setMicLevel(0)
    })
    const offLevel = window.threadlight.onOpenMicLevel(setMicLevel)
    void window.threadlight.getOpenMicIndicator().then((state) => {
      if (!active || updated) return
      setOpenMic(state.live)
      setMicLevel(state.level)
    })
    return () => {
      active = false
      offLive()
      offLevel()
    }
  }, [])
  return (
    <FloatingDot
      providers={settings?.enabledProviders}
      working={sessions.some((s) => s.state === 'working')}
      talk={talk}
      openOn={settings?.openOn ?? 'hover'}
      openMic={openMic}
      micLevel={micLevel}
    />
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(<StrictMode>{view === 'panel' ? <Panel /> : <DotView />}</StrictMode>)
