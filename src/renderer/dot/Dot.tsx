import { useRef, type PointerEvent } from 'react'

import { en } from '../i18n/en'
import styles from './Dot.module.css'

interface StatusDotProps {
  /** True while any session is working: the dot turns red and pulses. */
  working: boolean
  onClick?: () => void
  title?: string
}

/** The dot itself. Used on its own window and again in the panel header. */
export function StatusDot({ working, onClick, title }: StatusDotProps) {
  return (
    <div className={styles.frame} onClick={onClick} title={title}>
      <div
        className={working ? `${styles.dot} ${styles.working}` : styles.dot}
        role="status"
        aria-label={working ? en.dot.working : en.dot.idle}
      />
    </div>
  )
}

const DRAG_THRESHOLD = 3

/** The floating dot window: click opens the panel, drag moves it. */
export function FloatingDot({ working }: { working: boolean }) {
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
      <StatusDot working={working} />
    </div>
  )
}
