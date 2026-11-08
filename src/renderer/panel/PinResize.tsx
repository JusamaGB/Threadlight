import { useCallback, useEffect, useRef } from 'react'
import styles from './PinnedReference.module.css'

export function PinResize({
  height,
  resize,
  upward,
}: {
  height: number
  resize: (value: number) => void
  upward: boolean
}) {
  return (
    <HeightGrip
      height={height}
      resize={resize}
      upward={upward}
      min={160}
      max={540}
      label="Resize pinned reference"
      className={styles.grip}
      marker="data-pin-resizing"
    />
  )
}

export function HeightGrip({
  height,
  resize,
  upward,
  min,
  max,
  label,
  className,
  marker,
}: {
  height: number
  resize: (value: number) => void
  upward: boolean
  min: number
  max: number
  label: string
  className?: string
  marker: 'data-pin-resizing' | 'data-agent-resizing'
}) {
  const grip = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; y: number; height: number } | null>(null)
  const release = useCallback(() => {
    const current = drag.current
    drag.current = null
    grip.current?.removeAttribute(marker)
    if (current && grip.current?.hasPointerCapture(current.id))
      grip.current.releasePointerCapture(current.id)
  }, [marker])
  useEffect(() => {
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('blur', release)
      release()
    }
  }, [release])
  return (
    <div
      ref={grip}
      className={className}
      data-upward={upward || undefined}
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize. Up and Down adjust height."
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return
        e.preventDefault()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.setAttribute(marker, '')
        drag.current = { id: e.pointerId, y: e.screenY, height }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d && e.pointerId === d.id) resize(d.height + (e.screenY - d.y) * (upward ? -1 : 1))
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          release()
          return
        }
        const value =
          e.key === 'ArrowUp'
            ? height + 10
            : e.key === 'ArrowDown'
              ? height - 10
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : undefined
        if (value !== undefined) {
          e.preventDefault()
          e.stopPropagation()
          resize(value)
        }
      }}
    />
  )
}
