import type { Usage, UsageWindow } from '../../shared/usage'
import { en } from '../i18n/en'
import styles from './Panel.module.css'
import { Tip } from './Tip'

/** The same steps as the context ring: grey while there is room, then amber, then red. */
const AMBER_FROM = 0.6
const RED_FROM = 0.8
/** "14:30" today, "Mon 09:00" on another day. */
function resetText(at: number, now: Date): string {
  const when = new Date(at)
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return when.toDateString() === now.toDateString()
    ? time
    : `${when.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

function part(label: string, limit: UsageWindow | null, now: Date): string | null {
  return limit
    ? en.usage.part(label, Math.round(limit.used * 100), resetText(limit.resetsAt, now))
    : null
}

/**
 * A thin bar along the panel's foot: how much of the 5-hour limit is used, or the weekly one
 * while the full list is open. Hovering it tells both, with when each resets.
 */
export function UsageBar({ usage, weekly }: { usage: Usage; weekly: boolean }) {
  const shown = weekly ? (usage.week ?? usage.fiveHour) : (usage.fiveHour ?? usage.week)
  if (!shown) return null
  const now = new Date()
  const text = [part(en.usage.fiveHour, usage.fiveHour, now), part(en.usage.week, usage.week, now)]
    .filter(Boolean)
    .join(' · ')
  const level = shown.used >= RED_FROM ? 'red' : shown.used >= AMBER_FROM ? 'amber' : 'normal'
  return (
    <Tip text={text} className={styles.usage}>
      <span className={styles.usageTrack}>
        <span
          className={styles.usageFill}
          data-level={level}
          style={{ width: `${shown.used * 100}%` }}
        />
      </span>
    </Tip>
  )
}
