// Delivers a message to a session in the background: runs the user's own Claude Code CLI
// with `--resume <session> -p <message>`, which adds one turn to that session exactly as if
// it had been typed in Claude. The reply comes back as JSON on stdout.

import { execFile, spawn } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Session } from '../shared/types'
import { isObject, oneLine, str } from './sessions/json'
import type { ClaudePaths } from './sessions/paths'

/** Windows caps a command line at 32 767 characters; leave room for the rest of it. */
export const MAX_MESSAGE_LENGTH = 16_000
const REPLY_TIMEOUT_MS = 30 * 60 * 1000

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
])
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/

/** How to start the CLI. Tests swap in a fake; production uses claude.exe with no prefix. */
export interface CliCommand {
  command: string
  prefixArgs: string[]
}

export type RelayResult = { ok: true; reply: string } | { ok: false; reason: string }

export interface RelayDeps {
  cli: CliCommand | null
  /** True if a running process already owns this session (the Claude app has it open). */
  isHeld: (sessionId: string) => Promise<boolean>
}

/** The parts of a session the relay needs. Taken from Threadlight's own scan, never from the UI. */
export type RelayTarget = Pick<Session, 'id' | 'cwd' | 'permissionMode' | 'model'>

export function relayArgs(target: RelayTarget, text: string): string[] {
  const args = ['--resume', target.id, '-p', text, '--output-format', 'json']
  if (target.permissionMode && PERMISSION_MODES.has(target.permissionMode)) {
    args.push('--permission-mode', target.permissionMode)
  }
  if (target.model && MODEL.test(target.model)) args.push('--model', target.model)
  return args
}

/** Sends `text` to the session. `onSent` fires once the CLI has started with the message (✓). */
export async function relayMessage(
  target: RelayTarget,
  text: string,
  deps: RelayDeps,
  onSent: () => void = () => {},
): Promise<RelayResult> {
  if (!SESSION_ID.test(target.id)) return { ok: false, reason: 'That session cannot be messaged.' }
  const message = text.trim()
  if (!message) return { ok: false, reason: 'Nothing to send.' }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` }
  }
  if (!deps.cli) return { ok: false, reason: 'Claude Code was not found on this PC.' }
  // Two processes writing one session would fork its history.
  if (await deps.isHeld(target.id)) {
    return { ok: false, reason: 'Claude has this thread open right now. Use Open to reply there.' }
  }

  return new Promise((resolve) => {
    // No shell: the message is one argument and is never interpreted.
    const child = spawn(
      deps.cli!.command,
      [...deps.cli!.prefixArgs, ...relayArgs(target, message)],
      {
        cwd: target.cwd || undefined,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (result: RelayResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      done({ ok: false, reason: 'No reply within 30 minutes.' })
    }, REPLY_TIMEOUT_MS)

    child.once('spawn', onSent)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.once('error', (error) =>
      done({ ok: false, reason: `Could not start Claude: ${error.message}` }),
    )
    child.once('close', () => done(interpretOutput(stdout, stderr)))
  })
}

/** Turns the CLI's `--output-format json` result into a reply or a readable reason. */
export function interpretOutput(stdout: string, stderr: string): RelayResult {
  let result: unknown
  try {
    result = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: oneLine(stderr || stdout).slice(0, 200) || 'No reply.' }
  }
  if (!isObject(result)) return { ok: false, reason: 'No reply.' }
  const reply = oneLine(str(result['result']))
  if (reply.toLowerCase().includes('not logged in')) {
    return { ok: false, reason: "Claude Code isn't signed in. Run 'claude auth login' once." }
  }
  if (result['is_error'] === true)
    return { ok: false, reason: reply || 'Claude reported an error.' }
  return { ok: true, reply: reply || 'Done.' }
}

/**
 * The CLI to run: the newest one bundled with the Claude app, else Claude Code's native
 * install. Only real .exe files: Node will not start a .cmd without a shell, by design.
 */
export async function findClaudeCli(paths: ClaudePaths): Promise<CliCommand | null> {
  const bundled = await newestBundledCli(paths.appCliRoot)
  if (bundled) return { command: bundled, prefixArgs: [] }
  if (await exists(paths.nativeCli)) return { command: paths.nativeCli, prefixArgs: [] }
  return null
}

async function newestBundledCli(root: string): Promise<string | null> {
  let versions: string[]
  try {
    versions = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return null
  }
  versions.sort(compareVersions).reverse()
  for (const version of versions) {
    let builds: string[]
    try {
      builds = (await readdir(join(root, version), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const build of builds) {
      const exe = join(root, version, build, 'claude.exe')
      if (await exists(exe)) return exe
    }
  }
  return null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return diff
  }
  return 0
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * True if a running Claude Code process owns this session. Two checks, either is enough:
 * Claude Code's own registry of live sessions (the Claude app's threads are only found this
 * way, since their processes do not name the session on the command line), and a claude.exe
 * whose command line does (a terminal session started with --resume).
 */
export async function isHeld(liveSessionsDir: string, sessionId: string): Promise<boolean> {
  if (!SESSION_ID.test(sessionId)) return true
  return (
    (await isInLiveRegistry(liveSessionsDir, sessionId)) ||
    (await isHeldByRunningProcess(sessionId))
  )
}

/**
 * Each running Claude Code process writes `<liveSessionsDir>/<pid>.json` naming its session.
 * A file whose process has exited is a leftover and does not count.
 */
export async function isInLiveRegistry(
  liveSessionsDir: string,
  sessionId: string,
  isRunning: (pid: number) => boolean = processIsRunning,
): Promise<boolean> {
  let names: string[]
  try {
    names = (await readdir(liveSessionsDir)).filter((name) => /^\d+\.json$/.test(name))
  } catch {
    return false // no registry (an older Claude Code): the command-line check still runs
  }
  for (const name of names) {
    let entry: unknown
    try {
      entry = JSON.parse(await readFile(join(liveSessionsDir, name), 'utf8'))
    } catch {
      continue
    }
    if (!isObject(entry) || entry['sessionId'] !== sessionId) continue
    const pid = typeof entry['pid'] === 'number' ? entry['pid'] : Number.parseInt(name, 10)
    if (isRunning(pid)) return true
  }
  return false
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 only asks whether the process exists
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM' // exists, owned by someone else
  }
}

/** Looks for a running claude.exe whose command line names this session. */
export function isHeldByRunningProcess(sessionId: string): Promise<boolean> {
  if (!SESSION_ID.test(sessionId)) return Promise.resolve(true)
  const script =
    '(Get-CimInstance Win32_Process -Filter "Name=\'claude.exe\'" | ' +
    `Where-Object { $_.CommandLine -like '*${sessionId}*' } | Measure-Object).Count`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 20_000 },
      (error, stdout) => {
        // If we cannot tell, assume held: refusing is safer than two writers on one thread.
        if (error) resolve(true)
        else resolve(Number.parseInt(stdout.trim() || '0', 10) > 0)
      },
    )
  })
}
