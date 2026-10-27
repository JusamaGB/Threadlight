import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ContextMenu, type MenuItem } from '../panel/ContextMenu'
import styles from './Settings.module.css'

type Open = { anchor: HTMLButtonElement; x: number; y: number; modal: boolean }

/**
 * One value button; hovering it lists the options and clicking one chooses it.
 * Nothing chosen yet reads "Select". Behaves like the Agent settings menus.
 */
export function HoverChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select',
  appearance = 'boxed',
  title,
}: {
  /** Names the setting, for assistive technology and the menu. */
  label: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (value: T) => void | Promise<unknown>
  disabled?: boolean
  placeholder?: string
  /** "text" matches the plain Agent row buttons: no box and no chevron. */
  appearance?: 'boxed' | 'text'
  /** Hover help for the button, like the Agent row's. */
  title?: string
}) {
  const [open, setOpen] = useState<Open | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = options.find((option) => option.value === value)?.label ?? placeholder
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  useEffect(() => cancelClose, [])
  useEffect(() => {
    if (!open || open.modal) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(null)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open])
  const show = (event: MouseEvent<HTMLButtonElement>, modal: boolean) => {
    cancelClose()
    const anchor = event.currentTarget
    const box = anchor.getBoundingClientRect()
    setOpen((existing) =>
      existing?.modal && !modal ? existing : { anchor, x: box.left, y: box.bottom, modal },
    )
  }
  const closeSoon = () => {
    if (open?.modal) return
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen((e) => (e?.modal ? e : null)), 150)
  }
  const items: MenuItem[] = options.map((option) => ({
    label: option.label,
    disabled: option.value === value,
    current: option.value === value,
    onSelect: () => void onChange(option.value),
  }))
  return (
    <>
      <button
        className={appearance === 'text' ? styles.textChoice : `${styles.small} ${styles.choice}`}
        aria-label={`${label}: ${current}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        disabled={disabled}
        onClick={(event) => show(event, true)}
        onMouseEnter={(event) => show(event, false)}
        onMouseLeave={closeSoon}
      >
        {current}
        {appearance === 'boxed' && (
          <span aria-hidden="true" className={styles.chevron}>
            ▾
          </span>
        )}
      </button>
      {open && (
        <ContextMenu
          key={options.map((option) => option.label).join('|')}
          label={label}
          x={open.x}
          y={open.y}
          anchor={open.anchor}
          items={items}
          onClose={() => {
            cancelClose()
            setOpen(null)
          }}
          modal={open.modal}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
        />
      )}
    </>
  )
}
