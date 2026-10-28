import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyStreamPatches, projectStream } from '../src/main/codex/threadStreamState'
import { followCodexThread, type StreamUpdate } from '../src/main/codex/threadStream'
import type { StreamingDesktopConnection } from '../src/main/codex/desktopConnection'

const id = '11111111-1111-4111-8111-111111111111'
const turn = (text: string) => ({
  turnId: 'turn',
  status: 'inProgress',
  completedItemIds: { user: true },
  items: [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Fix the loading state' }] },
    { id: 'reason', type: 'reasoning', summary: ['PRIVATE'] },
    { id: 'message', type: 'agentMessage', phase: 'commentary', text },
  ],
})
const snapshot = (text = 'Checking') => ({
  id,
  turns: [],
  turnHistory: {
    kind: 'canonical',
    history: {
      // Deliberately reverse dictionary order: island entries are authoritative.
      entitiesByKey: {
        tail: turn(text),
        first: {
          turnId: 'first',
          status: 'completed',
          items: [
            { id: 'old', type: 'agentMessage', phase: 'final_answer', text: 'Earlier reply' },
          ],
        },
      },
      islands: [{ entries: [{ value: 'first' }, { value: 'tail' }] }],
      isComplete: true,
    },
  },
})
afterEach(() => vi.useRealTimers())

it('orders canonical history, preserves IDs and omits private reasoning and instructions', () => {
  const items = projectStream(snapshot())
  expect(items.map((item) => item.id)).toEqual(['old', 'user', 'message'])
  expect(items.at(-1)).toMatchObject({ text: 'Checking', phase: 'progress', complete: false })
  expect(JSON.stringify(items)).not.toContain('PRIVATE')
  const state = snapshot()
  state.turnHistory.history.entitiesByKey.tail.completedItemIds = { user: true, message: true } as {
    user: boolean
  }
  expect(projectStream(state).at(-1)?.complete).toBe(true)
})

it('applies text updates and array edits atomically without mutating the previous state', () => {
  const initial = snapshot()
  const prefix = ['turnHistory', 'history', 'entitiesByKey', 'tail', 'items']
  const updated = applyStreamPatches(initial, [
    { op: 'replace', path: [...prefix, 2, 'text'], value: 'Checking the cursor' },
    {
      op: 'add',
      path: [...prefix, 3],
      value: {
        id: 'tool',
        type: 'commandExecution',
        command: 'npm test',
        status: 'completed',
        exitCode: 0,
      },
    },
  ])
  expect(projectStream(initial).at(-1)?.text).toBe('Checking')
  expect(projectStream(updated).map((item) => item.id)).toEqual(['old', 'user', 'message', 'tool'])
  expect(projectStream(updated).at(-1)?.detail).toContain('Exit code: 0')
  const removed = applyStreamPatches(updated, [{ op: 'remove', path: [...prefix, 3] }])
  expect(projectStream(removed).at(-1)?.text).toBe('Checking the cursor')
  expect(() =>
    applyStreamPatches(initial, [
      { op: 'replace', path: [...prefix, 2, 'text'], value: 'Partial' },
      { op: 'replace', path: ['missing', 'x'], value: 1 },
    ]),
  ).toThrow()
  expect(projectStream(initial).at(-1)?.text).toBe('Checking')
})

it('rejects prototype traversal, invalid paths and invalid array indices', () => {
  for (const path of [
    ['__proto__', 'polluted'],
    ['constructor', 'prototype'],
    ['turns', -1],
    ['turns', 10],
  ])
    expect(() => applyStreamPatches(snapshot(), [{ op: 'add', path, value: true }])).toThrow()
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

function connection() {
  const broadcasts = new Set<(m: Record<string, unknown>) => void>()
  const closed = new Set<() => void>()
  const client: StreamingDesktopConnection = {
    request: vi.fn(async () => ({ resultType: 'success', handledByClientId: 'owner' })),
    broadcast: vi.fn(),
    close: vi.fn(),
    onBroadcast: (f) => {
      broadcasts.add(f)
      return () => {
        broadcasts.delete(f)
      }
    },
    onClose: (f) => {
      closed.add(f)
      return () => {
        closed.delete(f)
      }
    },
  }
  return {
    client,
    emit: (change: unknown, other = {}) =>
      broadcasts.forEach((f) =>
        f({
          type: 'broadcast',
          sourceClientId: 'owner',
          method: 'thread-stream-state-changed',
          version: 11,
          params: { hostId: 'local', conversationId: id, change },
          ...other,
        }),
      ),
    disconnect: () => [...closed].forEach((f) => f()),
  }
}

describe('native follower lifecycle', () => {
  it('follows only the chosen owner and recovers a revision gap with a new snapshot', async () => {
    vi.useFakeTimers()
    const first = connection(),
      second = connection(),
      changes: StreamUpdate[] = []
    const connect = vi.fn().mockResolvedValueOnce(first.client).mockResolvedValue(second.client)
    const stop = followCodexThread(id, (value) => changes.push(value), connect)
    await vi.advanceTimersByTimeAsync(0)
    expect(first.client.broadcast).toHaveBeenCalledWith(
      'thread-stream-following-changed',
      { hostId: 'local', conversationId: id, following: true },
      1,
      ['owner'],
    )
    first.emit(
      { type: 'snapshot', revision: 4, conversationState: snapshot('Wrong owner') },
      { sourceClientId: 'stranger' },
    )
    await vi.advanceTimersByTimeAsync(60)
    expect(changes).toHaveLength(0)
    first.emit({ type: 'snapshot', revision: 4, conversationState: snapshot() })
    await vi.advanceTimersByTimeAsync(60)
    expect(changes.at(-1)).toMatchObject({ connection: 'live' })
    first.emit({ type: 'patches', baseRevision: 2, revision: 5, patches: [] })
    expect(changes.at(-1)).toMatchObject({ connection: 'reconnecting' })
    await vi.advanceTimersByTimeAsync(1001)
    second.emit({ type: 'snapshot', revision: 9, conversationState: snapshot('Recovered') })
    await vi.advanceTimersByTimeAsync(60)
    expect(changes.at(-1)).toMatchObject({
      connection: 'live',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'message', text: 'Recovered' }),
      ]),
    })
    stop()
    expect(second.client.broadcast).toHaveBeenLastCalledWith(
      'thread-stream-following-changed',
      { hostId: 'local', conversationId: id, following: false },
      1,
      ['owner'],
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('reconnects on socket loss and cancels a connection that resolves after closing', async () => {
    vi.useFakeTimers()
    const one = connection(),
      two = connection()
    let resolve!: (client: StreamingDesktopConnection) => void
    const connect = vi
      .fn()
      .mockResolvedValueOnce(one.client)
      .mockImplementation(
        () =>
          new Promise<StreamingDesktopConnection>((done) => {
            resolve = done
          }),
      )
    const stop = followCodexThread(id, () => {}, connect)
    await vi.advanceTimersByTimeAsync(0)
    one.disconnect()
    await vi.advanceTimersByTimeAsync(1001)
    stop()
    resolve(two.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(two.client.close).toHaveBeenCalled()
    expect(two.client.broadcast).not.toHaveBeenCalled()
  })

  it('rejects incompatible stream versions and never sends mutating requests', async () => {
    vi.useFakeTimers()
    const conn = connection(),
      changed = vi.fn()
    const stop = followCodexThread(id, changed, async () => conn.client)
    await vi.advanceTimersByTimeAsync(0)
    conn.emit({ type: 'snapshot', revision: 1, conversationState: snapshot() }, { version: 12 })
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ connection: 'reconnecting' }))
    expect(conn.client.request).toHaveBeenCalledTimes(1)
    expect(conn.client.request).toHaveBeenCalledWith(
      'thread-owner-discovery',
      { hostId: 'local', conversationId: id },
      1,
    )
    stop()
  })
})

it('projects native activity titles, command output and compaction without summary bodies', () => {
  const items = projectStream({
    turns: [
      {
        turnId: 'native',
        status: 'inProgress',
        items: [
          {
            id: 'heading',
            type: 'reasoning',
            summary: ['**Updating caret visibility**\nBODY MUST STAY PRIVATE'],
            content: ['RAW CONTENT'],
          },
          {
            id: 'tool',
            type: 'mcpToolCall',
            server: 'node_repl',
            tool: 'js',
            arguments: { title: 'Inspect Threadlight activity', code: 'PRIVATE ARGS' },
            status: 'inProgress',
          },
          {
            id: 'command',
            type: 'commandExecution',
            command: 'npm test',
            aggregatedOutput: '31 tests passed',
            status: 'completed',
            exitCode: 0,
          },
          { id: 'compact', type: 'contextCompaction', completed: true, source: 'automatic' },
          {
            id: 'raw',
            type: 'reasoning',
            summary: ['Unstructured body'],
            content: ['RAW CONTENT'],
          },
        ],
      },
    ],
  })
  expect(items.map((i) => i.text)).toEqual([
    'Updating caret visibility',
    'Inspect Threadlight activity',
    'Ran npm test',
    'Context automatically compacted',
  ])
  expect(items[0]).toMatchObject({ activity: 'status', complete: false })
  expect(items[2]?.detail).toContain('31 tests passed')
  expect(items[3]).toMatchObject({ activity: 'compaction', complete: true })
  expect(JSON.stringify(items)).not.toMatch(/PRIVATE|RAW CONTENT|Unstructured body/)
})
