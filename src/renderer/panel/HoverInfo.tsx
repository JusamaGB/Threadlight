import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useHelpMode } from './helpMode'
import { usePanelRoom } from './room'
import styles from './Panel.module.css'

/** Short hints follow the cursor; longer messages, and every hint in Tour, open in the footer. */
const GAP = 18
const EDGE = 4
export interface HoverPoint {
  x: number
  y: number
  screenX?: number
  screenY?: number
}

export const hasDockedHover = (anchor: HTMLElement | null) =>
  anchor?.hasAttribute('data-hover-docked') ?? false

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
  const [dock, setDock] = useState<HTMLElement | null>(null)
  const [dockLimit, setDockLimit] = useState(180)
  const { opensDown, extra, reserve } = usePanelRoom()
  const tour = useHelpMode() === 'tour'
  const [position, setPosition] = useState<{ top: number; left: number; maxWidth: number } | null>(
    null,
  )
  useLayoutEffect(() => {
    const measure = () => {
      const element = box.current
      const target = anchor.current
      const cardElement = target?.closest<HTMLElement>('[data-card]')
      const card = cardElement?.getBoundingClientRect()
      if (!element || !target) return
      const at = target.getBoundingClientRect()
      const x = at.left + point.x
      const y = at.top + point.y
      const left = Math.max(EDGE, (card?.left ?? 0) + EDGE)
      const right = Math.min(window.innerWidth - EDGE, (card?.right ?? window.innerWidth) - EDGE)
      const maxWidth = Math.max(1, right - left)
      const slot = cardElement?.querySelector<HTMLElement>('[data-hover-message]')
      // Measure without the dock's full-width styling, including structured task hints.
      const probe = element.cloneNode(true) as HTMLElement
      probe.className = className ?? ''
      probe.removeAttribute('role')
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = `position:fixed;visibility:hidden;left:0;top:0;width:max-content;max-width:${maxWidth}px;max-height:none`
      document.body.append(probe)
      const measured = probe.getBoundingClientRect()
      const long =
        measured.width > maxWidth / 2 || (probe.textContent?.trim().split(/\s+/).length ?? 0) > 5
      probe.remove()
      if (slot && (long || tour)) {
        target.setAttribute('data-hover-docked', '')
        const limit =
          Number.parseFloat(getComputedStyle(cardElement!).maxHeight) || window.innerHeight
        const header = cardElement!.querySelector('header')?.getBoundingClientRect().height ?? 25
        setDockLimit(Math.max(16, Math.min(180, limit - header - 32)))
        setDock(slot)
        reserve(0)
        return
      }
      target.removeAttribute('data-hover-docked')
      setDock(null)
      element.style.maxWidth = `${maxWidth}px`
      // Measure intrinsic content at the full cap, independent of the pointer's horizontal position.
      element.style.left = `${left}px`
      const { width, height } = measured
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
  }, [anchor, point, opensDown, extra, reserve, children, className, tour])
  useEffect(() => {
    // Own this subscription: the anchor may also listen with the same dismissal callback.
    const dismiss = () => onDismiss()
    window.addEventListener('blur', dismiss)
    const scroll = (event: Event) => {
      if (!dock || !event.isTrusted) dismiss()
    }
    const movement = (event: MouseEvent) => {
      if (!dock || (point.screenX === event.screenX && point.screenY === event.screenY)) return
      if (anchor.current?.closest('[data-workspace-resizing]')) return
      const target = event.target
      if (
        target instanceof Element &&
        (dock.contains(target) ||
          target.closest('[data-tip-anchor], [data-native-help-anchor]') === anchor.current)
      )
        return
      dismiss()
    }
    const intent = (event: Event) => {
      if (!dock) return
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          dismiss()
          return
        }
        if (!['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key))
          return
      }
      if (event.target instanceof Node && dock.contains(event.target)) return
      dismiss()
    }
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('mousemove', movement, true)
    document.addEventListener('wheel', intent, true)
    document.addEventListener('touchmove', intent, true)
    document.addEventListener('keydown', intent, true)
    document.addEventListener('mouseleave', dismiss)
    return () => {
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('scroll', scroll, true)
      document.removeEventListener('mousemove', movement, true)
      document.removeEventListener('wheel', intent, true)
      document.removeEventListener('touchmove', intent, true)
      document.removeEventListener('keydown', intent, true)
      document.removeEventListener('mouseleave', dismiss)
    }
  }, [onDismiss, dock, point, anchor])
  useEffect(() => {
    const target = anchor.current
    return () => target?.removeAttribute('data-hover-docked')
  }, [anchor])
  const release = useRef(reserve)
  useEffect(() => {
    release.current = reserve
  }, [reserve])
  useEffect(() => () => release.current(0), [])
  return createPortal(
    <span
      ref={box}
      className={dock ? `${className} ${styles.dockedInfo}` : className}
      role="tooltip"
      title=""
      data-docked={dock ? '' : undefined}
      tabIndex={dock ? 0 : undefined}
      style={
        dock ? { maxHeight: dockLimit } : (position ?? { top: 0, left: 0, visibility: 'hidden' })
      }
      onMouseOver={(event) => {
        if (dock) event.stopPropagation()
      }}
      onMouseMove={(event) => {
        if (dock) event.stopPropagation()
      }}
      onMouseDown={(event) => {
        if (dock) event.stopPropagation()
      }}
      onPointerDown={(event) => {
        if (dock) event.stopPropagation()
      }}
      onClick={(event) => {
        if (dock) event.stopPropagation()
      }}
      onDoubleClick={(event) => {
        if (dock) event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (dock) event.stopPropagation()
      }}
    >
      {children}
    </span>,
    dock ?? document.body,
  )
}
