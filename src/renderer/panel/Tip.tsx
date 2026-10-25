import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import styles from './Panel.module.css'

/** Space between the anchor and the tip, and between the tip and the window's edge. */
const GAP = 6
const EDGE = 4

interface TipProps {
  /** What the tip says; shown while the pointer is over the anchor. */
  text: string
  /** The anchor: what is hovered. */
  children: ReactNode
  className?: string
  onClick?: (event: React.MouseEvent) => void
}

/**
 * A one-line hover note in Threadlight's style, in place of the system tooltip. It opens below
 * its anchor, or above it near the window's foot, right-aligned to it and kept inside the window.
 * Fixed, so the list's scrolling box cannot clip it.
 */
export function Tip({ text, children, className, onClick }: TipProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <span
      ref={anchor}
      className={className}
      role={onClick ? 'button' : undefined}
      aria-label={text}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={onClick}
    >
      {children}
      {open && <TipBox text={text} anchor={anchor} />}
    </span>
  )
}

function TipBox({
  text,
  anchor,
}: {
  text: string
  anchor: React.RefObject<HTMLSpanElement | null>
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const at = anchor.current?.getBoundingClientRect()
    const el = box.current
    if (!at || !el) return
    const { offsetWidth: width, offsetHeight: height } = el
    const below = at.bottom + GAP + height + EDGE <= window.innerHeight
    setPlace({
      top: below ? at.bottom + GAP : Math.max(EDGE, at.top - GAP - height),
      left: Math.min(Math.max(EDGE, at.right - width), window.innerWidth - width - EDGE),
    })
  }, [anchor, text])
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
