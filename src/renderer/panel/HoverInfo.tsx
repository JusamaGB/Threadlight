import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePanelRoom } from './room'
import styles from './Panel.module.css'

/** Cursor-relative information can use the card's width without taking over the pointer. */
const GAP = 18
const EDGE = 4
export interface HoverPoint {
  x: number
  y: number
}

export function HoverInfo({
  anchor,
  point,
  children,
  className = styles.tip,
  onDismiss,
}: {
  anchor: RefObject<HTMLElement | null>
  /** Local to the anchor, so opening the native window upwards does not move the target. */
  point: HoverPoint
  children: ReactNode
  className?: string
  onDismiss: () => void
}) {
  const box = useRef<HTMLSpanElement>(null)
  const { opensDown, extra, reserve } = usePanelRoom()
  const [position, setPosition] = useState<{ top: number; left: number; maxWidth: number } | null>(
    null,
  )
  useLayoutEffect(() => {
    const measure = () => {
      const element = box.current
      const target = anchor.current
      const card = target?.closest('[data-card]')?.getBoundingClientRect()
      if (!element || !target) return
      const at = target.getBoundingClientRect()
      const x = at.left + point.x
      const y = at.top + point.y
      const left = Math.max(EDGE, (card?.left ?? 0) + EDGE)
      const right = Math.min(window.innerWidth - EDGE, (card?.right ?? window.innerWidth) - EDGE)
      const maxWidth = Math.max(1, right - left)
      element.style.maxWidth = `${maxWidth}px`
      // Measure intrinsic content at the full cap, independent of the pointer's horizontal position.
      element.style.left = `${left}px`
      const { width, height } = element.getBoundingClientRect()
      const baseTop = card?.top ?? 0
      const baseBottom = card?.bottom ?? window.innerHeight
      const above = y - GAP - baseTop - EDGE
      const below = baseBottom - y - GAP - EDGE
      reserve(height <= above || height <= below ? 0 : height - (opensDown ? below : above))
      const top = opensDown ? baseTop : baseTop - extra
      const bottom = opensDown ? baseBottom + extra : baseBottom
      const roomBelow = bottom - y - GAP - EDGE
      const roomAbove = y - GAP - top - EDGE
      const belowPointer = height <= roomBelow || (height > roomAbove && roomBelow >= roomAbove)
      setPosition({
        left: Math.max(left, Math.min(x - width / 2, right - width)),
        top: Math.max(
          top + EDGE,
          Math.min(belowPointer ? y + GAP : y - GAP - height, bottom - height - EDGE),
        ),
        maxWidth,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [anchor, point, opensDown, extra, reserve, children])
  useEffect(() => {
    // Own this subscription: the anchor may also listen with the same dismissal callback.
    const dismiss = () => onDismiss()
    window.addEventListener('blur', dismiss)
    document.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('scroll', dismiss, true)
    }
  }, [onDismiss])
  const release = useRef(reserve)
  useEffect(() => {
    release.current = reserve
  }, [reserve])
  useEffect(() => () => release.current(0), [])
  return createPortal(
    <span
      ref={box}
      className={className}
      role="tooltip"
      style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
    >
      {children}
    </span>,
    document.body,
  )
}
