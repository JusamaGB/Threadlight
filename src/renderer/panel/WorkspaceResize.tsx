import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Panel.module.css'

export const WORKSPACE_MIN_HEIGHT = 120

/** The whole quota strip resizes Workspace; saves once the pointer is released. */
export function WorkspaceResize({
  height,
  maxHeight,
  saving,
  onPreview,
  onCommit,
  children,
}: {
  height: number
  maxHeight: number
  saving: boolean
  onPreview: (height: number | null) => void
  onCommit: (height: number) => void
  children: ReactNode
}) {
  const drag = useRef<{ y: number; start: number; value: number } | null>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const clamp = (value: number) =>
    Math.round(Math.min(maxHeight, Math.max(WORKSPACE_MIN_HEIGHT, value)))
  useEffect(() => () => onPreview(null), [onPreview])
  return (
    <div
      className={styles.workspaceResizeArea}
      title="Drag to resize Workspace height"
      onPointerDown={(event) => {
        if (event.button !== 0 || saving) return
        event.preventDefault()
        grip.current?.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.setAttribute('data-workspace-resizing', '')
        drag.current = { y: event.screenY, start: height, value: height }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        drag.current.value = clamp(drag.current.start + event.screenY - drag.current.y)
        onPreview(drag.current.value)
      }}
      onPointerUp={(event) => {
        const picked = drag.current
        drag.current = null
        event.currentTarget.removeAttribute('data-workspace-resizing')
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
        if (picked && Math.abs(picked.value - picked.start) >= 1) onCommit(picked.value)
        else onPreview(null)
      }}
      onPointerCancel={(event) => {
        drag.current = null
        event.currentTarget.removeAttribute('data-workspace-resizing')
        onPreview(null)
      }}
      onLostPointerCapture={(event) => {
        if (!drag.current) return
        drag.current = null
        event.currentTarget.removeAttribute('data-workspace-resizing')
        onPreview(null)
      }}
    >
      {children}
      <button
        ref={grip}
        className={styles.workspaceResize}
        role="separator"
        aria-label="Resize Workspace height"
        aria-orientation="horizontal"
        aria-valuemin={Math.min(WORKSPACE_MIN_HEIGHT, maxHeight)}
        aria-valuemax={Math.round(maxHeight)}
        aria-valuenow={Math.round(height)}
        disabled={saving}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowUp'
              ? height - 10
              : event.key === 'ArrowDown'
                ? height + 10
                : event.key === 'Home'
                  ? WORKSPACE_MIN_HEIGHT
                  : event.key === 'End'
                    ? maxHeight
                    : null
          if (next === null) return
          event.preventDefault()
          onCommit(clamp(next))
        }}
      >
        <svg width="12" height="6" viewBox="0 0 12 6" aria-hidden="true">
          <path d="M2 1.5h8M2 4.5h8" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </div>
  )
}
