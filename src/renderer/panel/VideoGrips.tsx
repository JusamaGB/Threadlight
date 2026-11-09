import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BrowserState, VideoGripGesture } from '../../shared/browser'
import styles from './BrowserView.module.css'

export function VideoGrips({ state, card }: { state: BrowserState; card: HTMLElement }) {
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      setAlt(event.altKey)
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        void window.threadlight.browserRequest({ action: 'fullscreen', browserId: state.id })
      }
    }
    const blur = () => setAlt(false)
    const pointer = (event: PointerEvent) => setAlt(event.altKey)
    window.addEventListener('pointermove', pointer)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pointermove', pointer)
      if (drag.current) {
        drag.current = null
        void window.threadlight
          .browserRequest({ action: 'video-grip', browserId: state.id, gesture: { phase: 'end' } })
          .catch(() => {})
      }
    }
  }, [state.id])
  const send = (gesture: VideoGripGesture) => {
    void window.threadlight
      .browserRequest({ action: 'video-grip', browserId: state.id, gesture })
      .catch(() => {})
  }
  const begin = (edge: 'left' | 'right' | 'crop') => {
    const { x, y, width, height } = card.getBoundingClientRect()
    send({ phase: 'begin', edge, card: { x, y, width, height } })
  }
  const finish = () => {
    if (!drag.current) return
    drag.current = null
    send({ phase: 'end' })
  }
  return createPortal(
    <div
      data-video-grips=""
      data-video-sized={state.videoSized || undefined}
      className={styles.grips}
    >
      {(['left', 'crop', 'right'] as const).map((edge) => {
        const label =
          edge === 'crop' ? 'Alt-drag to crop video height' : `Resize video from bottom ${edge}`
        return (
          <button
            key={edge}
            type="button"
            aria-label={label}
            title={label}
            data-edge={edge}
            data-alt={alt || undefined}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current || (edge === 'crop' && !event.altKey)) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { id: event.pointerId, x: event.screenX, y: event.screenY }
              begin(edge)
            }}
            onPointerMove={(event) => {
              const start = drag.current
              if (start?.id === event.pointerId)
                send({ phase: 'move', dx: event.screenX - start.x, dy: event.screenY - start.y })
            }}
            onPointerUp={(event) => {
              const start = drag.current
              if (start?.id !== event.pointerId) return
              send({ phase: 'move', dx: event.screenX - start.x, dy: event.screenY - start.y })
              finish()
            }}
            onLostPointerCapture={finish}
            onPointerCancel={finish}
            onKeyDown={(event) => {
              const dx = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
              const dy = event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0
              if ((!dx && !dy) || (edge === 'crop' && dx)) return
              event.preventDefault()
              event.stopPropagation()
              begin(edge)
              send({ phase: 'move', dx, dy })
              send({ phase: 'end' })
            }}
          />
        )
      })}
    </div>,
    card.parentElement!,
  )
}
