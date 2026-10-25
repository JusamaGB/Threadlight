import { useRef, type PointerEvent } from 'react'

const DRAG_THRESHOLD = 3

/**
 * Pointer handlers that move the dot (and the open panel with it). `isDragging` lets the panel
 * ignore the pointer briefly slipping outside while its window catches up.
 */
export function useDotDrag() {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // Only the bare background drags; text and the dot keep their own clicks.
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.screenX, y: event.screenY, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current
    if (!start) return
    const dx = event.screenX - start.x
    const dy = event.screenY - start.y
    if (!start.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    start.moved = true
    window.threadlight.dotDrag(dx, dy)
  }
  const onPointerUp = () => {
    const start = drag.current
    drag.current = null
    if (start?.moved) window.threadlight.dotDragEnd()
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: onPointerUp,
    },
    isDragging: () => drag.current !== null,
  }
}
