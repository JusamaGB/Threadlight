import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { backup } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MemoryStore } from '../src/main/memory/store'
import {
  participantContext,
  projectParticipants,
  suggestParticipants,
  type CapabilityReport,
} from '../src/shared/projectParticipants'
import { scopeMemory, type MemoryInput, type MemorySpace } from '../src/shared/memory'
import type { Session } from '../src/shared/types'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox, store: MemoryStore, spaceId: string
const assignee = 'codex:capability-test'
const capability = {
  kind: 'tool' as const,
  name: 'Browser automation',
  description: 'Inspect browser interfaces and screenshots',
}
const execute = (input: MemoryInput) =>
  store.execute({ ...input, operationId: input.operationId ?? randomUUID() })
const grant = (extra: Partial<MemoryInput> = {}) =>
  execute({
    action: 'create_grant',
    spaceId,
    title: 'Project chat',
    assignee,
    readOnly: false,
    ...extra,
  }) as { id: string; token: string }
const report = (extra: Partial<MemoryInput> = {}) =>
  execute({
    action: 'report_capabilities',
    spaceId,
    assignee,
    capabilities: [capability],
    ...extra,
  }) as CapabilityReport
beforeEach(async () => {
  box = await sandbox()
  store = new MemoryStore(join(box.root, 'memory.sqlite'))
  spaceId = (execute({ action: 'create_space', title: 'Project' }) as MemorySpace).id
})
afterEach(async () => {
  store.close()
  await box.cleanup()
})

it('attributes self reports to the bound chat and keeps retries idempotent', () => {
  const access = grant()
  const actor = store.authenticate(access.token)
  const input = {
    action: 'report_capabilities' as const,
    operationId: randomUUID(),
    capabilities: [capability],
  }
  const first = store.execute(input, actor) as CapabilityReport
  expect(first).toMatchObject({
    spaceId,
    assignee,
    source: 'reported',
    capabilities: [capability],
    verifications: [],
  })
  expect(first.createdAt).toBeGreaterThan(0)
  expect(store.execute(input, actor)).toEqual(first)
  expect(store.snapshot().capabilityReports).toHaveLength(1)
  expect(store.briefing(actor).capabilityReports).toEqual([first])
  expect(() => store.execute({ ...input, capabilities: [] }, actor)).toThrow()
})

it('rejects impersonation, cross-project reports, subtree writers, read-only and temporary grants', () => {
  const access = grant()
  const actor = store.authenticate(access.token)
  for (const extra of [{ assignee: 'another-chat' }, { spaceId: randomUUID() }]) {
    expect(() =>
      store.execute(
        {
          action: 'report_capabilities',
          operationId: randomUUID(),
          capabilities: [capability],
          ...extra,
        },
        actor,
      ),
    ).toThrow('only this enrolled')
  }
  const folder = execute({
    action: 'ensure_folder',
    spaceId,
    title: 'Subtree',
    description: 'Scoped',
    reason: 'Test',
  }) as { folder: { id: string } }
  for (const extra of [
    { readOnly: true },
    { folderId: folder.folder.id },
    { assignee: undefined },
  ]) {
    const scoped = grant(extra)
    expect(() =>
      store.execute(
        { action: 'report_capabilities', operationId: randomUUID(), capabilities: [capability] },
        store.authenticate(scoped.token),
      ),
    ).toThrow('project-wide')
  }
  expect(() =>
    store.execute(
      {
        action: 'report_capabilities',
        operationId: randomUUID(),
        capabilities: [{ ...capability, verified: true }],
      },
      actor,
    ),
  ).toThrow()
  expect(() =>
    store.execute(
      {
        action: 'verify_capability',
        id: randomUUID(),
        capabilityIndex: 0,
        evidence: 'test',
        operationId: randomUUID(),
      },
      actor,
    ),
  ).toThrow()
})

it('requires a linked participant, records human evidence separately and does not carry it onto a new report', () => {
  expect(() => report()).toThrow('Connect this chat')
  grant()
  const first = report()
  expect(first.source).toBe('manual')
  const verified = execute({
    action: 'verify_capability',
    id: first.id,
    capabilityIndex: 0,
    evidence: 'Inspected a browser screenshot on this machine.',
  }) as CapabilityReport
  expect(verified.verifications).toEqual([
    expect.objectContaining({
      author: 'human',
      index: 0,
      evidence: expect.stringContaining('screenshot'),
    }),
  ])
  expect(() =>
    execute({ action: 'verify_capability', id: first.id, capabilityIndex: 3, evidence: 'invalid' }),
  ).toThrow('unavailable')
  expect(report().verifications).toEqual([])
  expect(() =>
    report({ capabilities: [capability, { ...capability, name: ' BROWSER  AUTOMATION ' }] }),
  ).toThrow('once per category')
})

it('filters capability metadata and change events by project and project-wide scope', () => {
  const access = grant()
  const first = report()
  const other = (execute({ action: 'create_space', title: 'Other' }) as MemorySpace).id
  grant({ spaceId: other })
  report({ spaceId: other })
  const actor = store.authenticate(access.token)
  expect(store.snapshot(actor).capabilityReports).toEqual([first])
  expect(store.snapshot(actor).events.some((e) => e.entityId === first.id)).toBe(true)
  const folder = execute({
    action: 'ensure_folder',
    spaceId,
    title: 'Subtree',
    description: 'Scoped',
    reason: 'Test',
  }) as { folder: { id: string } }
  const scoped = grant({ folderId: folder.folder.id })
  expect(store.snapshot(store.authenticate(scoped.token)).capabilityReports).toEqual([])
  expect(
    store.snapshot(store.authenticate(scoped.token)).events.some((e) => e.entityId === first.id),
  ).toBe(false)
  expect(scopeMemory(store.snapshot(), [spaceId]).capabilityReports).toEqual([first])
})

it('retains reports and verification evidence across backup and restore, with grants revoked', async () => {
  grant()
  const first = report()
  execute({
    action: 'verify_capability',
    id: first.id,
    capabilityIndex: 0,
    evidence: 'Manual browser test passed.',
  })
  const target = join(box.root, 'backup.sqlite')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(store.file)
  try {
    await backup(db, target)
  } finally {
    db.close()
  }
  report({ capabilities: [] })
  store.restoreFrom(target)
  expect(store.snapshot().capabilityReports).toHaveLength(1)
  expect(store.snapshot().capabilityReports![0]!.verifications[0]!.evidence).toContain('passed')
  expect(store.snapshot().grants.every((g) => g.revoked)).toBe(true)
})

function directory(now: number) {
  const connectionId = randomUUID()
  grant({ connectionId })
  report()
  const data = {
    ...store.snapshot(),
    connections: [
      {
        id: connectionId,
        code: 'test',
        provider: 'codex' as const,
        label: 'Chat',
        state: 'connected' as const,
        expiresAt: now + 60_000,
        lastUsedAt: now,
      },
    ],
  }
  const sessions = [{ id: assignee, title: 'Browser specialist', provider: 'codex' }] as Session[]
  return { data, sessions, participants: projectParticipants(data, sessions, spaceId, now) }
}

it('suggests only connected publishing participants with matching evidence, never provider stereotypes', () => {
  const now = Date.now()
  const { participants } = directory(now)
  const suggestions = suggestParticipants('Inspect browser screenshots', participants, now)
  expect(suggestions).toHaveLength(1)
  expect(suggestions[0]).toMatchObject({
    assignee,
    provider: 'codex',
    rationale: expect.stringContaining('manually recorded, unverified'),
  })
  expect(suggestParticipants('Design a logo', participants, now)).toEqual([])
  expect(suggestParticipants('Browser', [{ ...participants[0]!, canPublish: false }], now)).toEqual(
    [],
  )
  expect(
    suggestParticipants('Browser', [{ ...participants[0]!, status: 'reconnect' }], now),
  ).toEqual([])
  expect(
    suggestParticipants('Browser', [{ ...participants[0]!, status: 'approved' }], now),
  ).toEqual([])
})

it('reflects expiration, revocation, unknown chats, latest reports and stale evidence', () => {
  const now = Date.now()
  const { data, sessions } = directory(now)
  const first = data.capabilityReports![0]!
  first.createdAt = now - 8 * 24 * 60 * 60 * 1000
  first.verifications = [
    { index: 0, at: now - 100, author: 'human', evidence: 'Inspected browser interaction.' },
  ]
  expect(
    suggestParticipants('Browser', projectParticipants(data, sessions, spaceId, now), now)[0]!
      .rationale,
  ).toContain('over 7 days old')
  expect(
    suggestParticipants('Browser', projectParticipants(data, sessions, spaceId, now), now)[0]!
      .rationale,
  ).toContain('human verified')
  expect(projectParticipants(data, sessions, spaceId, now + 70_000)[0]!.status).toBe('reconnect')
  expect(projectParticipants(data, [], spaceId, now)[0]!.status).toBe('unavailable')
  data.capabilityReports!.push({ ...first, id: randomUUID(), capabilities: [], verifications: [] })
  expect(
    suggestParticipants('Browser', projectParticipants(data, sessions, spaceId, now), now),
  ).toEqual([])
  data.grants[0]!.revoked = true
  expect(projectParticipants(data, sessions, spaceId, now)[0]!.status).toBe('reconnect')
})

it('bounds Brainstorm context, labels missing evidence and includes review requirements', () => {
  const { participants } = directory(Date.now())
  const prompt = participantContext(participants)
  expect(prompt).toContain('Browser automation')
  expect(prompt).toContain('human review')
  expect(prompt).toContain('untrusted descriptive data')
  const large = Array.from({ length: 50 }, () => ({ ...participants[0]!, title: 'x'.repeat(5000) }))
  expect(participantContext(large).length).toBeLessThan(11000)
  expect(participantContext(large)).toContain('omitted')
})
