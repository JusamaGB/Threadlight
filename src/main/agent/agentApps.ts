// The connected apps the agent could use: the MCP servers Claude Code itself sees, read from
// `claude mcp list` (which checks each one, so it takes a few seconds; the answer is kept).

import { spawnOwnedProcess, stopOwnedProcess } from './ownedProcess'

import type { AgentApp } from '../../shared/agent'
import type { CliCommand } from '../relay'

const KEEP_MS = 5 * 60_000
const TIMEOUT_MS = 60_000

let kept: { at: number; apps: AgentApp[] } | null = null

/** "claude.ai Gmail: https://… - ✓ Connected" → { name: "claude.ai Gmail", status: "connected" } */
export function parseMcpList(output: string): AgentApp[] {
  const apps: AgentApp[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?): \S+.* - (.+)$/.exec(line.trim())
    if (!match) continue
    const raw = match[2]!.replace(/^[^A-Za-z]+/, '').trim()
    const status = /^connected/i.test(raw)
      ? 'connected'
      : /auth|sign/i.test(raw)
        ? 'needs sign-in'
        : raw.toLowerCase()
    apps.push({ name: match[1]!.trim(), status })
  }
  return apps
}

export async function connectedApps(cli: CliCommand, now = Date.now()): Promise<AgentApp[]> {
  if (kept && now - kept.at < KEEP_MS) return kept.apps
  const child = spawnOwnedProcess(cli.command, [...cli.prefixArgs, 'mcp', 'list'], process.cwd())
  let output = ''
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        void stopOwnedProcess(child)
        resolve()
      }, TIMEOUT_MS)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output = (output + chunk).slice(-1_000_000)
      })
      child.stderr.resume()
      child.once('close', done)
      child.once('error', done)
    })
  } finally {
    await stopOwnedProcess(child)
  }
  const apps = parseMcpList(output)
  kept = { at: now, apps }
  return apps
}
