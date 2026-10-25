import { describe, expect, it } from 'vitest'

import { CHECK_ARGS, FRESH_MS, parseRateLimit, UsageWatcher } from '../src/main/usage'
import type { Usage } from '../src/shared/usage'

const info = {
  status: 'allowed_warning',
  resetsAt: 1793192400,
  rateLimitType: 'seven_day',
  utilization: 0.97,
  unifiedWindows: {
    five_hour: { utilization: 0.19, resetsAt: 1792939800 },
    seven_day: { utilization: 0.97, resetsAt: 1793192400 },
  },
}

describe('parseRateLimit', () => {
  it('reads both windows, resets in ms', () => {
    expect(parseRateLimit(info, 5)).toEqual({
      fiveHour: { used: 0.19, resetsAt: 1792939800_000 },
      week: { used: 0.97, resetsAt: 1793192400_000 },
      at: 5,
    })
  })

  it('falls back to the one window an older report names', () => {
    expect(
      parseRateLimit({ rateLimitType: 'five_hour', utilization: 0.4, resetsAt: 10 }, 0),
    ).toEqual({ fiveHour: { used: 0.4, resetsAt: 10_000 }, week: null, at: 0 })
    expect(parseRateLimit({ status: 'allowed' })).toBeNull()
  })
})

describe('UsageWatcher', () => {
  const setup = () => {
    const seen: Usage[] = []
    const calls: string[][] = []
    const watcher = new UsageWatcher({
      cli: async () => ({ command: 'claude.exe', prefixArgs: [] }),
      cwd: 'agent',
      onChange: (usage) => seen.push(usage),
      run: async (_cli, args) => {
        calls.push(args)
        return `{"type":"system"}\n${JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info })}\n`
      },
    })
    return { watcher, seen, calls }
  }

  it('checks with a tool-less, setting-less one-word run, then not again while fresh', async () => {
    const { watcher, seen, calls } = setup()
    await watcher.refresh()
    expect(calls).toEqual([CHECK_ARGS])
    expect(CHECK_ARGS).toEqual(expect.arrayContaining(['--tools', '', '--no-session-persistence']))
    expect(seen.at(-1)?.fiveHour?.used).toBe(0.19)
    await watcher.refresh()
    expect(calls).toHaveLength(1)
    await watcher.refresh(Date.now() + FRESH_MS + 1)
    expect(calls).toHaveLength(2)
  })

  it('takes reports from the agent for free, keeping the window a report leaves out', async () => {
    const { watcher, calls } = setup()
    watcher.note(info, 0)
    watcher.note({ rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1 }, 1)
    expect(watcher.current).toMatchObject({ fiveHour: { used: 0.5 }, week: { used: 0.97 } })
    await watcher.refresh(2)
    expect(calls).toHaveLength(0)
  })
})
