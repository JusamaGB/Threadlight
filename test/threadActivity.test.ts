import { expect, it } from 'vitest'
import { conversationRows, activitySummary, liveThreadActivity } from '../src/shared/threadActivity'
import type { ThreadTimeline, TimelineItem } from '../src/shared/threadTimeline'
const item = (
  id: string,
  activity: TimelineItem['activity'] = 'command',
  extra: Partial<TimelineItem> = {},
): TimelineItem => ({
  id,
  text: `Ran ${id}`,
  activity,
  role: 'activity',
  kind: 'tool',
  phase: 'progress',
  at: null,
  turnId: 'turn',
  complete: true,
  source: 'test',
  ...extra,
})
it('groups adjacent actions without crossing messages, turns or compaction', () => {
  const rows = conversationRows([
    item('a'),
    item('b'),
    item('comment', undefined, { role: 'assistant', kind: 'message' }),
    item('c'),
    item('compact', 'compaction'),
    item('d'),
    item('e', 'command', { turnId: 'next' }),
  ])
  expect(rows.map((r) => r.id)).toEqual(['a', 'comment', 'c', 'compact', 'd', 'e'])
  expect(rows[0]).toMatchObject({ type: 'activity', items: [{ id: 'a' }, { id: 'b' }] })
})
it('uses the native active label, then a completed summary with stable identity', () => {
  const heading = item('heading', 'status', { text: 'Updating caret visibility', complete: false })
  expect(activitySummary([heading], true)).toBe('Updating caret visibility')
  const items = [
    { ...heading, complete: true },
    item('load', 'loaded-tool'),
    item('edit', 'files'),
    item('test'),
    item('types'),
  ]
  expect(activitySummary(items, false)).toBe('Loaded a tool, edited files, ran commands')
  expect(conversationRows(items)[0]?.id).toBe('heading')
  expect(
    activitySummary([item('inspect', 'tool', { text: 'Inspect Threadlight activity' })], false),
  ).toBe('Inspect Threadlight activity')
})
it('keeps consecutive edits, commands and headings in one group until a message or turn boundary', () => {
  const edits = [item('edit-1', 'files'), item('edit-2', 'files')]
  const first = [
    ...edits,
    item('command'),
    item('heading', 'status'),
    item('edit-3', 'files'),
    item('failed-command', 'command', { failed: true }),
  ]
  const message = item('comment', undefined, { role: 'assistant', kind: 'message' })
  const second = [item('edit-after-message', 'files'), item('command-after-message')]
  const nextTurn = item('edit-next-turn', 'files', { turnId: 'next' })
  expect(conversationRows([...first, message, ...second, nextTurn])).toEqual([
    { type: 'activity', id: 'edit-1', items: first },
    { type: 'message', id: 'comment', item: message },
    { type: 'activity', id: 'edit-after-message', items: second },
    { type: 'activity', id: 'edit-next-turn', items: [nextTurn] },
  ])
  expect(activitySummary(first, false)).toBe('Edited files, ran commands · Failed')
  const pending = item('pending-edit', 'files', { text: 'Editing 1 file', complete: false })
  expect(conversationRows([...first, pending])).toEqual([
    { type: 'activity', id: 'edit-1', items: [...first, pending] },
  ])
  expect(activitySummary([...first, pending], true)).toBe('Editing 1 file')
})
it('does not present a failed command as an unqualified success', () => {
  expect(activitySummary([item('a', 'command', { failed: true })], false)).toBe(
    'Ran a command · Failed',
  )
})

const working = {
  id: 'codex:thread',
  state: 'working' as const,
  compacting: false,
  turnStartedAt: 100,
}
const feed = (...items: TimelineItem[]): ThreadTimeline => ({
  threadId: working.id,
  revision: 1,
  connection: 'live',
  items,
  hasMore: false,
  loadingOlder: false,
})

it('shows each new tool activity and streamed message instead of an older progress sentence', () => {
  const message = item('message', undefined, {
    role: 'assistant',
    kind: 'message',
    text: 'I will check the UI',
    at: 100,
  })
  const tool = item('tool', 'command', { text: 'Updating smoke tests', complete: false, at: 101 })
  expect(liveThreadActivity(working, feed(message, tool))).toBe('Updating smoke tests')
  expect(liveThreadActivity(working, feed(message, { ...tool, complete: true }))).toBe(
    'Updating smoke tests',
  )
  expect(
    liveThreadActivity(
      working,
      feed(message, tool, { ...message, id: 'new', text: 'The checks\n  pass', at: 102 }),
    ),
  ).toBe('The checks pass')
})

it('does not reuse another thread, a previous turn, or the user request as live activity', () => {
  expect(liveThreadActivity(working, { ...feed(item('tool')), threadId: 'other' })).toBeNull()
  expect(liveThreadActivity(working, feed(item('old', 'command', { at: 99 })))).toBeNull()
  expect(liveThreadActivity(working, feed(item('user', undefined, { role: 'user' })))).toBeNull()
})

it('keeps idle, waiting, compaction and disconnected rows on their normal status', () => {
  const timeline = feed(item('tool'))
  expect(liveThreadActivity({ ...working, state: 'idle' }, timeline)).toBeNull()
  expect(liveThreadActivity({ ...working, state: 'waiting' }, timeline)).toBeNull()
  expect(liveThreadActivity({ ...working, compacting: true }, timeline)).toBeNull()
  expect(liveThreadActivity(working, { ...timeline, connection: 'reconnecting' })).toBeNull()
  expect(liveThreadActivity(working, { ...timeline, connection: 'history' })).toBe('Ran a command')
})

it('keeps running commands compact without changing their recorded text', () => {
  const command = item('long', 'command', {
    text: 'Running powershell.exe -NoProfile -Command Get-Content test/ui/thread-timeline.smoke.mjs',
    complete: false,
  })
  expect(activitySummary([command], true)).toBe('Reading project files')
  expect(liveThreadActivity(working, feed(command))).toBe('Reading project files')
  expect(command.text).toContain('powershell.exe -NoProfile')
  expect(activitySummary([{ ...command, complete: true }], true)).toBe('Ran a command')
})
