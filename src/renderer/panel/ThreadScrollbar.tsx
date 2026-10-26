import { useEffect, useRef, useState, type RefObject } from 'react'
import styles from './Panel.module.css'

/** Overlay the outline so provider tints continue beneath the entire scrollbar. */
export function ThreadScrollbar({ list }: { list: RefObject<HTMLDivElement | null> }) {
  const [bar, setBar] = useState({ top: 0, height: 0, thumb: 0, offset: 0, max: 0, value: 0 })
  const drag = useRef<{ y: number; value: number; ratio: number } | null>(null)
  useEffect(() => {
    const element = list.current
    if (!element) return
    let frame = 0
    const measure = () => {
      const height = Math.max(0, element.clientHeight - 4)
      const max = Math.max(0, element.scrollHeight - element.clientHeight)
      const thumb = Math.min(
        height,
        Math.max(24, (height * element.clientHeight) / Math.max(1, element.scrollHeight)),
      )
      const value = Math.max(0, Math.min(max, element.scrollTop))
      setBar({
        top:
          element.getBoundingClientRect().top -
          element.parentElement!.getBoundingClientRect().top +
          2,
        height,
        thumb,
        max,
        value,
        offset: max ? ((height - thumb) * value) / max : 0,
      })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    const observe = () => {
      resize.disconnect()
      resize.observe(element)
      resize.observe(element.parentElement!)
      for (const row of element.querySelectorAll('[data-session-id]')) resize.observe(row)
      schedule()
    }
    const mutation = new MutationObserver(observe)
    mutation.observe(element, { childList: true, subtree: true })
    element.addEventListener('scroll', schedule)
    observe()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      element.removeEventListener('scroll', schedule)
    }
  }, [list])
  if (!bar.max || !bar.height) return null
  return (
    <div
      className={styles.threadScrollTrack}
      style={{ top: bar.top, height: bar.height }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || event.button !== 0 || !list.current) return
        event.preventDefault()
        const y = event.clientY - event.currentTarget.getBoundingClientRect().top
        list.current.scrollBy({ top: (y < bar.offset ? -1 : 1) * list.current.clientHeight })
      }}
      onWheel={(event) => {
        if (list.current)
          list.current.scrollBy({
            top:
              event.deltaY *
              (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.current.clientHeight : 1),
          })
      }}
    >
      <div
        className={styles.threadScrollThumb}
        style={{ height: bar.thumb, top: bar.offset }}
        role="scrollbar"
        tabIndex={0}
        aria-label="Scroll threads"
        aria-controls="thread-list"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.ceil(bar.max)}
        aria-valuenow={Math.round(bar.value)}
        onPointerDown={(event) => {
          if (event.button !== 0 || bar.height <= bar.thumb) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.setAttribute('data-thread-scroll-dragging', '')
          drag.current = {
            y: event.clientY,
            value: list.current!.scrollTop,
            ratio: bar.max / (bar.height - bar.thumb),
          }
        }}
        onPointerMove={(event) => {
          if (drag.current && list.current)
            list.current.scrollTo({
              top: drag.current.value + (event.clientY - drag.current.y) * drag.current.ratio,
            })
        }}
        onPointerUp={(event) => {
          drag.current = null
          event.currentTarget.removeAttribute('data-thread-scroll-dragging')
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={(event) => {
          drag.current = null
          event.currentTarget.removeAttribute('data-thread-scroll-dragging')
        }}
        onLostPointerCapture={(event) => {
          drag.current = null
          event.currentTarget.removeAttribute('data-thread-scroll-dragging')
        }}
        onKeyDown={(event) => {
          const element = list.current
          if (!element) return
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? bar.max
                : event.key === 'ArrowDown'
                  ? element.scrollTop + 40
                  : event.key === 'ArrowUp'
                    ? element.scrollTop - 40
                    : event.key === 'PageDown'
                      ? element.scrollTop + element.clientHeight
                      : event.key === 'PageUp'
                        ? element.scrollTop - element.clientHeight
                        : null
          if (next === null) return
          event.preventDefault()
          element.scrollTo({ top: next })
        }}
      />
    </div>
  )
}
