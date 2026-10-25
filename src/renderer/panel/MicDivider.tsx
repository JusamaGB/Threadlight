import { useEffect, useRef, type RefObject } from 'react'
import { providerName } from '../../shared/providers'
import type { Provider } from '../../shared/types'
import styles from './MicDivider.module.css'

interface MicDividerProps {
  provider: Provider
  level: number
  openMicLevel?: RefObject<number>
}

/** Steady ends say the mic is open; the centre expands only with measured input. */
export function MicDivider({ provider, level, openMicLevel }: MicDividerProps) {
  const element = useRef<HTMLSpanElement>(null)
  const latest = useRef(level)
  useEffect(() => {
    latest.current = level
  }, [level])
  useEffect(() => {
    const node = element.current
    if (!node) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0,
      previous = 0,
      strength = 0
    const draw = (time: number) => {
      const elapsed = previous ? Math.min(100, time - previous) : 0
      previous = time
      const raw = openMicLevel?.current ?? latest.current
      const target = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw - 0.025) * 1.8) : 0
      strength += (target - strength) * (1 - Math.exp(-elapsed / (target > strength ? 65 : 180)))
      node.style.setProperty('--spread', String(motion.matches ? 0.15 : 0.035 + strength * 0.965))
      node.style.setProperty('--strength', String(0.2 + strength * 0.8))
      node.style.setProperty('--rise', String(motion.matches ? 1 : 1 + strength * 1.5))
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [openMicLevel])
  return (
    <span
      ref={element}
      className={styles.divider}
      data-provider={provider}
      role="status"
      aria-label={`${providerName(provider)} microphone listening`}
    >
      <span className={styles.left} />
      <span className={styles.centre} />
      <span className={styles.right} />
    </span>
  )
}
