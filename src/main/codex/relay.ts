import type { MemoryDeliveryContext } from '../../shared/memory'
import { spawn } from 'node:child_process'
import { access, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RelayStatus, Session } from '../../shared/types'
import type { CodexPaths } from '../sessions/paths'
import { MAX_MESSAGE_LENGTH, type CliCommand, type RelayResult } from '../relay'
import { codexId } from './identity'
import { codexHeld } from './live'
import { CODEX_DESKTOP_UNAVAILABLE } from '../../shared/messaging'

export async function findCodexCli(paths: CodexPaths): Promise<CliCommand | null> {
  try {
    const candidates = await Promise.all(
      (await readdir(paths.cliRoot)).map(async (name) => {
        const path = join(paths.cliRoot, name, 'codex.exe')
        try {
          await access(path)
          return { path, at: (await stat(path)).mtimeMs }
        } catch {
          return null
        }
      }),
    )
    const latest = candidates.filter((c) => c !== null).sort((a, b) => b.at - a.at)[0]
    if (latest) return { command: latest.path, prefixArgs: [] }
  } catch {
    /* app-managed CLI unavailable */
  }
  // The Windows npm shim is a shell script. Never execute it through a shell with user text.
  for (const path of (process.env['PATH'] || '').split(';')) {
    if (!path) continue
    try {
      const command = join(path, 'codex.exe')
      await access(command)
      return { command, prefixArgs: [] }
    } catch {
      /* next */
    }
  }
  return null
}

export function codexRelayArgs(session: Pick<Session, 'id' | 'model'>): string[] {
  const id = codexId(session.id)
  if (!id) throw new Error('Invalid Codex chat')
  const args = ['exec', 'resume', '--skip-git-repo-check', '--json', id, '-']
  if (session.model && /^[a-z0-9][a-z0-9.-]{0,100}$/i.test(session.model))
    args.splice(2, 0, '--model', session.model)
  return args
}

/** Replace this server's whole invocation config so old static headers cannot override the task token. */
export function codexMemoryArgs(memory?: Pick<MemoryDeliveryContext, 'url'>): string[] {
  return memory
    ? [
        '-c',
        `mcp_servers.threadlight={url=${JSON.stringify(memory.url)},bearer_token_env_var="THREADLIGHT_MEMORY_TOKEN",default_tools_approval_mode="approve"}`,
      ]
    : []
}

export function interpretCodexOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): RelayResult {
  if (/already has an active writer|thread-store conflict/i.test(stderr))
    return {
      ok: false,
      reason: 'Codex has this chat open. Copy your message and open it in Codex.',
    }
  let completed = false,
    reply = '',
    failure = ''
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line) as {
        type?: string
        item?: { type?: string; text?: string; message?: string }
        error?: { message?: string }
        message?: string
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message')
        reply = event.item.text || reply
      if (event.type === 'turn.completed') completed = true
      if (event.type === 'turn.failed' || event.type === 'error')
        failure = event.error?.message || event.message || 'Codex could not complete this turn.'
    } catch {
      /* incomplete/non-JSON diagnostic */
    }
  }
  return exitCode === 0 && completed && !failure
    ? { ok: true, reply }
    : {
        ok: false,
        reason:
          failure ||
          stderr.trim().slice(-600) ||
          'Codex did not confirm completion. Check the chat before trying again.',
      }
}

export async function sendCodex(
  session: Pick<Session, 'id' | 'cwd' | 'model' | 'live'>,
  text: string,
  cli: CliCommand | null,
  isHeld: () => Promise<boolean>,
  onSent: () => void,
  memory?: MemoryDeliveryContext,
): Promise<RelayResult> {
  if (!codexId(session.id)) return { ok: false, reason: 'Invalid Codex chat.' }
  if (!text.trim() || text.length > MAX_MESSAGE_LENGTH)
    return { ok: false, reason: `Enter a message up to ${MAX_MESSAGE_LENGTH} characters.` }
  if (!cli) return { ok: false, reason: 'Codex CLI was not found on this PC.' }
  if (await isHeld())
    return {
      ok: false,
      reason: 'Codex has this chat open. Copy your message and open it in Codex.',
    }
  return new Promise((resolve) => {
    const env = { ...process.env }
    // Do not borrow the executor identity of a process which happened to launch Threadlight.
    for (const key of ['CODEX_THREAD_ID', 'CODEX_TURN_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'])
      delete env[key]
    if (memory) env['THREADLIGHT_MEMORY_TOKEN'] = memory.token
    const memoryArgs = codexMemoryArgs(memory)
    const child = spawn(
      cli.command,
      [...cli.prefixArgs, ...memoryArgs, ...codexRelayArgs(session)],
      {
        cwd: session.cwd,
        windowsHide: true,
        shell: false,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = '',
      stderr = '',
      settled = false,
      accepted = false,
      observedThread: string | undefined,
      pending = ''
    const finish = (result: RelayResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({
        ok: false,
        reason:
          'No reply within 30 minutes. Check Codex before retrying; the message may have been accepted.',
      })
    }, 30 * 60_000)
    child.stdin.on('error', () => {})
    child.once('spawn', () => child.stdin.end(text.trim()))
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-2 * 1024 * 1024)
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      for (const line of lines) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'thread.started') observedThread = event.thread_id
          if (
            !accepted &&
            event.type === 'turn.started' &&
            observedThread === codexId(session.id)
          ) {
            accepted = true
            onSent()
          }
        } catch {
          /* partial diagnostics */
        }
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-32 * 1024)
    })
    child.once('error', (error) =>
      finish({ ok: false, reason: `Could not start Codex: ${error.message}` }),
    )
    child.once('close', (code) => {
      const result = interpretCodexOutput(stdout, stderr, code)
      finish(
        result.ok && observedThread !== codexId(session.id)
          ? {
              ok: false,
              reason:
                'Codex did not confirm the requested chat identity. Check the native chat; do not resend blindly.',
            }
          : result,
      )
    })
  })
}

export class CodexRelayService {
  private statuses = new Map<string, RelayStatus>()
  constructor(
    private readonly paths: CodexPaths,
    private readonly lookup: (
      id: string,
    ) => Pick<Session, 'id' | 'cwd' | 'model' | 'live'> | undefined,
    private readonly changed: () => void,
  ) {}
  list(): RelayStatus[] {
    return [...this.statuses.values()]
  }
  send(
    id: string,
    text: string,
    memory?: MemoryDeliveryContext,
    receiptId?: string,
  ): { ok: true } | { ok: false; reason: string } {
    const target = this.lookup(id)
    if (!target) return { ok: false, reason: 'That Codex chat is no longer listed.' }
    if (target.live) return { ok: false, reason: CODEX_DESKTOP_UNAVAILABLE }
    if (['sending', 'sent'].includes(this.statuses.get(id)?.state || ''))
      return { ok: false, reason: 'Still waiting for the last reply.' }
    if (!text.trim() || text.length > MAX_MESSAGE_LENGTH)
      return { ok: false, reason: `Enter a message up to ${MAX_MESSAGE_LENGTH} characters.` }
    this.update(id, 'sending', '', memory?.attemptId ?? receiptId)
    void findCodexCli(this.paths)
      .then((cli) =>
        sendCodex(
          target,
          text,
          cli,
          () => codexHeld(this.paths.locks, codexId(id)!),
          () => this.update(id, 'sent', '', memory?.attemptId ?? receiptId),
          memory,
        ),
      )
      .then((result) =>
        this.update(
          id,
          result.ok ? 'replied' : 'failed',
          result.ok ? result.reply : result.reason,
          memory?.attemptId ?? receiptId,
        ),
      )
      .catch((error) => this.update(id, 'failed', String(error), memory?.attemptId ?? receiptId))
    return { ok: true }
  }
  private update(
    sessionId: string,
    state: RelayStatus['state'],
    detail: string,
    attemptId?: string,
  ): void {
    this.statuses.set(sessionId, { sessionId, state, detail, at: Date.now(), attemptId })
    this.changed()
  }
}
