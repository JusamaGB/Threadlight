// One agent conversation, hosted the way the Claude app hosts a thread: Threadlight runs the
// user's own Claude Code with a two-way JSON stream, so it sees every step as it happens,
// answers permission requests itself, and sends follow-ups into the same run.
//
//   in:  {"type":"user","message":{...}}            a message from you
//        {"type":"control_response",...}            allow or deny a tool call
//   out: {"type":"assistant",...}                    what it says, and the tools it calls
//        {"type":"system","subtype":"task_summary"}  a short progress line
//        {"type":"control_request","request":{"subtype":"can_use_tool",...}}
//        {"type":"result",...}                       the turn is over (with the cost so far)
//
// The stream format is Claude Code's own (the one its SDK speaks); it is not a public API.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import type { AgentApproval, AgentState } from '../../shared/agent'
import { IDLE_AGENT } from '../../shared/agent'
import type { CliCommand } from '../relay'
import { isObject, oneLine, str, type JsonObject } from '../sessions/json'
import { describeTool } from '../sessions/transcript'

export interface AgentOptions {
  cli: CliCommand
  /** The agent's own folder: its working directory and scratch space. */
  workspace: string
  model: string
  /** Called on every change, with a fresh copy of the state. */
  onChange: (state: AgentState) => void
  /** Starts the process; tests swap in a fake. */
  start?: (command: string, args: string[], cwd: string) => ChildProcessWithoutNullStreams
}

/**
 * Tools that only read run without asking: Claude Code's own read-only ones need no permission
 * at all, and these name an integration's reading tools (Gmail search, Calendar list, …).
 * Anything else that asks (send, delete, create, edit, run a command) comes to you first.
 */
const READS = /^mcp__.+__(search|get|list|read|fetch|find|query|lookup|download)_?/i

/** It asks in plain text instead: a question card would stall a run nobody is watching. */
const DISALLOWED = ['AskUserQuestion']

/**
 * Two roles. The conversation runs on a quick model (the front desk); anything that needs
 * looking up or doing goes to a worker on Opus, which rereads the task, does it properly with
 * the tools and reports back. Small models tend to answer from inference rather than check, so
 * handing over is the rule and answering alone the exception. Every tool call the worker makes
 * still asks Threadlight for permission like any other.
 */
export const WORKER = 'worker'
export const WORKER_MODEL = 'opus'

const FRONT_DESK = [
  "You are the front desk of the user's agent, which they talk to in Threadlight.",
  `Hand every request that needs information you do not already have in this conversation, or needs anything done (searching, reading mail, calendars or files, writing, sending, running commands), to the "${WORKER}" agent with the Task tool.`,
  "Give it the user's request in full, with anything relevant from this conversation. Run it in the foreground (never in the background) and wait for its report, then give the user its result briefly and plainly.",
  'Never guess or answer from memory instead of checking. Answer by yourself only for small talk or questions about this conversation. Use no tools other than Task.',
].join(' ')

const WORKER_PROMPT = [
  "You are the user's worker agent. Reread the task you are given and work out what is really asked.",
  'Plan it (keep a todo list for anything with several steps), do it with the tools you have, check the result, then return a short report of what you found or did.',
  'Never invent facts: look them up. Anything that sends, deletes or changes something asks the user first, in Threadlight; if they deny it, do not try again, and say so in your report.',
].join(' ')

const AGENTS = {
  [WORKER]: {
    description:
      'Does any task that needs looking things up or acting: mail, calendar, files, the web, commands.',
    prompt: WORKER_PROMPT,
    model: WORKER_MODEL,
  },
}

export class AgentRun {
  private state: AgentState = { ...IDLE_AGENT }
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private pending: { id: string; input: JsonObject } | null = null
  private closing = false
  private stderr = ''

  constructor(private readonly options: AgentOptions) {}

  get current(): AgentState {
    return this.state
  }

  /** Sends a message, starting the run first if there is none. */
  send(text: string): { ok: true } | { ok: false; reason: string } {
    const message = text.trim()
    if (!message) return { ok: false, reason: 'Nothing to send.' }
    if (this.state.status === 'working' || this.state.status === 'waiting') {
      return { ok: false, reason: 'It is still working on the last message.' }
    }
    if (!this.child) this.launch()
    this.update({
      status: 'working',
      items: [...this.state.items, { kind: 'you', text: message }],
      error: null,
    })
    this.write({ type: 'user', message: { role: 'user', content: message } })
    return { ok: true }
  }

  /** Allows or denies the tool call waiting for approval. */
  decide(id: string, allowed: boolean): void {
    if (!this.pending || this.pending.id !== id) return
    const { input } = this.pending
    this.pending = null
    this.write(allowed ? allow(id, input) : deny(id))
    this.update({
      status: 'working',
      approval: null,
      items: allowed ? this.state.items : [...this.state.items, { kind: 'step', text: 'Denied' }],
    })
  }

  /** Ends the conversation: the process exits, its transcript stays on disk. */
  close(): void {
    this.closing = true
    this.child?.stdin.end()
    this.child?.kill()
    this.child = null
    this.pending = null
    this.state = { ...IDLE_AGENT }
    this.options.onChange(this.state)
  }

  private launch(): void {
    const { cli, workspace, model } = this.options
    const args = [
      ...cli.prefixArgs,
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      'default',
      '--model',
      model,
      '--agents',
      JSON.stringify(AGENTS),
      '--append-system-prompt',
      FRONT_DESK,
      '--disallowedTools',
      ...DISALLOWED,
    ]
    const start =
      this.options.start ??
      ((command, argv, cwd) =>
        spawn(command, argv, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }))
    const child = start(cli.command, args, workspace)
    this.child = child
    this.closing = false
    this.stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => this.read(chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000)
    })
    child.on('error', (error) => this.stopped(`Could not start Claude: ${error.message}`))
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      if (!this.closing)
        this.stopped(oneLine(this.stderr).slice(-200) || `Claude exited (${code}).`)
    })
    this.update({ status: 'starting' })
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      newline = this.buffer.indexOf('\n')
      if (!line) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (isObject(message)) this.handle(message)
    }
  }

  private handle(message: JsonObject): void {
    switch (message['type']) {
      case 'system':
        if (message['subtype'] === 'task_summary') {
          this.update({ progress: str(message['detail']) })
        }
        break
      case 'assistant':
        this.assistant(message)
        break
      case 'control_request':
        this.permission(message)
        break
      case 'result': {
        const cost = message['total_cost_usd']
        this.update({
          status: 'ready',
          progress: null,
          costUsd: typeof cost === 'number' ? cost : this.state.costUsd,
          ...(message['is_error'] === true && { error: str(message['result']) }),
        })
        break
      }
    }
  }

  /**
   * What it says and does. The worker's own messages (they carry the hand-over's id) show only
   * as steps: its report reaches you through the front desk.
   */
  private assistant(message: JsonObject): void {
    const body = message['message']
    const content = isObject(body) && Array.isArray(body['content']) ? body['content'] : []
    const fromWorker = str(message['parent_tool_use_id']) !== null
    const items = [...this.state.items]
    for (const block of content.filter(isObject)) {
      if (block['type'] === 'text' && !fromWorker) {
        const text = str(block['text'])?.trim()
        if (text) items.push({ kind: 'agent', text })
      } else if (block['type'] === 'tool_use') {
        const name = str(block['name']) ?? ''
        const input = isObject(block['input']) ? block['input'] : {}
        items.push({ kind: 'step', text: stepText(name, input) })
      }
    }
    if (items.length !== this.state.items.length) this.update({ items })
  }

  /** A tool asks for permission: reading runs straight away, anything else waits for you. */
  private permission(message: JsonObject): void {
    const id = str(message['request_id'])
    const request = message['request']
    if (!id || !isObject(request) || request['subtype'] !== 'can_use_tool') return
    const name = str(request['tool_name']) ?? ''
    const input = isObject(request['input']) ? request['input'] : {}
    if (READS.test(name)) {
      this.write(allow(id, input))
      return
    }
    this.pending = { id, input }
    const approval: AgentApproval = { id, title: toolLabel(name), detail: readable(input) }
    this.update({ status: 'waiting', approval })
  }

  private stopped(reason: string): void {
    this.child = null
    this.pending = null
    this.update({ status: 'error', approval: null, progress: null, error: reason })
  }

  private write(message: object): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private update(change: Partial<AgentState>): void {
    this.state = { ...this.state, ...change }
    this.options.onChange(this.state)
  }
}

function allow(id: string, input: JsonObject): object {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: id,
      response: { behavior: 'allow', updatedInput: input },
    },
  }
}

/** One step as the agent view lists it; a hand-over says who takes it. */
function stepText(name: string, input: JsonObject): string {
  if (name === 'Task' || name === 'Agent') {
    return `Opus · ${oneLine(str(input['description']) ?? 'working on it')}`
  }
  if (name === 'ToolSearch') return 'Finding the right tools'
  return describeTool(toolLabel(name), input)
}

function deny(id: string): object {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: id,
      response: { behavior: 'deny', message: 'The user denied this in Threadlight.' },
    },
  }
}

/** "mcp__claude_ai_Gmail__send_message" → "Gmail · send message"; built-in tools stay as named. */
export function toolLabel(name: string): string {
  const parts = name.split('__')
  if (parts[0] !== 'mcp' || parts.length < 3) return name
  const server = (parts[1] ?? '').replace(/^claude_ai_/, '').replaceAll('_', ' ')
  return `${server} · ${(parts.slice(2).join(' ') || '').replaceAll('_', ' ')}`
}

/** A call's input as a few readable lines: "to: …", "subject: …"; long values are cut short. */
export function readable(input: JsonObject): string {
  return Object.entries(input)
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      return `${key}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`
    })
    .join('\n')
}
