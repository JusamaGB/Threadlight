import { en } from '../i18n/en'
import styles from './Panel.module.css'

/** Above these shares of the context window the ring turns amber, then red. */
const AMBER_FROM = 0.6
const RED_FROM = 0.8

interface ContextRingProps {
  /** How full the thread's context is, 0 to 1. */
  used: number | null
  /** Wider, to sit around the double circle of a thread that needs you. */
  wide: boolean
  /** Animate during active work, including tools and replies. */
  active?: boolean
}

/**
 * The thread's context, drawn as Claude's Context ring is: a faint track with an arc filling
 * clockwise from the top, grey while there is room, then amber, then red. It sits around the
 * row's amber attention marker, or on its own. An unknown reading has only a neutral track.
 */
export function ContextRing({ used, wide, active = false }: ContextRingProps) {
  // Even sizes around even dots (6 and 12 px), so every edge falls on a whole pixel.
  const size = wide ? 18 : 14
  const radius = (size - 1.5) / 2
  const length = 2 * Math.PI * radius
  const level =
    used !== null && used >= RED_FROM
      ? 'red'
      : used !== null && used >= AMBER_FROM
        ? 'amber'
        : 'normal'
  return (
    <svg
      className={styles.contextRing}
      data-active={active || undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        className={styles.ringTrack}
        data-unknown={used === null || undefined}
        strokeDasharray={used === null ? '2 3' : undefined}
        cx={size / 2}
        cy={size / 2}
        r={radius}
      />
      {used !== null && (
        <circle
          className={styles.ringFill}
          data-level={level}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - used)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  )
}

/** "Context 52%", for the dot's tooltip. */
export const contextLabel = (used: number) => en.detail.context(Math.round(used * 100))
