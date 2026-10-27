import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { TalkState } from '../shared/ipc'
import { IDLE_MOTION, type MotionSnapshot } from '../shared/motion'
import { FloatingDot } from './dot/Dot'
import { useSessions } from './hooks/useSessions'
import { useSettings } from './hooks/useSettings'
import { Panel } from './panel/Panel'
import { AttentionView, useAttentionMotion } from './motion/AttentionView'
import './theme.css'

// Each window loads this page with ?view=… and renders only its own piece.
const view = new URLSearchParams(window.location.search).get('view') ?? 'dot'

function DotView() {
  const attention = useAttentionMotion()
  const sessions = useSessions()
  const settings = useSettings()
  const [talk, setTalk] = useState<TalkState>('idle')
  useEffect(() => window.threadlight.onTalkState(setTalk), [])
  const [openMic, setOpenMic] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [motion, setMotion] = useState<MotionSnapshot>(IDLE_MOTION)
  useEffect(() => {
    let active = true
    let updated = false
    const off = window.threadlight.onMotion((value) => {
      updated = true
      setMotion(value)
    })
    void window.threadlight.getMotion().then((value) => {
      if (active && !updated) setMotion(value)
    })
    return () => {
      active = false
      off()
    }
  }, [])
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
    <div style={{ opacity: attention.active ? 0 : 1 }}>
      <FloatingDot
        providers={settings?.enabledProviders}
        working={sessions.some((s) => s.state === 'working')}
        talk={talk}
        openOn={settings?.openOn ?? 'hover'}
        openMic={openMic}
        micLevel={micLevel}
        motion={motion}
      />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    {view === 'panel' ? <Panel /> : view === 'attention' ? <AttentionView /> : <DotView />}
  </StrictMode>,
)
