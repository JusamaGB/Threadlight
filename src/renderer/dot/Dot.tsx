import { useRef, type PointerEvent } from 'react'

import type { TalkState } from '../../shared/ipc'
import { en } from '../i18n/en'
import styles from './Dot.module.css'

interface StatusDotProps {
  /** True while any session is working: the dot turns red and pulses. */
  working: boolean
  /** While the talk hotkey records or transcribes, the dot shows that instead (blue). */
  talk?: TalkState
  onClick?: () => void
  title?: string
}

/** The dot itself. Used on its own window and again in the panel header. */
export function StatusDot({ working, talk = 'idle', onClick, title }: StatusDotProps) {
  const look = talk !== 'idle' ? styles[talk] : working ? styles.working : ''
  const label =
    talk === 'listening'
      ? en.dot.listening
      : talk === 'transcribing'
        ? en.dot.transcribing
        : working
          ? en.dot.working
          : en.dot.idle
  return (
    <div className={styles.frame} onClick={onClick} title={title}>
      <div className={`${styles.dot} ${look}`} role="status" aria-label={label} />
    </div>
  )
}

const DRAG_THRESHOLD = 3

/** The floating dot window: click opens the panel, drag moves it. */
export function FloatingDot({ working, talk }: { working: boolean; talk: TalkState }) {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.screenX, y: event.screenY, moved: false }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    const dx = event.screenX - start.x
    const dy = event.screenY - start.y
    if (!start.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    start.moved = true
    window.threadlight.dotDrag(dx, dy)
  }
  const up = () => {
    const start = drag.current
    drag.current = null
    if (!start) return
    if (start.moved) window.threadlight.dotDragEnd()
    else window.threadlight.dotClick()
  }

  return (
    <div className={styles.floating} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <StatusDot working={working} talk={talk} />
    </div>
  )
}
