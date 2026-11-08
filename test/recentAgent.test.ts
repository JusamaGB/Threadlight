import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecentAgent } from '../src/main/agent/recentAgent'
import { IDLE_AGENT, RECENT_AGENT_MS, type AgentState } from '../src/shared/agent'
import type { AgentRecord } from '../src/main/agent/agentStore'

let dir: string, file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-recent-'))
  file = join(dir, 'recent.json')
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})
const crop: AgentState = {
  ...IDLE_AGENT,
  provider: 'codex',
  conversationId: 'codex:crop',
  status: 'ready',
  items: [
    { kind: 'you', text: 'Shared screen region', screenPreview: 'thumbnail' },
    { kind: 'agent', text: 'Are you trying to classify other file types too?' },
  ],
}
it('keeps a completed crop as a quiet shortcut, including a legacy waiting record', () => {
  const recent = new RecentAgent(file)
  recent.observe(crop)
  expect(recent.current?.waiting).toBe(false)
  writeFileSync(file, JSON.stringify({ ...recent.current, waiting: true }))
  expect(new RecentAgent(file).current).toMatchObject({ id: 'codex:crop', waiting: false })
  recent.observe({
    ...crop,
    status: 'working',
    items: [...crop.items, { kind: 'you', text: 'Document' }],
  })
  expect(recent.current?.waiting).toBe(false)
  recent.observe({ ...crop, items: [...crop.items, { kind: 'agent', text: 'Done.' }] })
  expect(recent.current?.summary).toBe('Done.')
  vi.advanceTimersByTime(RECENT_AGENT_MS + 1)
  expect(recent.current).toBeUndefined()
})
it('signals native decisions and leaves partial and completed Live prose quiet', () => {
  const recent = new RecentAgent(file)
  recent.observe({ ...crop, items: [{ kind: 'agent', text: 'Ordinary reply?' }] })
  expect(recent.current).toBeUndefined()
  const live = { id: 'live:one', kind: 'agent' as const, text: 'Which window?' }
  recent.observe({ ...crop, live: 'active', items: [{ ...live, liveComplete: false }] })
  expect(recent.current?.waiting).toBe(false)
  recent.observe({ ...crop, items: [{ ...live, liveComplete: true }] })
  expect(recent.current?.waiting).toBe(false)
  recent.observe({ ...crop, items: [{ kind: 'agent', text: 'The example is `value?`.' }] })
  expect(recent.current?.waiting).toBe(false)
  recent.observe({
    ...crop,
    items: [],
    status: 'waiting',
    requests: [
      { kind: 'approval', id: 'q', title: 'Allow file change', detail: '', canAllow: true },
    ],
  })
  expect(recent.current).toMatchObject({ summary: 'Allow file change', waiting: true })
  recent.observe(IDLE_AGENT)
  expect(recent.current?.waiting).toBe(false)
})
it('recovers a pre-upgrade crop from the most recent matching history record', async () => {
  const recent = new RecentAgent(file)
  const record = {
    id: 'codex:crop',
    at: Date.now(),
    provider: 'codex',
    title: 'Screen region · Editor',
  } as AgentRecord
  const read = vi.fn(async () => ({ items: crop.items }))
  await recent.restore(
    [record, { ...record, id: 'unrelated', title: 'Other chat', at: record.at + 1 }],
    read,
  )
  expect(read).toHaveBeenCalledWith(record.id)
  expect(recent.current).toMatchObject({ id: record.id, waiting: false })
})
