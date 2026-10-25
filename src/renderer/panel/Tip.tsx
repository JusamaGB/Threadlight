import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import styles from './Panel.module.css'

const HOVER_DELAY = 1000
/** Keep the bubble clear of the cursor, including its visible arrow. */
const GAP = 18
const EDGE = 4
type Point = { x: number; y: number }

interface TipProps extends HTMLAttributes<HTMLElement> {
  as?: 'span' | 'button'
  /** What the tip says; shown while the pointer is over the anchor. */
  text: string
  /** The anchor: what is hovered. */
  children: ReactNode
  className?: string
  onClick?: (event: React.MouseEvent) => void
}

/**
 * A delayed note beside the pointer. Nested context/git targets take precedence over the row.
 * Portalled outside the anchor so row layout and scrolling cannot displace or clip the bubble.
 */
export function Tip({ as: Tag = 'span', text, children, className, onClick, ...props }: TipProps) {
  const anchor = useRef<HTMLElement>(null)
  const setAnchor = useCallback((element: HTMLElement | null) => {
    anchor.current = element
  }, [])
  const hover = useRef<{ point: Point; timer: number | null; visible: boolean } | null>(null)
  const [point, setPoint] = useState<Point | null>(null)
  const dismiss = useCallback(() => {
    const timer = hover.current?.timer
    if (timer != null) window.clearTimeout(timer)
    hover.current = null
    setPoint(null)
  }, [])
  useLayoutEffect(() => {
    // A live snapshot can reorder rows without a mouse movement or scroll event.
    if (
      point &&
      document.elementFromPoint(point.x, point.y)?.closest('[data-tip-anchor]') !== anchor.current
    )
      dismiss()
  })
  useEffect(() => {
    // Scrolling can put a different thread beneath a stationary pointer.
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      const timer = hover.current?.timer
      if (timer != null) window.clearTimeout(timer)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [dismiss])
  const track = (event: MouseEvent<HTMLElement>) => {
    if (
      !text ||
      !(event.target instanceof Element) ||
      event.target.closest('[data-tip-anchor]') !== anchor.current
    ) {
      dismiss()
      return
    }
    const next = { x: event.clientX, y: event.clientY }
    if (hover.current) {
      hover.current.point = next
      if (hover.current.visible) setPoint(next)
      return
    }
    hover.current = { point: next, timer: null, visible: false }
    hover.current.timer = window.setTimeout(() => {
      const current = hover.current
      if (!current) return
      const target = document.elementFromPoint(current.point.x, current.point.y)
      if (target?.closest('[data-tip-anchor]') !== anchor.current) {
        dismiss()
        return
      }
      current.timer = null
      current.visible = true
      setPoint(current.point)
    }, HOVER_DELAY)
  }
  return (
    <Tag
      {...props}
      ref={setAnchor}
      className={className}
      role={props.role ?? (onClick ? 'button' : undefined)}
      aria-label={props['aria-label'] ?? (Tag === 'span' ? text || undefined : undefined)}
      data-tip-anchor=""
      onMouseOver={(event) => {
        track(event)
        props.onMouseOver?.(event)
      }}
      onMouseMove={(event) => {
        track(event)
        props.onMouseMove?.(event)
      }}
      onMouseLeave={(event) => {
        dismiss()
        props.onMouseLeave?.(event)
      }}
      onMouseDown={(event) => {
        dismiss()
        props.onMouseDown?.(event)
      }}
      onClick={onClick}
    >
      {children}
      {point && text && createPortal(<TipBox text={text} point={point} />, document.body)}
    </Tag>
  )
}

function TipBox({ text, point }: { text: string; point: Point }) {
  const box = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number; maxWidth: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.maxWidth = ''
    el.style.left = '0px'
    const naturalWidth = el.getBoundingClientRect().width
    const right = window.innerWidth - point.x - GAP - EDGE
    const left = point.x - GAP - EDGE
    const useRight = naturalWidth <= right || (naturalWidth > left && right >= left)
    const maxWidth = Math.max(1, useRight ? right : left)
    el.style.maxWidth = `${maxWidth}px`
    const { width, height } = el.getBoundingClientRect()
    setPlace({
      top: Math.max(EDGE, Math.min(point.y - height / 2, window.innerHeight - height - EDGE)),
      left: useRight ? point.x + GAP : point.x - GAP - width,
      maxWidth,
    })
  }, [point, text])
  return (
    <span
      ref={box}
      className={styles.tip}
      role="tooltip"
      style={place ?? { top: 0, left: 0, visibility: 'hidden' }}
    >
      {text}
    </span>
  )
}
