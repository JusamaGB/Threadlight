import { appendFile } from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { describeTool, TranscriptReader } from '../src/main/sessions/transcript'
import {
  appendTranscript,
  interrupt,
  plan,
  prompt,
  sandbox,
  textReply,
  toolCall,
  toolResult,
  transcriptPath,
  writeTranscript,
  type Sandbox,
} from './helpers'

let box: Sandbox
let file: string

beforeEach(async () => {
  box = await sandbox()
  file = transcriptPath(box.paths, 'demo-project', 'session-a')
})
afterEach(() => box.cleanup())

async function read(records: object[]) {
  await writeTranscript(file, records)
  const reader = new TranscriptReader(file)
  await reader.update()
  return reader.summary()
}

describe('titles', () => {
  it('prefers the custom title, then the agent name, then the first prompt', async () => {
    expect((await read([prompt('Fix the login page')])).title).toBe('Fix the login page')
    expect((await read([prompt('x'), { type: 'agent-name', agentName: 'Agent' }])).title).toBe(
      'Agent',
    )
    expect(
      (
        await read([
          { type: 'agent-name', agentName: 'Agent' },
          { type: 'custom-title', customTitle: 'Docs site' },
        ])
      ).title,
    ).toBe('Docs site')
  })
})

describe('prompts', () => {
  it('ignores tool results, injected reminders and subagent messages', async () => {
    const summary = await read([
      prompt('Real question'),
      toolResult(),
      prompt('<system-reminder>not a prompt</system-reminder>'),
      { ...prompt('subagent chatter'), isSidechain: true },
    ])
    expect(summary.lastPrompt).toBe('Real question')
  })
})

describe('plan replay', () => {
  const items = [
    { content: 'Read the code', status: 'in_progress' },
    { content: 'Write the fix', status: 'pending' },
    { content: 'Run the tests', status: 'pending' },
  ]

  it('tracks the current step through advance, done and start', async () => {
    let summary = await read([prompt('go'), plan({ items })])
    expect(summary.currentStep).toEqual({ index: 1, total: 3, content: 'Read the code' })

    summary = await read([prompt('go'), plan({ items }), plan({ advance: true })])
    expect(summary.currentStep?.content).toBe('Write the fix')
    expect(summary.plan[0]?.status).toBe('completed')

    summary = await read([prompt('go'), plan({ items }), plan({ done: [1, 2], start: 3 })])
    expect(summary.currentStep).toEqual({ index: 3, total: 3, content: 'Run the tests' })
  })

  it('completes the plan and keeps the recap when the turn wraps up', async () => {
    const summary = await read([
      prompt('go'),
      plan({ items }),
      toolCall('mcp__app_turn__wrap_up', { recap: 'Fixed and tested.' }),
    ])
    expect(summary.currentStep).toBeNull()
    expect(summary.plan.every((item) => item.status === 'completed')).toBe(true)
    expect(summary.recap).toBe('Fixed and tested.')
  })

  it('hides a finished plan from an earlier turn', async () => {
    const summary = await read([
      prompt('first'),
      plan({ items }),
      toolCall('mcp__app_turn__wrap_up', { recap: 'done' }),
      prompt('second'),
      textReply('A quick answer.'),
    ])
    expect(summary.plan).toEqual([])
    expect(summary.recap).toBeNull()
    expect(summary.lastReply).toBe('A quick answer.')
  })
})

describe('background tasks', () => {
  const launch = (id: string, name: string, description: string, at: string) => ({
    type: 'assistant',
    timestamp: at,
    message: { content: [{ type: 'tool_use', id, name, input: { description } }] },
  })
  const result = (id: string, text: string, toolUseResult: object = {}) => ({
    type: 'user',
    toolUseResult,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  })
  const notification = (id: string, status: string) => ({
    type: 'queue-operation',
    content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>`,
  })

  it('counts a call as running from launch until its notification', async () => {
    const shell = [
      launch('toolu_a', 'Bash', 'Run the tests', '2026-01-01T10:00:00.000Z'),
      result('toolu_a', 'Command running in background with ID: b1.', {
        backgroundTaskId: 'b1',
      }),
    ]
    const agent = [
      launch('toolu_b', 'Agent', 'Map the code', '2026-01-01T10:01:00.000Z'),
      result('toolu_b', 'Async agent launched successfully.', {
        isAsync: true,
        agentId: 'a1',
      }),
    ]
    expect((await read([...shell, ...agent])).backgroundTasks).toEqual([
      { id: 'toolu_a', label: 'Run the tests', startedAt: Date.parse('2026-01-01T10:00:00.000Z') },
      { id: 'toolu_b', label: 'Map the code', startedAt: Date.parse('2026-01-01T10:01:00.000Z') },
    ])
    const done = await read([...shell, ...agent, notification('toolu_a', 'completed')])
    expect(done.backgroundTasks.map((t) => t.id)).toEqual(['toolu_b'])
  })

  it('times the turn from its prompt, not from each step, for the Now timer', async () => {
    const summary = await read([
      { ...prompt('Do the thing'), timestamp: '2026-01-01T10:00:00Z' },
      launch('toolu_a', 'Read', 'Reading a file', '2026-01-01T10:00:05Z'),
      launch('toolu_b', 'Edit', 'Editing a file', '2026-01-01T10:00:20Z'),
    ])
    expect(summary.lastAction).toBe('Editing a file')
    expect(summary.turnStartedAt).toBe(Date.parse('2026-01-01T10:00:00Z'))
  })

  it('drops a task stopped by hand', async () => {
    const summary = await read([
      launch('toolu_a', 'Bash', 'Serve', '2026-01-01T10:00:00.000Z'),
      result('toolu_a', 'Command running in background with ID: b1.', {
        backgroundTaskId: 'b1',
      }),
      toolCall('TaskStop', { task_id: 'b1' }),
    ])
    expect(summary.backgroundTasks).toEqual([])
  })

  it('ignores foreground calls, even ones whose output mentions the background', async () => {
    const summary = await read([
      launch('toolu_a', 'Bash', 'Grep logs', '2026-01-01T10:00:00.000Z'),
      result('toolu_a', 'log: Command running in background with ID: b9'),
      launch('toolu_b', 'Agent', 'Quick look', '2026-01-01T10:00:00.000Z'),
      result('toolu_b', 'Here is what I found', { status: 'completed', agentId: 'a2' }),
    ])
    expect(summary.backgroundTasks).toEqual([])
  })
})

describe('interrupts', () => {
  it('flags a stopped session until something new happens', async () => {
    const stopped = await read([
      prompt('go'),
      toolCall('Bash', { description: 'Run tests' }),
      interrupt(),
    ])
    expect(stopped.interrupted).toBe(true)
    expect(stopped.lastPrompt).toBe('go') // the marker is not a prompt

    const resumed = await read([prompt('go'), interrupt(), prompt('try again')])
    expect(resumed.interrupted).toBe(false)
  })
})

describe('incremental reading', () => {
  it('reads only new lines, even when a write stops in the middle of a character', async () => {
    await writeTranscript(file, [prompt('first')])
    const reader = new TranscriptReader(file)
    await reader.update()

    const next = Buffer.from(JSON.stringify(prompt('second — with a multi-byte dash')) + '\n')
    const cut = next.indexOf(Buffer.from('—')) + 1 // inside the dash's three UTF-8 bytes
    await appendFile(file, next.subarray(0, cut))
    await reader.update()
    expect(reader.summary().lastPrompt).toBe('first')

    await appendFile(file, next.subarray(cut))
    await reader.update()
    expect(reader.summary().lastPrompt).toBe('second — with a multi-byte dash')
  })

  it('starts over when the file is rewritten shorter', async () => {
    await writeTranscript(file, [prompt('a long original prompt'), textReply('a long reply')])
    const reader = new TranscriptReader(file)
    await reader.update()
    await writeTranscript(file, [prompt('new')])
    await reader.update()
    expect(reader.summary().lastPrompt).toBe('new')
    expect(reader.summary().lastReply).toBeNull()
  })

  it('skips damaged lines', async () => {
    await writeTranscript(file, [prompt('ok')])
    await appendFile(file, '{not json\n')
    await appendTranscript(file, [textReply('still read')])
    const reader = new TranscriptReader(file)
    await reader.update()
    expect(reader.summary().lastReply).toBe('still read')
  })
})

describe('describeTool', () => {
  it('describes common tools briefly', () => {
    expect(describeTool('Bash', { description: 'Run the  tests' })).toBe('Run the tests')
    expect(describeTool('Edit', { file_path: 'C:\\demo\\src\\Panel.tsx' })).toBe(
      'Editing Panel.tsx',
    )
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Searching TODO')
    expect(describeTool('mcp__docs__create_page', {})).toBe('Create page')
  })
})
