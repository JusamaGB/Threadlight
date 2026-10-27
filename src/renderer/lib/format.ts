import { en } from '../i18n/en'

/** "now", "5m", "3h", "2d" */
export function ageText(sinceMs: number, nowMs: number): string {
  const seconds = Math.max(0, (nowMs - sinceMs) / 1000)
  if (seconds < 60) return en.age.now
  if (seconds < 3600) return en.age.minutes(Math.floor(seconds / 60))
  if (seconds < 86400) return en.age.hours(Math.floor(seconds / 3600))
  return en.age.days(Math.floor(seconds / 86400))
}

/** An exact local time for recent activity, or its date after 24 hours. */
// Building a formatter is far dearer than using one, and every row asks on every render.
const timeFormat = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat([], { day: 'numeric', month: 'short', year: 'numeric' })
export function lastActiveText(sinceMs: number, nowMs: number): string {
  const date = new Date(sinceMs)
  return nowMs - sinceMs < 86_400_000
    ? `Last active at ${timeFormat.format(date)}`
    : `Last active on ${dateFormat.format(date)}`
}

/** A "Show sessions from the last" window as the settings show it: "6h", "24h", "3d", "7d". */
export function windowLabel(hours: number): string {
  if (hours === 0) return 'Any time'
  return hours % 24 === 0 && hours > 24 ? `${hours / 24}d` : `${hours}h`
}

/** Shortens long text to a word boundary with an ellipsis. Short text is returned as is. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
