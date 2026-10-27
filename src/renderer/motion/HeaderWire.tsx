import { useEffect, useId, useMemo, useRef } from 'react'
import {
  advanceElectricalTime,
  createElectricalSequence,
  electricalMarkup,
  renderElectricity,
  type ElectricalEvent,
} from './headerWireMotion'

/** Shared with the approved preview; toggling retains the current arrival. */
export function HeaderWire({ connected }: { connected: boolean }) {
  const host = useRef<HTMLSpanElement>(null)
  const id = useId()
  const markup = useMemo(
    () => ({ __html: electricalMarkup(`header-${id.replace(/[^a-z0-9]/gi, '')}`) }),
    [id],
  )
  const clock = useRef<{
    next: () => ElectricalEvent
    event: ElectricalEvent
    time: number
  } | null>(null)

  useEffect(() => {
    const element = host.current
    const svg = element?.querySelector('svg')
    if (!element || !svg) return
    if (!clock.current) {
      const next = createElectricalSequence()
      clock.current = { next, event: next(), time: 0 }
    }
    const timeline = clock.current
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0,
      last = 0,
      inView = true
    const active = () => !preference.matches && !document.hidden && inView
    const paint = () =>
      renderElectricity(svg, connected, timeline.time, preference.matches, timeline.event)
    const tick = (now: number) => {
      const elapsed = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      timeline.time = advanceElectricalTime(timeline.time, elapsed, timeline.event)
      if (timeline.time >= timeline.event.interval) {
        timeline.time = 0
        timeline.event = timeline.next()
      }
      paint()
      if (active()) frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      last = 0
      paint()
      if (active()) frame = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false
      wake()
    })
    observer.observe(element)
    preference.addEventListener('change', wake)
    document.addEventListener('visibilitychange', wake)
    wake()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      preference.removeEventListener('change', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [connected])

  return <span ref={host} data-header-wire aria-hidden dangerouslySetInnerHTML={markup} />
}
