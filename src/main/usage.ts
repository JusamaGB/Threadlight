// The plan's usage limits. Claude Code reports them as a "rate_limit_event" on its JSON stream
// with every request, and nowhere else Threadlight can read. So they come from two places: the
// agent's own runs (free), and otherwise a tiny check of its own: one word from Haiku, with no
// tools, settings, plugins or saved session (about a thousand tokens), at most every few minutes
// and only while the panel asks for them.

import { spawn } from 'node:child_process'

import type { Usage, UsageWindow } from '../shared/usage'
import type { CliCommand } from './relay'
import { isObject } from './sessions/json'

/** A reading younger than this is shown as it is; an older one is checked again. */
export const FRESH_MS = 5 * 60_000
const TIMEOUT_MS = 60_000
const CHECK_MODEL = 'claude-haiku-5-5'

function readWindow(value: unknown): UsageWindow | null {
  if (!isObject(value)) return null
  const { utilization: used, resetsAt } = value
  if (typeof used !== 'number' || typeof resetsAt !== 'number') return null
  return { used: Math.min(Math.max(used, 0), 1), resetsAt: resetsAt * 1000 }
}

/** A rate_limit_event's "rate_limit_info" → both windows, or null when it names neither. */
export function parseRateLimit(info: unknown, now = Date.now()): Usage | null {
  if (!isObject(info)) return null
  const windows = isObject(info['unifiedWindows']) ? info['unifiedWindows'] : {}
  // Older reports name only the window nearest its limit, at the top level.
  const top = readWindow(info)
  const type = info['rateLimitType']
  const fiveHour = readWindow(windows['five_hour']) ?? (type === 'five_hour' ? top : null)
  const week = readWindow(windows['seven_day']) ?? (type === 'seven_day' ? top : null)
  return fiveHour || week ? { fiveHour, week, at: now } : null
}

export interface UsageOptions {
  /** Claude Code, found when first needed. */
  cli: () => Promise<CliCommand | null>
  /** Where the check runs: the agent's own folder, out of the thread list. */
  cwd: string
  onChange: (usage: Usage) => void
  /** Runs the check and resolves with its output; tests swap in a fake. */
  run?: (cli: CliCommand, args: string[], cwd: string) => Promise<string>
}

export class UsageWatcher {
  private usage: Usage | null = null
  private checking = false

  constructor(private readonly options: UsageOptions) {}

  get current(): Usage | null {
    return this.usage
  }

  /** A rate-limit report seen on any stream (the agent's). */
  note(info: unknown, now = Date.now()): void {
    const usage = parseRateLimit(info, now)
    if (!usage) return
    // A report naming one window keeps the other's last reading.
    this.usage = {
      fiveHour: usage.fiveHour ?? this.usage?.fiveHour ?? null,
      week: usage.week ?? this.usage?.week ?? null,
      at: now,
    }
    this.options.onChange(this.usage)
  }

  /** Checks again unless the last reading is fresh or a check is already under way. */
  async refresh(now = Date.now()): Promise<void> {
    if (this.checking || (this.usage && now - this.usage.at < FRESH_MS)) return
    const cli = await this.options.cli()
    if (!cli) return
    this.checking = true
    try {
      const output = await (this.options.run ?? runCheck)(cli, CHECK_ARGS, this.options.cwd)
      for (const line of output.split('\n')) {
        let message: unknown
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (isObject(message) && message['type'] === 'rate_limit_event') {
          this.note(message['rate_limit_info'])
        }
      }
    } finally {
      this.checking = false
    }
  }
}

export const CHECK_ARGS = [
  '-p',
  'Reply with the single word ok.',
  '--model',
  CHECK_MODEL,
  '--output-format',
  'stream-json',
  '--verbose',
  '--system-prompt',
  'Reply briefly.',
  '--strict-mcp-config',
  '--tools',
  '',
  '--setting-sources',
  '',
  '--no-session-persistence',
]

function runCheck(cli: CliCommand, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cli.command, [...cli.prefixArgs, ...args], { cwd, windowsHide: true })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    const done = () => {
      clearTimeout(timer)
      resolve(output)
    }
    child.on('exit', done)
    child.on('error', done)
  })
}
