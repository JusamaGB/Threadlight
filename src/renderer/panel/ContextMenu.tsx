import { useLayoutEffect, useRef, useState } from 'react'

import styles from './Panel.module.css'

export interface MenuItem {
  label: string
  disabled?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** A small menu at the pointer. A transparent layer behind it closes it on any outside click. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Keep the whole menu inside the panel.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    })
  }, [x, y])

  return (
    <>
      <div
        className={styles.menuLayer}
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div ref={menu} className={styles.menu} style={position} role="menu">
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
    </>
  )
}
