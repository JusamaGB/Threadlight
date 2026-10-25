import { describe, expect, it } from 'vitest'

import { stepActivity } from '../src/main/sessions/stepActivity'
import { replayPlan } from '../src/main/sessions/transcript'
import { fileRows } from '../src/shared/stepFiles'

let clock = 0
/** One transcript line: an assistant block in message `id`, or a tool result. */
const assistant = (id: string, block: object) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(Date.UTC(2026, 9, 25, 12, 0, clock++)).toISOString(),
    message: { id, content: [block] },
  })
const tool = (id: string, name: string, input: object, useId = `${id}-${name}`) =>
  assistant(id, { type: 'tool_use', id: useId, name, input })
const say = (id: string, text: string) => assistant(id, { type: 'text', text })
const result = (useId: string, text: string, isError = false) =>
  JSON.stringify({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: useId, content: text, is_error: isError }],
    },
  })
const plan = (items: [string, string][]) => ({
  items: items.map(([content, status]) => ({ content, status })),
})
const PLAN = 'mcp__ccd_turn__update_plan'

const transcript = [
  // The plan goes out with the first step's first call, as threads are told to.
  tool(
    'm1',
    PLAN,
    plan([
      ['Read the code', 'in_progress'],
      ['Fix the bug', 'pending'],
    ]),
  ),
  tool('m1', 'Read', { file_path: 'Z:/repo/src/a.ts' }),
  say('m2', 'The bug is in a.ts.'),
  // Advancing rides along with the next step's first edit, in one message.
  say('m3', 'Fixing it now.'),
  tool('m3', PLAN, { advance: true }),
  tool('m3', 'Edit', { file_path: 'Z:/repo/src/a.ts', old_string: 'a\nb', new_string: 'c' }),
  tool('m4', 'Bash', { command: 'npm test', description: 'Run the tests' }, 'bash-1'),
  result('bash-1', 'Exit code 1\n1 failed'),
  tool('m5', 'Edit', { file_path: 'Z:\\repo\\src\\A.ts', old_string: 'c', new_string: 'd\ne' }),
  tool('m6', 'Bash', { command: 'npm test' }, 'bash-2'),
  result('bash-2', 'all passed'),
  tool('m7', 'mcp__ccd_turn__wrap_up', { recap: 'Fixed.' }),
  tool('m8', 'Grep', { pattern: 'after the plan' }),
]

describe('step activity', () => {
  it('gives each step what was done while it was in progress', () => {
    const read = stepActivity(transcript, 'Read the code')
    expect(read.tools).toEqual([{ name: 'Read', count: 1 }])
    expect(read.said).toEqual(['The bug is in a.ts.'])
    expect(read.files).toEqual([])
    expect(read.startedAt).not.toBeNull()
    expect(read.endedAt).toBeGreaterThan(read.startedAt!)
  })

  it('takes the rest of the advancing message along, and adds up edits to one file', () => {
    const fix = stepActivity(transcript, 'Fix the bug')
    expect(fix.said).toEqual(['Fixing it now.'])
    expect(fix.files).toEqual([{ path: 'Z:/repo/src/a.ts', added: 3, removed: 3 }])
    expect(fix.commands).toEqual([
      { label: 'Run the tests', command: 'npm test', failed: true },
      { label: 'npm test', command: 'npm test', failed: false },
    ])
    expect(fix.tools).toEqual([]) // the Grep came after the wrap-up
    expect(fix.endedAt).not.toBeNull()
  })

  it('keeps a step’s history when the list is sent again, and knows nothing of other steps', () => {
    const again = [
      ...transcript.slice(0, 2),
      tool(
        'm9',
        PLAN,
        plan([
          ['Read the code', 'in_progress'],
          ['Fix the bug', 'pending'],
        ]),
      ),
      tool('m9', 'Glob', { pattern: '*.ts' }),
    ]
    expect(stepActivity(again, 'Read the code').tools).toEqual([
      { name: 'Read', count: 1 },
      { name: 'Glob', count: 1 },
    ])
    expect(stepActivity(again, 'Ship it')).toMatchObject({ startedAt: null, files: [], said: [] })
  })

  it('shows a command still running as neither passed nor failed', () => {
    const running = [
      tool('m1', PLAN, plan([['Build', 'in_progress']])),
      tool('m2', 'PowerShell', { command: 'npm run build' }, 'ps-1'),
    ]
    expect(stepActivity(running, 'Build').commands).toEqual([
      { label: 'npm run build', command: 'npm run build', failed: null },
    ])
  })
})

describe('planned files', () => {
  it('reads files and why from a plan item, and leaves them out when not given', () => {
    const steps = replayPlan([], {
      items: [
        { content: 'Fix it', status: 'pending', files: ['src/a.ts', '', 3], why: ' The   bug ' },
        { content: 'Ship it', status: 'pending' },
      ],
    })
    expect(steps).toEqual([
      { content: 'Fix it', status: 'pending', files: ['src/a.ts'], why: 'The bug' },
      { content: 'Ship it', status: 'pending' },
    ])
  })

  it('matches planned files to changed ones, then lists changes nobody planned', () => {
    const rows = fileRows(
      ['src/a.ts', './src/b.ts', 'src\\A.ts'],
      [
        { path: 'Z:\\repo\\src\\a.ts', added: 2, removed: 1 },
        { path: 'Z:/repo/README.md', added: 1, removed: 0 },
      ],
      'Z:\\repo',
    )
    expect(rows).toEqual([
      { path: 'Z:\\repo\\src\\a.ts', planned: true, changed: { added: 2, removed: 1 } },
      { path: 'Z:/repo/src/b.ts', planned: true, changed: null },
      { path: 'Z:/repo/README.md', planned: false, changed: { added: 1, removed: 0 } },
    ])
  })
})
