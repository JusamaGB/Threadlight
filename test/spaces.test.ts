import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpacesStore } from '../src/main/spaces/store'
import { SpacesService } from '../src/main/spaces/service'
import { MemoryStore } from '../src/main/memory/store'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { IDLE_AGENT } from '../src/shared/agent'
import type { Session } from '../src/shared/types'
import type { MemoryFolder, MemorySpace } from '../src/shared/memory'
import type { SpaceIdea } from '../src/shared/spaces'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox,
  store: SpacesStore,
  memory: MemoryStore,
  service: SpacesService,
  folder: MemoryFolder
const sessions = [
  { id: 'claude-one', provider: 'claude' },
  { id: 'codex:two', provider: 'codex' },
] as Session[]
const capture = () =>
  store.edit({
    action: 'create',
    id: randomUUID(),
    title: 'Quiet updates',
    text: 'Summarise meaningful changes.',
  })
const save = (idea: SpaceIdea, patch: Partial<SpaceIdea> = {}) =>
  store.edit({
    action: 'save',
    id: idea.id,
    revision: idea.revision,
    title: idea.title,
    text: idea.text,
    stage: 'brainstorm',
    plan: 'Show blockers and decisions. Validate one update per event.',
    assignments: [
      {
        id: randomUUID(),
        provider: 'claude',
        assignee: 'claude-one',
        title: 'Build',
        brief: 'Implement the approved scope.',
      },
      {
        id: randomUUID(),
        provider: 'codex',
        assignee: 'codex:two',
        title: 'Review',
        brief: 'Review after the implementation is available.',
      },
    ],
    ...patch,
  } as Parameters<SpacesStore['edit']>[0])
beforeEach(async () => {
  box = await sandbox()
  store = new SpacesStore(join(box.root, 'ideas.sqlite'))
  memory = new MemoryStore(join(box.root, 'memory.sqlite'))
  const space = memory.execute({
    action: 'create_space',
    operationId: randomUUID(),
    title: 'Project',
  }) as MemorySpace
  folder = (
    memory.execute({
      action: 'ensure_folder',
      operationId: randomUUID(),
      spaceId: space.id,
      title: 'Handoffs',
      description: 'Shared outputs',
      reason: 'Test outputs',
    }) as { folder: MemoryFolder }
  ).folder
  service = new SpacesService(
    store,
    () => memory,
    () => sessions,
    {
      workspace: join(box.root, 'agent'),
      index: join(box.root, 'agent.json'),
      claudeProjects: box.paths.projectsDir,
      settings: () => DEFAULT_SETTINGS,
      snapshot: () => ({
        sessions: [],
        workspaces: [],
        allWorkspaces: [],
        currentWorkspace: null,
        currentThreadId: null,
      }),
      cli: async () => null,
      onChange: () => {},
      onRateLimit: () => {},
    },
    () => {},
  )
})
afterEach(async () => {
  store.close()
  memory.close()
  await box.cleanup()
  vi.restoreAllMocks()
})

describe('Shared Spaces', () => {
  it('captures without provider calls, survives restart, rejects stale edits and duplicate capture conflicts', () => {
    const idea = capture()
    const moved = save(idea)
    expect(() => save(idea)).toThrow('changed')
    store.close()
    store = new SpacesStore(join(box.root, 'ideas.sqlite'))
    expect(store.get(idea.id)).toEqual(moved)
    expect(() =>
      store.edit({ action: 'create', id: idea.id, title: 'Different', text: idea.text }),
    ).toThrow('different text')
  })
  it('prepares both providers as unsent drafts with a pinned plan; retries cannot duplicate them', async () => {
    const idea = save(capture())
    const input = {
      action: 'prepare' as const,
      id: idea.id,
      revision: idea.revision,
      folderId: folder.id,
    }
    expect((await service.request(input)).ok).toBe(true)
    expect(memory.tasks().map((t) => [t.assignee, t.state])).toEqual([
      ['claude-one', 'draft'],
      ['codex:two', 'draft'],
    ])
    expect(memory.tasks()[0]!.inputs).toEqual(memory.tasks()[1]!.inputs)
    expect(memory.snapshot().items).toHaveLength(1)
    expect((await service.request(input)).ok).toBe(true)
    expect(memory.tasks()).toHaveLength(2)
    expect(() => save(store.get(idea.id))).toThrow('prepared assignments')
  })
  it('validates destination provider and plan revision before writing anything', async () => {
    const idea = save(capture(), {
      assignments: [
        {
          id: randomUUID(),
          provider: 'codex',
          assignee: 'claude-one',
          title: 'Build',
          brief: 'Implement.',
        },
      ],
    })
    expect(
      await service.request({ action: 'prepare', id: idea.id, revision: 1, folderId: folder.id }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('changed') })
    expect(
      await service.request({
        action: 'prepare',
        id: idea.id,
        revision: idea.revision,
        folderId: folder.id,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('Codex') })
    expect(memory.tasks()).toHaveLength(0)
    expect(store.get(idea.id).prepared).toBeNull()
  })
  it('rolls back the entire split on failure and leaves the idea editable', async () => {
    const first = {
      id: randomUUID(),
      provider: 'claude' as const,
      assignee: 'claude-one',
      title: 'Build',
      brief: 'Same task',
    }
    const idea = save(capture(), { assignments: [first, { ...first, id: randomUUID() }] })
    expect(
      (
        await service.request({
          action: 'prepare',
          id: idea.id,
          revision: idea.revision,
          folderId: folder.id,
        })
      ).ok,
    ).toBe(false)
    expect(memory.tasks()).toHaveLength(0)
    expect(memory.snapshot().items).toHaveLength(0)
    expect(store.get(idea.id).prepared).toBeNull()
  })
  it('recovers a committed preparation after losing its local task links', async () => {
    const idea = save(capture()),
      input = {
        action: 'prepare' as const,
        id: idea.id,
        revision: idea.revision,
        folderId: folder.id,
      }
    await service.request(input)
    store.prepared(idea.id, { folderId: folder.id, taskIds: [] })
    expect((await service.request(input)).ok).toBe(true)
    expect(store.get(idea.id).prepared!.taskIds).toHaveLength(2)
    expect(memory.tasks()).toHaveLength(2)
  })
  it('keeps brainstorm context separate, serializes switches and rejects responses for other ideas', async () => {
    const first = save(capture()),
      second = save(capture())
    let done!: (value: { ok: true }) => void
    const send = vi.spyOn(service.agent, 'send').mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )
    const pending = service.request({
      action: 'chat',
      id: first.id,
      text: 'What should we build first?',
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![0]).toContain('discussion only')
    expect(
      (await service.request({ action: 'chat', id: second.id, text: 'Another idea' })).ok,
    ).toBe(false)
    expect(service.respond(second.id, 'request', { action: 'allow' }).ok).toBe(false)
    done({ ok: true })
    await pending
    expect(service.snapshot().activeId).toBe(first.id)
    vi.spyOn(service.agent, 'current', 'get').mockReturnValue({ ...IDLE_AGENT, status: 'working' })
    expect((await service.request({ action: 'chat', id: second.id, text: 'Wait' })).ok).toBe(false)
    expect(memory.tasks()).toHaveLength(0)
  })
})
