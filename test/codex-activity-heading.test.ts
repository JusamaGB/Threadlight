import { expect, it } from 'vitest'
import { applyStreamPatches, projectStream } from '../src/main/codex/threadStreamState'
import { summarizeCodex } from '../src/main/codex/tracker'
import { liveThreadActivity } from '../src/shared/threadActivity'

const heading = {
  id: 'heading',
  type: 'reasoning',
  summary: ['**Updating thread-view click helper**\nPRIVATE BODY'],
  content: ['PRIVATE CONTENT'],
}
const command = { id: 'cmd', type: 'commandExecution', command: 'npm test', status: 'completed' }
const state = (items: Record<string, unknown>[]) => ({
  turns: [{ turnId: 'turn', status: 'inProgress', items }],
})
function label(input: Record<string, unknown>) {
  return liveThreadActivity(
    { id: 'codex:test', state: 'working', turnStartedAt: null },
    {
      threadId: 'codex:test',
      revision: 1,
      connection: 'live',
      hasMore: false,
      loadingOlder: false,
      items: projectStream(input),
    },
  )
}

it.each([
  command,
  { id: 'edit', type: 'fileChange', status: 'inProgress', changes: [] },
  { id: 'tool', type: 'mcpToolCall', server: 'test', tool: 'run', arguments: {} },
  { id: 'function', type: 'functionCall', name: 'functions.exec' },
  { id: 'image', type: 'imageView', path: 'example.png' },
])('keeps a public heading through its following $type action', (action) => {
  const input = state([heading, action])
  expect(label(input)).toBe('Updating thread-view click helper')
  expect(JSON.stringify(projectStream(input))).not.toContain('PRIVATE')
  if (action === command) expect(projectStream(input).at(-1)?.detail).toContain('npm test')
})

it.each(['title', 'description'])(
  'prefers an explicit MCP %s over the broader heading',
  (field) => {
    expect(
      label(
        state([
          heading,
          { id: 'mcp', type: 'mcpToolCall', arguments: { [field]: 'Inspecting the click target' } },
        ]),
      ),
    ).toBe('Inspecting the click target')
  },
)

it('replaces a finished command while a new heading streams, then follows heading patches', () => {
  let input = state([
    heading,
    command,
    { id: 'next', type: 'reasoning', summary: [], content: ['PRIVATE CONTENT'] },
  ])
  expect(label(input)).toBe('Working…')
  input = applyStreamPatches(input, [
    { op: 'add', path: ['turns', 0, 'items', 2, 'summary', 0], value: '**Checking voice' },
  ]) as typeof input
  expect(label(input)).toBe('Working…')
  input = applyStreamPatches(input, [
    {
      op: 'replace',
      path: ['turns', 0, 'items', 2, 'summary', 0],
      value: '**Checking voice route scope**\nPRIVATE BODY',
    },
  ]) as typeof input
  expect(label(input)).toBe('Checking voice route scope')
  expect(JSON.stringify(projectStream(input))).not.toContain('PRIVATE')
})

it.each([
  { id: 'new-reason', type: 'reasoning', summary: [] },
  { id: 'message', type: 'agentMessage', phase: 'commentary', text: 'A different step' },
  { id: 'user', type: 'userMessage', content: [{ type: 'input_text', text: 'A new request' }] },
  { id: 'compact', type: 'contextCompaction', completed: true },
])('does not carry an old heading across $type boundaries', (boundary) => {
  expect(label(state([heading, boundary, command]))).toBe('Ran tests')
})

it('does not carry headings across turns or leave generic placeholders in completed history', () => {
  const previous = { turnId: 'old', status: 'completed', items: [heading] }
  expect(label({ turns: [previous, ...state([command]).turns] })).toBe('Ran tests')
  expect(
    projectStream({
      turns: [
        {
          turnId: 'done',
          status: 'completed',
          items: [{ id: 'empty', type: 'reasoning', summary: [], content: ['PRIVATE'] }],
        },
      ],
    }),
  ).toEqual([])
})

it('uses the same public heading in saved-history status and clears it for the next activity', () => {
  expect(summarizeCodex([heading, command]).lastAction).toBe('Updating thread-view click helper')
  expect(
    summarizeCodex([heading, command, { type: 'reasoning', summary: [] }]).lastAction,
  ).toBeNull()
  expect(
    summarizeCodex([
      heading,
      { type: 'reasoning', summary: ['Unstructured PRIVATE BODY'] },
      command,
    ]).lastAction,
  ).toBe('Running tests')
})
