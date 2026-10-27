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
import { hasDockedHover, HoverInfo, type HoverPoint } from './HoverInfo'
import styles from './Panel.module.css'
import { useHelpMode } from './helpMode'

type Point = {
  x: number
  y: number
  local: HoverPoint
  card: { left: number; top: number }
}

interface TipProps extends HTMLAttributes<HTMLElement> {
  as?: 'span' | 'button'
  /** What the tip says; shown while the pointer is over the anchor. */
  text: string
  /** Optional presentation of the same information; text remains the accessible anchor label. */
  infoContent?: ReactNode
  /** A separate action available on the same hover target. */
  actionHint?: string
  /** Additional help appears only in Tour, leaving Info's wording and timing unchanged. */
  tourHelp?: string
  tourOnly?: boolean
  /** Wait for the pointer to stay still this long. Other tips remain immediate. */
  restDelay?: number
  /** The anchor: what is hovered. */
  children: ReactNode
  className?: string
  onClick?: (event: React.MouseEvent) => void
}

/** Nested targets own their hint; HoverInfo chooses a short bubble or the shared footer. */
export function Tip({
  as: Tag = 'span',
  text: infoText,
  infoContent,
  actionHint,
  tourHelp,
  tourOnly = false,
  restDelay = 0,
  children,
  className,
  onClick,
  ...props
}: TipProps) {
  const mode = useHelpMode()
  const help = mode === 'tour' ? tourHelp : undefined
  const hasInfo = !tourOnly && !!(infoText || infoContent)
  const delay = mode === 'tour' ? 0 : restDelay
  const enabled = mode !== 'off' && !!(hasInfo || help || actionHint)
  const anchor = useRef<HTMLElement>(null)
  const setAnchor = useCallback((element: HTMLElement | null) => {
    anchor.current = element
  }, [])
  const [point, setPoint] = useState<Point | null>(null)
  const [previousMode, setPreviousMode] = useState(mode)
  if (previousMode !== mode) {
    setPreviousMode(mode)
    setPoint(null)
  }
  const resting = useRef<Point | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointer = useRef<HoverPoint | null>(null)
  const dismissedAt = useRef<HoverPoint | null>(null)
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    resting.current = null
    if (hasDockedHover(anchor.current)) dismissedAt.current = lastPointer.current
    setPoint(null)
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      resting.current = null
    },
    [mode],
  )
  useLayoutEffect(() => {
    // The footer may cover the original hit target without any pointer movement.
    if (hasDockedHover(anchor.current)) return
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
    // Closing a footer can move its anchor back under a stationary pointer.
    const movement = (event: globalThis.MouseEvent) => {
      const blocked = dismissedAt.current
      if (blocked && (blocked.screenX !== event.screenX || blocked.screenY !== event.screenY))
        dismissedAt.current = null
    }
    // Scrolling can put a different thread beneath a stationary pointer.
    const scroll = (event: Event) => {
      if (!event.isTrusted || !hasDockedHover(anchor.current)) dismiss()
    }
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('mousemove', movement, true)
    window.addEventListener('blur', dismiss)
    const resize = () => {
      if (timer.current) dismiss()
    }
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('scroll', scroll, true)
      document.removeEventListener('mousemove', movement, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', resize)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [dismiss])
  const track = (event: MouseEvent<HTMLElement>) => {
    if (
      dismissedAt.current?.screenX === event.screenX &&
      dismissedAt.current?.screenY === event.screenY
    )
      return
    if (
      !enabled ||
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
      local: {
        x: event.clientX - at.left,
        y: event.clientY - at.top,
        screenX: event.screenX,
        screenY: event.screenY,
      },
      card: { left: card?.left ?? 0, top: card?.top ?? 0 },
    }
    lastPointer.current = next.local
    if (!delay) {
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
    }, delay)
  }
  return (
    <Tag
      {...props}
      ref={setAnchor}
      className={className}
      role={props.role ?? (onClick ? 'button' : undefined)}
      aria-label={props['aria-label'] ?? (Tag === 'span' ? infoText || undefined : undefined)}
      data-tip-anchor={!tourOnly || enabled ? '' : undefined}
      onMouseOver={(event) => {
        track(event)
        props.onMouseOver?.(event)
      }}
      onMouseMove={(event) => {
        track(event)
        props.onMouseMove?.(event)
      }}
      onMouseLeave={(event) => {
        if (!hasDockedHover(anchor.current)) dismiss()
        props.onMouseLeave?.(event)
      }}
      onMouseDown={(event) => {
        if (
          !hasDockedHover(anchor.current) ||
          !anchor.current?.closest('[data-workspace-resizing]')
        )
          dismiss()
        props.onMouseDown?.(event)
      }}
      onClick={onClick}
    >
      {children}
      {point && enabled && (
        <HoverInfo anchor={anchor} point={point.local} onDismiss={dismiss}>
          {hasInfo && <span className={styles.tipInfo}>{infoContent ?? infoText}</span>}
          {(help || actionHint) && (
            <>
              {hasInfo && <span role="separator" className={styles.tipDivider} />}
              {help && <span className={styles.tipHelp}>{help}</span>}
              {actionHint && <span className={styles.tipHelp}>{actionHint}</span>}
            </>
          )}
        </HoverInfo>
      )}
    </Tag>
  )
}
