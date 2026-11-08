import { useLayoutEffect, useRef, type RefObject } from 'react'
import { MIC_PILL_HEIGHT, MIC_PILL_WIDTH } from '../../shared/micIndicator'

type Size = { width: number; height: number }
const rest: Size = { width: MIC_PILL_WIDTH, height: MIC_PILL_HEIGHT }

/** Continue from the last painted size when streaming text changes the target. */
export function usePillSize(
  pill: RefObject<HTMLDivElement | null>,
  body: Size,
  expanded: boolean,
  menu: boolean,
) {
  const painted = useRef<Size>({ ...rest })
  useLayoutEffect(() => {
    const element = pill.current
    if (!element) return
    let frame = 0
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const target =
      expanded && !menu ? { width: body.width, height: MIC_PILL_HEIGHT + body.height } : rest
    let previous = performance.now()

    const draw = (now: number) => {
      const current = painted.current
      const instant = menu || document.hidden || preference.matches
      const weight = 1 - Math.exp(-Math.min(24, Math.max(1, now - previous)) / 54)
      previous = now
      const approach = (from: number, to: number) => {
        const value = from + (to - from) * weight
        return instant || Math.abs(to - value) <= 0.5 ? to : value
      }
      const width = approach(
        current.width,
        !expanded && !instant && current.height > rest.height ? current.width : target.width,
      )
      const height = approach(
        current.height,
        expanded && !instant && current.height === rest.height && width !== target.width
          ? rest.height
          : target.height,
      )
      painted.current = { width, height }
      // One clock and the same integer dimensions for the visible surface and the native window.
      const w = Math.round(width),
        h = Math.round(height)
      element.style.setProperty('--pill-width', w + 'px')
      element.style.setProperty('--pill-height', h + 'px')
      if (!menu) window.threadlight.setSpokenReplySize(w, h)
      if (width !== target.width || height !== target.height) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      previous = performance.now()
      draw(previous)
    }
    if (preference.matches && !document.hidden) frame = requestAnimationFrame(draw)
    else wake()
    document.addEventListener('visibilitychange', wake)
    preference.addEventListener('change', wake)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', wake)
      preference.removeEventListener('change', wake)
    }
  }, [body.width, body.height, expanded, menu, pill])
}
