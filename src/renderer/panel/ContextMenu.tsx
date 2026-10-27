import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './Panel.module.css'
import { usePanelRoom } from './room'
import { Tip } from './Tip'

export interface MenuItem {
  label: string
  disabled?: boolean
  /** Explains the item in the panel's usual hover info. */
  help?: string
  /** The choice already in force. The control that opened the menu shows it, so it is not listed. */
  current?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  label?: string
  x: number
  y: number
  anchor?: HTMLElement
  items: MenuItem[]
  onClose: () => void
  /** Hover menus leave the rest of the panel interactive and do not take keyboard focus. */
  modal?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

/** A small menu at the pointer. A transparent layer behind it closes it on any outside click. */
export function ContextMenu({
  x,
  y,
  anchor,
  items: allItems,
  onClose,
  label,
  modal = true,
  onMouseEnter,
  onMouseLeave,
}: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  // The option already chosen is on the control that opened the menu, so it is not offered again.
  const items = allItems.filter((item) => !item.current)
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
      left: Math.max(card.left + 4, Math.min(x, card.right - width - 4)),
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
  useEffect(() => {
    if (modal)
      (
        menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menu.current
      )?.focus()
  }, [modal])

  if (items.length === 0) return null
  return createPortal(
    <>
      {modal && (
        <div
          className={styles.menuLayer}
          onMouseDown={onClose}
          onContextMenu={(event) => {
            event.preventDefault()
            onClose()
          }}
        />
      )}
      <div
        ref={menu}
        className={styles.menu}
        style={position}
        role="menu"
        tabIndex={-1}
        aria-label={label}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
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
        {items.map((item) => {
          const choose = () => {
            onClose()
            item.onSelect()
          }
          return item.help ? (
            <Tip
              key={item.label}
              as="button"
              className={styles.menuItem}
              role="menuitem"
              text={item.help}
              onClick={choose}
            >
              {item.label}
            </Tip>
          ) : (
            <button
              key={item.label}
              className={styles.menuItem}
              role="menuitem"
              disabled={item.disabled}
              onClick={choose}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </>,
    document.body,
  )
}
