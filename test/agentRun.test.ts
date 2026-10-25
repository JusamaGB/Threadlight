import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it } from 'vitest'

import type { AgentState } from '../src/shared/agent'
import { AgentRun, readable, toolLabel } from '../src/main/agent/agentRun'

/** A stand-in for claude.exe: what Threadlight writes, and a way to make it say things. */
function fakeClaude() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => true })
  const written: unknown[] = []
  stdin.setEncoding('utf8').on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter(Boolean)) written.push(JSON.parse(line))
  })
  const say = (message: object) => stdout.write(`${JSON.stringify(message)}\n`)
  return { child, written, say }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

let fake: ReturnType<typeof fakeClaude>
let states: AgentState[]
let run: AgentRun
let args: string[]
const latest = () => states[states.length - 1]!

beforeEach(() => {
  fake = fakeClaude()
  states = []
  run = new AgentRun({
    cli: { command: 'claude.exe', prefixArgs: [] },
    workspace: 'agent',
    model: 'claude-haiku-5-5',
    onChange: (state) => states.push(state),
    start: (_command, argv) => {
      args = argv
      return fake.child as never
    },
  })
})

const canUse = (id: string, tool: string, input: object) => ({
  type: 'control_request',
  request_id: id,
  request: { subtype: 'can_use_tool', tool_name: tool, input },
})

describe('AgentRun', () => {
  it('starts Claude Code on the two-way stream, answering permissions itself', async () => {
    expect(run.send('Find my next meeting')).toEqual({ ok: true })
    await settle()
    expect(args).toEqual(
      expect.arrayContaining([
        '--input-format',
        'stream-json',
        '--permission-prompt-tool',
        'stdio',
      ]),
    )
    expect(fake.written[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'Find my next meeting' },
    })
    expect(latest()).toMatchObject({
      status: 'working',
      items: [{ kind: 'you', text: 'Find my next meeting' }],
    })
  })

  it('lets a reading tool run at once, and holds anything else for approval', async () => {
    run.send('Reply to Sam')
    fake.say(canUse('r1', 'mcp__claude_ai_Gmail__search_threads', { query: 'from:sam' }))
    await settle()
    expect(fake.written[1]).toMatchObject({
      type: 'control_response',
      response: { request_id: 'r1', response: { behavior: 'allow' } },
    })

    fake.say(
      canUse('r2', 'mcp__claude_ai_Gmail__send_message', { to: 'sam@example.com', body: 'Hi' }),
    )
    await settle()
    expect(fake.written).toHaveLength(2) // nothing sent yet
    expect(latest()).toMatchObject({
      status: 'waiting',
      approval: {
        id: 'r2',
        title: 'Gmail · send message',
        detail: 'to: sam@example.com\nbody: Hi',
      },
    })

    run.decide('r2', false)
    await settle()
    expect(fake.written[2]).toMatchObject({
      response: { request_id: 'r2', response: { behavior: 'deny' } },
    })
    expect(latest()).toMatchObject({ status: 'working', approval: null })
  })

  it('shows steps and replies live, ends the turn ready for a follow-up in the same run', async () => {
    run.send('Summarise my inbox')
    fake.say({ type: 'system', subtype: 'task_summary', detail: 'Reading your inbox' })
    fake.say({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp__claude_ai_Gmail__search_threads',
            input: { description: 'Searching mail' },
          },
          { type: 'text', text: 'Three new threads.' },
        ],
      },
    })
    await settle()
    expect(latest().progress).toBe('Reading your inbox')
    fake.say({ type: 'result', total_cost_usd: 0.02, result: 'Three new threads.' })
    await settle()
    expect(latest()).toMatchObject({
      status: 'ready',
      progress: null,
      costUsd: 0.02,
      items: [
        { kind: 'you', text: 'Summarise my inbox' },
        { kind: 'step', text: 'Searching mail' },
        { kind: 'agent', text: 'Three new threads.' },
      ],
    })
    expect(run.send('Which is most urgent?')).toEqual({ ok: true })
    await settle()
    expect(fake.written.at(-1)).toMatchObject({
      type: 'user',
      message: { content: 'Which is most urgent?' },
    })
  })

  it('refuses a message while busy, and reports a run that stops on its own', async () => {
    run.send('Go')
    expect(run.send('And another').ok).toBe(false)
    fake.child.stderr.write('Not signed in\n')
    await settle()
    fake.child.emit('exit', 1)
    expect(latest()).toMatchObject({ status: 'error', error: 'Not signed in' })
  })

  it('ends the conversation on close, back to idle', () => {
    run.send('Go')
    run.close()
    expect(latest()).toMatchObject({ status: 'idle', items: [] })
  })
})

describe('front desk and worker', () => {
  it('starts with an Opus worker and front-desk instructions to hand work over', async () => {
    run.send('Check my calendar')
    await settle()
    const agents = JSON.parse(args[args.indexOf('--agents') + 1]!)
    expect(agents.worker).toMatchObject({ model: 'opus' })
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('Task tool')
  })

  it('shows a hand-over and the worker’s steps, but not the worker’s own words', async () => {
    run.send('Check my calendar')
    fake.say({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Task', input: { description: 'Read calendar' } }],
      },
    })
    fake.say({
      type: 'assistant',
      parent_tool_use_id: 'toolu_task',
      message: {
        content: [
          { type: 'text', text: 'Let me look at the calendar.' },
          { type: 'tool_use', name: 'mcp__claude_ai_Google_Calendar__list_events', input: {} },
        ],
      },
    })
    fake.say({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Free all afternoon.' }] },
    })
    await settle()
    expect(latest().items).toEqual([
      { kind: 'you', text: 'Check my calendar' },
      { kind: 'step', text: 'Opus · Read calendar' },
      { kind: 'step', text: 'Google Calendar · list events' },
      { kind: 'agent', text: 'Free all afternoon.' },
    ])
  })
})

describe('labels', () => {
  it('names integration tools plainly and lays out their input', () => {
    expect(toolLabel('mcp__claude_ai_Google_Calendar__create_event')).toBe(
      'Google Calendar · create event',
    )
    expect(toolLabel('Bash')).toBe('Bash')
    expect(readable({ to: 'a@b.c', labels: ['x'] })).toBe('to: a@b.c\nlabels: ["x"]')
  })
})
