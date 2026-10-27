import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Panel.module.css'

export const WORKSPACE_MIN_HEIGHT = 120
export const WORKSPACE_RESIZE_HINT = 'Drag to set Workspace maximum height'

/** The whole quota strip resizes Workspace with the mouse; saves once the pointer is released. */
export function WorkspaceResize({
  maxHeight,
  saving,
  onPreview,
  onCommit,
  children,
}: {
  maxHeight: number
  saving: boolean
  onPreview: (height: number | null) => void
  onCommit: (height: number) => void
  children: ReactNode
}) {
  const drag = useRef<{ y: number; start: number; value: number } | null>(null)
  const clamp = (value: number) =>
    Math.round(Math.min(maxHeight, Math.max(WORKSPACE_MIN_HEIGHT, value)))
  useEffect(() => () => onPreview(null), [onPreview])
  return (
    <div
      className={styles.workspaceResizeArea}
      role="separator"
      aria-label="Resize Workspace height"
      aria-orientation="horizontal"
      aria-disabled={saving || undefined}
      aria-description={WORKSPACE_RESIZE_HINT}
      onPointerDown={(event) => {
        if (event.button !== 0 || saving) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.setAttribute('data-workspace-resizing', '')
        const actualHeight =
          event.currentTarget.closest('[data-card]')?.getBoundingClientRect().height ?? maxHeight
        drag.current = { y: event.screenY, start: actualHeight, value: actualHeight }
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
    </div>
  )
}
