import type { Usage, UsageWindow } from '../../shared/usage'
import { en } from '../i18n/en'
import styles from './Panel.module.css'
import { Tip } from './Tip'
import { useNow } from '../hooks/useNow'

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

/** Codex reports account quotas in its local sessions; the weekly window can be primary. */
export function CodexUsageBar({ usage }: { usage: Usage | null | undefined }) {
  const now = useNow(60_000)
  const week = usage?.week && usage.week.resetsAt > now ? usage.week : null
  const text = week
    ? `Codex · ${part(en.usage.week, week, new Date(now))} · Last reported ${resetText(usage!.at, new Date(now))}`
    : 'Codex · Weekly usage unavailable. Waiting for a new local usage report.'
  const level =
    week && week.used >= RED_FROM ? 'red' : week && week.used >= AMBER_FROM ? 'amber' : 'normal'
  return (
    <Tip text={text} title="" className={`${styles.usage} ${styles.codexUsage}`}>
      <span className={styles.usageTrack} data-unavailable={!week || undefined}>
        {week && (
          <span
            className={styles.usageFill}
            data-level={level}
            style={{ width: `${week.used * 100}%` }}
          />
        )}
      </span>
    </Tip>
  )
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
export function UsageBar({
  usage,
  weekly,
  source,
}: {
  usage: Usage
  weekly: boolean
  source?: string
}) {
  const shown = weekly ? (usage.week ?? usage.fiveHour) : (usage.fiveHour ?? usage.week)
  if (!shown) return null
  const now = new Date()
  const text = [part(en.usage.fiveHour, usage.fiveHour, now), part(en.usage.week, usage.week, now)]
    .filter(Boolean)
    .join(' · ')
  const level = shown.used >= RED_FROM ? 'red' : shown.used >= AMBER_FROM ? 'amber' : 'normal'
  return (
    <Tip text={source ? `${source} · ${text}` : text} title="" className={styles.usage}>
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
