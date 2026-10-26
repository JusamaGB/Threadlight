import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './Panel.module.css'
import { usePanelRoom } from './room'

export interface MenuItem {
  label: string
  disabled?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  label?: string
  x: number
  y: number
  anchor?: HTMLElement
  items: MenuItem[]
  onClose: () => void
}

/** A small menu at the pointer. A transparent layer behind it closes it on any outside click. */
export function ContextMenu({ x, y, anchor, items, onClose, label }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const { opensDown, extra, reserve } = usePanelRoom()
  const [position, setPosition] = useState({
    left: x,
    top: y,
    maxHeight: undefined as number | undefined,
  })

  // Keep the whole menu inside the panel.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const card = document.querySelector('[data-card]')?.getBoundingClientRect()
    if (!card) return
    const width = element.offsetWidth
    const height = element.scrollHeight + 2
    const at = anchor?.getBoundingClientRect()
    reserve(
      at
        ? opensDown
          ? at.bottom - card.top + height + 6 - card.height
          : height + 6
        : height + 8 - card.height,
    )
    const top = opensDown ? card.top : card.top - extra
    const bottom = opensDown ? card.bottom + extra : card.bottom
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(
        top + 4,
        Math.min(at ? (opensDown ? at.bottom + 2 : at.top - height - 2) : y, bottom - height - 4),
      ),
      maxHeight: Math.max(0, bottom - top - 8),
    })
  }, [x, y, anchor, opensDown, extra, reserve])
  const release = useRef(reserve)
  useEffect(() => {
    release.current = reserve
  }, [reserve])
  useEffect(() => () => release.current(0), [])
  useEffect(
    () =>
      (
        menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menu.current
      )?.focus(),
    [],
  )

  return createPortal(
    <>
      <div
        className={styles.menuLayer}
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menu}
        className={styles.menu}
        style={position}
        role="menu"
        tabIndex={-1}
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
          buttons[next]?.focus()
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            className={styles.menuItem}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}
