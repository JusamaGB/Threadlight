import type { Usage, UsageWindow } from '../../shared/usage'
import { isObject } from '../sessions/json'

/** Window durations identify the quota: primary is not necessarily a five-hour limit. */
export function parseCodexUsage(value: unknown, at: number): Usage | null {
  if (!isObject(value) || !Number.isFinite(at) || at <= 0) return null
  const buckets = value['rateLimitsByLimitId'] ?? value['rate_limits_by_limit_id']
  const candidate = isObject(buckets) ? buckets['codex'] : (value['rateLimits'] ?? value)
  if (!isObject(candidate)) return null
  const id = candidate['limit_id'] ?? candidate['limitId']
  if (id !== undefined && id !== null && id !== 'codex') return null
  if (!('primary' in candidate) && !('secondary' in candidate)) return null
  const usage: Usage = { fiveHour: null, week: null, at }
  for (const window of [candidate['primary'], candidate['secondary']]) {
    if (!isObject(window)) continue
    const used = window['used_percent'] ?? window['usedPercent']
    const minutes = window['window_minutes'] ?? window['windowDurationMins']
    const resets = window['resets_at'] ?? window['resetsAt']
    if (
      typeof used !== 'number' ||
      !Number.isFinite(used) ||
      typeof resets !== 'number' ||
      !Number.isFinite(resets) ||
      resets <= 0
    )
      continue
    const reading: UsageWindow = {
      used: Math.min(1, Math.max(0, used / 100)),
      resetsAt: resets * 1000,
    }
    if (minutes === 10080) usage.week = reading
    if (minutes === 300) usage.fiveHour = reading
  }
  return usage
}

/** Read-only observations from session files; no probe turn or account mutation is needed. */
export function codexUsage(records: Record<string, unknown>[]): Usage | null {
  let latest: Usage | null = null
  for (const record of records) {
    const item = isObject(record['payload']) ? record['payload'] : record
    const at = typeof record['timestamp'] === 'string' ? Date.parse(record['timestamp']) : NaN
    const usage = parseCodexUsage(item['rate_limits'], at)
    if (usage && (!latest || usage.at >= latest.at)) latest = usage
  }
  return latest
}
