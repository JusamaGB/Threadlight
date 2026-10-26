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
import { HoverInfo } from './HoverInfo'

type Point = {
  x: number
  y: number
  local: { x: number; y: number }
  card: { left: number; top: number }
}

interface TipProps extends HTMLAttributes<HTMLElement> {
  as?: 'span' | 'button'
  /** What the tip says; shown while the pointer is over the anchor. */
  text: string
  /** Wait for the pointer to stay still this long. Other tips remain immediate. */
  restDelay?: number
  /** The anchor: what is hovered. */
  children: ReactNode
  className?: string
  onClick?: (event: React.MouseEvent) => void
}

/**
 * An immediate note above/below the pointer. Nested targets take precedence over their parents.
 * Portalled outside the anchor so row layout and scrolling cannot displace or clip the bubble.
 */
export function Tip({
  as: Tag = 'span',
  text,
  restDelay = 0,
  children,
  className,
  onClick,
  ...props
}: TipProps) {
  const anchor = useRef<HTMLElement>(null)
  const setAnchor = useCallback((element: HTMLElement | null) => {
    anchor.current = element
  }, [])
  const [point, setPoint] = useState<Point | null>(null)
  const resting = useRef<Point | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    resting.current = null
    setPoint(null)
  }, [])
  useLayoutEffect(() => {
    // A live snapshot can reorder rows without a mouse movement or scroll event.
    const candidate = resting.current ?? point
    // An upward native resize can briefly lag behind the reserved card offset.
    const card = anchor.current?.closest('[data-card]')?.getBoundingClientRect()
    if (card && card.bottom > window.innerHeight + 1) return
    if (
      candidate &&
      anchor.current &&
      document
        .elementFromPoint(
          candidate.x + (card?.left ?? 0) - candidate.card.left,
          candidate.y + (card?.top ?? 0) - candidate.card.top,
        )
        ?.closest('[data-tip-anchor]') !== anchor.current
    )
      dismiss()
  })
  useEffect(() => {
    // Scrolling can put a different thread beneath a stationary pointer.
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    const resize = () => {
      if (timer.current) dismiss()
    }
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', resize)
      if (timer.current) clearTimeout(timer.current)
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
    const at = event.currentTarget.getBoundingClientRect()
    const card = event.currentTarget.closest('[data-card]')?.getBoundingClientRect()
    const next = {
      x: event.clientX,
      y: event.clientY,
      local: { x: event.clientX - at.left, y: event.clientY - at.top },
      card: { left: card?.left ?? 0, top: card?.top ?? 0 },
    }
    if (!restDelay) {
      setPoint(next)
      return
    }
    if (resting.current?.x === next.x && resting.current?.y === next.y) return
    dismiss()
    resting.current = next
    timer.current = setTimeout(() => {
      timer.current = null
      if (
        document.elementFromPoint(next.x, next.y)?.closest('[data-tip-anchor]') === anchor.current
      )
        setPoint(next)
    }, restDelay)
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
      {point && text && (
        <HoverInfo anchor={anchor} point={point.local} onDismiss={dismiss}>
          {text}
        </HoverInfo>
      )}
    </Tag>
  )
}
