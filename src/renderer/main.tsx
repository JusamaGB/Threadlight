import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { TalkState } from '../shared/ipc'
import { FloatingDot } from './dot/Dot'
import { useSessions } from './hooks/useSessions'
import { Panel } from './panel/Panel'
import './theme.css'

// Each window loads this page with ?view=… and renders only its own piece.
const view = new URLSearchParams(window.location.search).get('view') ?? 'dot'

function DotView() {
  const sessions = useSessions()
  const [talk, setTalk] = useState<TalkState>('idle')
  useEffect(() => window.threadlight.onTalkState(setTalk), [])
  return <FloatingDot working={sessions.some((s) => s.state === 'working')} talk={talk} />
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(<StrictMode>{view === 'panel' ? <Panel /> : <DotView />}</StrictMode>)
