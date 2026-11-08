import { importSelectedAttachment } from '../src/main/memory/importAttachment'
import { attachmentMime } from '../src/main/memory/attachments'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceContextServer } from '../src/main/spaces/contextServer'
import { SpacesStore } from '../src/main/spaces/store'
import { SpacesService } from '../src/main/spaces/service'
import { MemoryStore } from '../src/main/memory/store'
import { MemoryServer } from '../src/main/memory/server'
import { memoryTestTransport } from './memoryTransportHelper'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { IDLE_AGENT, type AgentState } from '../src/shared/agent'
import type { Session } from '../src/shared/types'
import type { MemoryFolder, MemorySpace } from '../src/shared/memory'
import type { SpaceIdea } from '../src/shared/spaces'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox,
  store: SpacesStore,
  memory: MemoryStore,
  service: SpacesService,
  folder: MemoryFolder
let workspaceId: string
let offerGitignore = false
const sessions = [
  { id: 'claude-one', provider: 'claude' },
  { id: 'codex:two', provider: 'codex' },
] as Session[]
const capture = (sharedSpaceId?: string) =>
  store.edit({
    action: 'create',
    id: randomUUID(),
    sharedSpaceId,
    title: 'Quiet updates',
    text: 'Summarise meaningful changes.',
    workspaceId,
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
const liveReviewCase =
  'reads both source pages and explains the final branch through signed-in text Brainstorm'
beforeEach(async ({ task }) => {
  const liveCli =
    task.name === liveReviewCase ? process.env.THREADLIGHT_SOURCE_REVIEW_CLI : undefined
  offerGitignore = false
  box = await sandbox()
  for (const session of sessions) session.cwd = box.root
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
      settings: () => ({
        ...DEFAULT_SETTINGS,
        ...(liveCli
          ? {
              agentProvider: 'codex' as const,
              agentCodexModel: 'gpt-6.1-sol',
              agentCodexReasoning: 'low',
            }
          : {}),
        sharedSpacesGitignore: offerGitignore,
      }),
      snapshot: () => ({
        sessions: [],
        workspaces: [],
        allWorkspaces: [],
        currentWorkspace: null,
        currentThreadId: null,
      }),
      cli: async () => (liveCli ? { command: liveCli, prefixArgs: [] } : null),
      onChange: () => {},
      onRateLimit: () => {},
    },
    () => {},
  )
  expect((await service.request({ action: 'setup', root: box.root })).ok).toBe(true)
  workspaceId = store.workspaces()[0]!.id
  store.assign(workspaceId, [], [folder.spaceId])
})
afterEach(async () => {
  store.close()
  memory.close()
  await box.cleanup()
  vi.restoreAllMocks()
})

describe('Shared Spaces', () => {
  it('pins an explicitly imported file through Brainstorm, tracks contiguous pages independently of line navigation and preserves the original', async () => {
    const path = join(box.root, 'booking.py')
    const lines = [
      '# Missing dates are accepted.',
      'def book(date):',
      ...Array<string>(78).fill('    # context'),
      '    if not date:',
      '        return "missing"',
      '    return reserve(date)',
    ]
    const original = Buffer.from(lines.join('\r\n') + '\r\n')
    writeFileSync(path, original)
    const pick = (cancel: boolean) =>
      importSelectedAttachment(memory, folder.id, async (options) => {
        expect(options.title).toContain('Project / Handoffs')
        expect(options.filters?.[0]?.extensions).toContain('py')
        return { canceled: cancel, filePaths: [path] }
      })
    expect(await pick(true)).toEqual({ cancelled: true })
    expect(memory.snapshot().items).toHaveLength(0)
    const item = await pick(false)
    if (!('id' in item)) throw Error('Expected a shared attachment')
    const id = randomUUID(),
      file = { itemId: item.id, revision: 1 }
    const create = {
      action: 'create_discussion',
      id,
      spaceId: folder.spaceId,
      title: 'Explain booking.py',
      file,
    }
    expect((await service.request(create)).ok).toBe(true)
    expect(store.documents().some((d) => d.id === item.id || d.id === id)).toBe(false)
    const scope = service.context.open(id)
    const page = (firstLine: number) =>
      service.context.call(scope, 'threadlight_read_code_page', { firstLine })
    vi.spyOn(service.agent, 'send').mockImplementationOnce(async (prompt) => {
      expect(prompt).toContain(item.id)
      expect(prompt).toContain('Do not execute')
      expect(await page(1)).toMatchObject({
        nextLine: 81,
        lines: lines.slice(0, 80),
        testsRun: false,
      })
      return { ok: true }
    })
    expect((await service.request({ action: 'chat', id, text: 'Explain the functions' })).ok).toBe(
      true,
    )
    const link = await service.request({ action: 'source_lines', id, first: 81, last: 83 })
    expect(link).toMatchObject({ ok: true, sourceLines: { first: 81, lines: lines.slice(80) } })
    expect(store.get(id).sourceReadThrough).toBe(80)
    await expect(page(82)).rejects.toThrow('contiguous')
    service.context.close(scope)
    await expect(page(81)).rejects.toThrow('access ended')
    const again = service.context.open(id)
    const second = memory.importAttachment(
      folder.id,
      'booking.py',
      'text/plain',
      Buffer.from('return 123'),
    )
    expect(
      await service.context.call(again, 'threadlight_read_code_page', { firstLine: 81 }),
    ).toMatchObject({ lines: lines.slice(80), nextLine: null })
    expect(store.get(id).sourceReadThrough).toBe(83)
    await expect(
      service.context.call(again, 'threadlight_read_code_page', { itemId: second.id }),
    ).rejects.toThrow('different snapshot')
    expect(
      (await service.request({ ...create, file: { itemId: second.id, revision: 1 } })).ok,
    ).toBe(false)
    await expect(
      service.context.call(again, 'threadlight_save_note', {
        operationId: randomUUID(),
        text: 'do not save',
      }),
    ).rejects.toThrow('read-only')
    const other = memory.execute({
      action: 'create_space',
      operationId: randomUUID(),
      title: 'Outside',
    }) as MemorySpace
    store.assign(workspaceId, [], [other.id])
    expect((await service.request({ ...create, id: randomUUID(), spaceId: other.id })).ok).toBe(
      false,
    )
    expect(readFileSync(path)).toEqual(original)
    expect(memory.read({}, item.id).revision.body).toBe(original.toString('utf8'))
    expect(store.documents().some((d) => [item.id, second.id, id].includes(d.id))).toBe(false)
    memory.execute({
      action: 'archive_item',
      operationId: randomUUID(),
      id: item.id,
      archived: true,
    })
    await expect(service.context.call(again, 'threadlight_read_code_page', {})).rejects.toThrow(
      'unavailable',
    )
    expect((await service.request({ action: 'source_lines', id, first: 1, last: 1 })).ok).toBe(
      false,
    )
  })
  it.skipIf(!process.env.THREADLIGHT_SOURCE_REVIEW_CLI)(
    liveReviewCase,
    async () => {
      const endpoint = new SpaceContextServer(service.context, memoryTestTransport(box.root))
      await endpoint.start()
      vi.spyOn(service.contextServer, 'connect').mockImplementation((id) => endpoint.connect(id))
      try {
        const path = join(box.root, 'reservation.py')
        const lines = [
          '# Missing dates are accepted.',
          'from calendar_service import reserve',
          'def book(date):',
          ...Array<string>(77).fill('    # calendar'),
          '    if not date:',
          '        return "MISSING_DATE"',
          '    return reserve(date)',
        ]
        writeFileSync(path, lines.join('\r\n'))
        const file = await importSelectedAttachment(memory, folder.id, async () => ({
          canceled: false,
          filePaths: [path],
        }))
        if (!('id' in file)) throw Error('Import cancelled')
        const id = randomUUID()
        const result = await service.request({
          action: 'create_discussion',
          id,
          spaceId: folder.spaceId,
          title: 'Explain reservation',
          file: { itemId: file.id, revision: 1 },
        })
        expect(result.ok).toBe(true)
        const sent = await service.request({
          action: 'chat',
          id,
          text: 'Explain this file, including exactly what happens if the date is missing and what you could verify about reserve. Cite the lines.',
        })
        expect(sent.ok, sent.ok ? '' : sent.reason).toBe(true)
        await vi.waitFor(() => expect(service.agent.current.status).toBe('ready'), {
          timeout: 90000,
          interval: 300,
        })
        const answer =
          service.agent.current.items.filter((i) => i.kind === 'agent').at(-1)?.text ?? ''
        expect(store.get(id).sourceReadThrough).toBe(lines.length)
        expect(answer).toContain('MISSING_DATE')
        expect(answer).toMatch(/L8[123]/)
        expect(answer).toMatch(/reserve/i)
        expect(answer).toMatch(/test|execut|run/i)
        expect(readFileSync(path, 'utf8')).toBe(lines.join('\r\n'))
        console.log('Signed-in text Brainstorm answer:', answer)
        memory.importAttachment(
          folder.id,
          'reservation.py',
          'text/plain',
          Buffer.from('def book(date): return "ALWAYS_ACCEPT"'),
        )
        const followup = await service.request({
          action: 'chat',
          id,
          text: 'In the copy we reviewed, what exact value does a missing date return? Cite its line.',
        })
        expect(followup.ok, followup.ok ? '' : followup.reason).toBe(true)
        await vi.waitFor(() => expect(service.agent.current.status).toBe('ready'), {
          timeout: 60000,
          interval: 300,
        })
        const reply = service.agent.current.items.filter((i) => i.kind === 'agent').at(-1)?.text
        expect(reply).toContain('MISSING_DATE')
        expect(reply).not.toContain('ALWAYS_ACCEPT')
        expect(reply).toMatch(/L8[12]/)
      } finally {
        await service.agent.close()
        endpoint.close()
      }
    },
    140000,
  )
  it('validates bounded UTF-8 source, including empty files', () => {
    for (const name of ['file.py', 'file.js', 'file.jsx', 'file.ts', 'file.tsx'])
      expect(attachmentMime(Buffer.alloc(0), name)).toBe('text/plain')
    for (const bytes of [
      Buffer.from([255]),
      Buffer.from([0]),
      Buffer.alloc(32769, 32),
      Buffer.alloc(4001, 32),
    ])
      expect(() => attachmentMime(bytes, 'test.ts')).toThrow()
  })
  it('binds a naturally requested attachment and requires a choice for duplicate filenames', async () => {
    const note = (name: string) =>
      store.discussion(
        {
          action: 'create_discussion',
          id: randomUUID(),
          spaceId: folder.spaceId,
          title: name,
        },
        workspaceId,
      )
    const item = memory.importAttachment(folder.id, 'empty.ts', 'text/plain', Buffer.alloc(0))
    const discussion = note('What does empty.ts do?')
    const scope = service.context.open(discussion.id)
    const read = (id: string) => ({ itemId: id, revision: 1 })
    expect(
      await service.context.call(scope, 'threadlight_read_code_page', read(item.id)),
    ).toMatchObject({ lines: [], nextLine: null })
    expect(store.get(discussion.id).sourcePin?.itemId).toBe(item.id)
    memory.importAttachment(
      folder.id,
      'empty.ts',
      'text/plain',
      Buffer.from('const changed = true'),
    )
    expect(await service.context.call(scope, 'threadlight_read_code_page', {})).toMatchObject({
      lines: [],
    })
    const second = note('Another discussion')
    await expect(
      service.context.call(
        service.context.open(second.id),
        'threadlight_read_code_page',
        read(item.id),
      ),
    ).rejects.toThrow('Several snapshots')
    expect(store.get(second.id).sourcePin).toBeUndefined()
    const sibling = memory.execute({
      action: 'ensure_folder',
      operationId: randomUUID(),
      spaceId: folder.spaceId,
      title: 'Sibling',
      description: 'Separate folder',
      reason: 'Test',
    }) as { folder: MemoryFolder }
    const grant = memory.execute({
      action: 'create_grant',
      operationId: randomUUID(),
      spaceId: folder.spaceId,
      folderId: sibling.folder.id,
      title: 'External reader',
      readOnly: true,
    }) as { token: string }
    expect(() => memory.read(memory.authenticate(grant.token), item.id)).toThrow('capability')
  })
  it('offers ignore independently and adds only the explicitly chosen space, preserving rules on retry', async () => {
    const file = join(box.root, '.gitignore'),
      initial = '# Keep these rules\r\nnode_modules/\r\n!important.txt'
    writeFileSync(file, initial)
    const input = {
      action: 'create_space' as const,
      id: randomUUID(),
      root: box.root,
      title: 'Private ideas',
      addToGitignore: true,
    }
    expect((await service.request(input)).ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(initial)
    expect(store.locations()).toHaveLength(0)
    offerGitignore = true
    const created = await service.request(input)
    expect(created.ok).toBe(true)
    const expected = initial + '\r\n/shared-spaces/private-ideas/\r\n'
    expect(readFileSync(file, 'utf8')).toBe(expected)
    expect((await service.request(input)).ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(expected)
    expect(store.locations()).toHaveLength(1)
    expect((await service.request({ ...input, addToGitignore: false })).ok).toBe(false)
    expect(
      (
        await service.request({
          ...input,
          id: randomUUID(),
          title: 'Public ideas',
          addToGitignore: false,
        })
      ).ok,
    ).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(expected)
    offerGitignore = false
    expect(
      (
        await service.request({
          ...input,
          id: randomUUID(),
          title: 'Ordinary ideas',
          addToGitignore: undefined,
        })
      ).ok,
    ).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(expected)
  })
  it('recovers an ignore-write failure with the same creation identity', async () => {
    offerGitignore = true
    const file = join(box.root, '.gitignore')
    mkdirSync(file)
    const input = {
      action: 'create_space' as const,
      id: randomUUID(),
      root: box.root,
      title: 'Retry ignore',
      addToGitignore: true,
    }
    const failed = await service.request(input)
    expect(failed).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Space created, but .gitignore'),
    })
    const id = store.locations()[0]!.spaceId
    renameSync(file, join(box.root, 'old-ignore-directory'))
    expect(await service.request(input)).toMatchObject({ ok: true, spaceId: id })
    expect(store.locations()).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).toBe('/shared-spaces/retry-ignore/\n')
  })
  it('publishes hosted notes to Notes with attribution and durable revision receipts', async () => {
    vi.spyOn(service.agent, 'current', 'get').mockReturnValue({
      ...IDLE_AGENT,
      provider: 'codex',
      conversationId: 'native-hosted-chat',
    })
    const scope = service.context.openProject(folder.spaceId)
    const request = {
      operationId: randomUUID(),
      text: 'An onboarding idea. Keep the whole explanation.',
    }
    await service.context.call(scope, 'threadlight_save_note', request)
    const note = store.get(request.operationId),
      first = store.documents().find((d) => d.id === note.id)!
    expect(first.path).toContain('notes')
    expect(readFileSync(first.path, 'utf8')).toContain('Saved by Codex')
    expect(readFileSync(first.path, 'utf8')).toContain(request.text)
    expect(service.snapshot().ideas.find((n) => n.id === note.id)?.saver?.chatId).toBe(
      'native-hosted-chat',
    )
    const update = {
      operationId: randomUUID(),
      sourceRef: `note:${note.id}`,
      expectedRevision: 1,
      text: 'Additional context, preserved in full.',
    }
    const saved = await service.context.call(scope, 'threadlight_revise_note', update)
    const next = store.documents().find((d) => d.id === note.id)!
    expect(next.path).not.toBe(first.path)
    expect(readFileSync(first.path, 'utf8')).toContain(request.text)
    expect(readFileSync(next.path, 'utf8')).toContain(update.text)
    const reopened = new SpacesStore(join(box.root, 'ideas.sqlite'))
    try {
      const { SpaceContextService } = await import('../src/main/spaces/context')
      const context = new SpaceContextService(
        reopened,
        () => memory,
        () => [],
        undefined,
        undefined,
        {
          identity: () => ({ provider: 'codex', chatId: 'native-hosted-chat' }),
          changed: () => {},
        },
      )
      const freshScope = context.openProject(folder.spaceId)
      expect(await context.call(freshScope, 'threadlight_revise_note', update)).toEqual(saved)
      expect(reopened.get(note.id).revision).toBe(2)
      context.close(freshScope)
    } finally {
      reopened.close()
    }
    expect(memory.tasks()).toHaveLength(0)
    service.context.close(scope)
  })
  it('discovers only available assigned project identities without leaking workspace metadata', () => {
    const before = memory.connectionProjects()
    expect(before).toContainEqual({
      id: folder.spaceId,
      name: memory.projectIdentities().find((p) => p.id === folder.spaceId)!.name,
    })
    expect(before.every((p) => Object.keys(p).sort().join(',') === 'id,name')).toBe(true)
    const unassigned = memory.execute({
      action: 'create_space',
      title: 'Legacy unassigned',
      operationId: randomUUID(),
    }) as MemorySpace
    expect(memory.connectionProjects().some((p) => p.id === unassigned.id)).toBe(false)
    const source = join(box.root, 'shared-spaces'),
      moved = join(box.root, 'unavailable-shared-spaces')
    renameSync(source, moved)
    try {
      expect(memory.connectionProjects()).toEqual([])
    } finally {
      renameSync(moved, source)
    }
    expect(memory.connectionProjects()).toEqual(before)
  })

  it('retires Spaces before memory revocation without reading its closed database', async () => {
    const server = new MemoryServer(memory, memoryTestTransport(box.root))
    const request = {
      action: 'request',
      id: randomUUID(),
      secret: 'a'.repeat(64),
      provider: 'codex',
      label: 'Restart regression',
      spaceId: folder.spaceId,
    }
    server.connections.request(request)
    const approved = server.connections.approve(request.id, {
      action: 'create_grant',
      spaceId: folder.spaceId,
      title: 'Restart regression',
      readOnly: false,
    })
    const note = capture()
    // Match app before-quit -> will-quit ordering with a live approved enrollment.
    const closing = service.close()
    expect(service.close()).toBe(closing)
    await closing
    try {
      expect(() => server.close()).not.toThrow()
      expect(memory.snapshot().grants.find((g) => g.id === approved.grantId)?.revoked).toBe(false)
      expect(() => memory.executionContext(folder.spaceId)).toThrow('Shared Spaces is closed')
    } finally {
      store = new SpacesStore(join(box.root, 'ideas.sqlite'))
    }
    expect(store.get(note.id).text).toBe(note.text)
    const reopenedMemory = new MemoryStore(join(box.root, 'memory.sqlite'))
    try {
      expect(reopenedMemory.snapshot().grants.find((g) => g.id === approved.grantId)?.revoked).toBe(
        false,
      )
    } finally {
      reopenedMemory.close()
    }
  })
  it('keeps a new native voice session project-scoped and saves only the first completed spoken message', async () => {
    const id = randomUUID()
    const conversationId = `codex:${randomUUID()}`
    const emit = (state: Partial<AgentState>) =>
      (service.agent as unknown as { publish: (state: AgentState) => void }).publish({
        ...IDLE_AGENT,
        provider: 'codex',
        conversationId,
        status: 'ready',
        live: 'active',
        ...state,
      })
    vi.spyOn(service.agent, 'startLive').mockImplementation(async () => {
      emit({ items: [] })
      return { ok: true, sdp: 'v=0\nanswer' }
    })
    const stopped = vi.spyOn(service.agent, 'stopLive').mockResolvedValue()
    expect(await service.startLive(id, 'v=0\noffer', folder.spaceId, null)).toMatchObject({
      ok: true,
    })
    expect(store.discussions()).toHaveLength(0)
    const scope = service.context.openProject(folder.spaceId)
    expect(scope.spaceIds).toEqual([folder.spaceId])
    expect(scope.discussionId).toBeNull()
    expect(await service.context.call(scope, 'threadlight_get_space_context', {})).toMatchObject({
      outcome: 'ok',
    })
    service.context.close(scope)
    emit({ items: [{ id: 'live:one', kind: 'you', text: 'A partial idea', liveComplete: false }] })
    expect(store.discussions()).toHaveLength(0)
    emit({
      items: [
        {
          id: 'live:one',
          kind: 'you',
          text: 'Explore a clearer project overview',
          liveComplete: true,
        },
      ],
    })
    const discussion = store.discussions()[0]!
    expect(discussion).toMatchObject({
      title: 'Explore a clearer project overview',
      sharedSpaceId: folder.spaceId,
      conversationId,
    })
    emit({
      items: [
        { id: 'live:two', kind: 'you', text: 'Keep the second idea here too', liveComplete: true },
      ],
    })
    expect(store.discussions()).toHaveLength(1)
    expect(service.snapshot().voice).toMatchObject({ sessionId: id, discussionId: discussion.id })
    expect(
      (await service.request({ action: 'chat', id: discussion.id, text: 'Competing typed send' }))
        .ok,
    ).toBe(false)
    await service.stopLive(randomUUID())
    expect(stopped).not.toHaveBeenCalled()
    await service.stopLive(id)
    expect(stopped).toHaveBeenCalledWith(id)
    expect(service.snapshot().voice).toBeUndefined()
    expect(store.discussions()).toHaveLength(1)
  })
  it('cancels an empty or still-opening voice session without creating a discussion', async () => {
    const id = randomUUID()
    let complete!: (result: { ok: true; sdp: string }) => void
    const start = vi.spyOn(service.agent, 'startLive').mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const stopped = vi.spyOn(service.agent, 'stopLive').mockResolvedValue()
    const opening = service.startLive(id, 'v=0\noffer', folder.spaceId, null)
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    await service.stopLive(id)
    complete({ ok: true, sdp: 'v=0\nlate answer' })
    expect(await opening).toMatchObject({ ok: false })
    expect(stopped).toHaveBeenCalledWith(id)
    expect(service.snapshot().voice).toBeUndefined()
    expect(store.discussions()).toHaveLength(0)
  })
  it('resumes the selected voice discussion and rejects a discussion from another project', async () => {
    const discussion = store.discussion(
      {
        action: 'create_discussion',
        id: randomUUID(),
        spaceId: folder.spaceId,
        title: 'Existing ideas',
        noteIds: [],
      },
      workspaceId,
    )
    store.bind(discussion.id, 'codex:previous')
    const resume = vi.spyOn(service.agent, 'resume').mockResolvedValue({ ok: true })
    const start = vi
      .spyOn(service.agent, 'startLive')
      .mockResolvedValue({ ok: true, sdp: 'v=0\nanswer' })
    vi.spyOn(service.agent, 'stopLive').mockResolvedValue()
    const id = randomUUID()
    expect(await service.startLive(id, 'v=0\noffer', folder.spaceId, discussion.id)).toMatchObject({
      ok: true,
    })
    expect(resume).toHaveBeenCalledWith('codex:previous')
    expect(start).toHaveBeenCalledWith(id, 'v=0\noffer')
    await service.stopLive(id)
    const foreign = store.discussion(
      {
        action: 'create_discussion',
        id: randomUUID(),
        spaceId: randomUUID(),
        title: 'Foreign',
        noteIds: [],
      },
      workspaceId,
    )
    expect(
      await service.startLive(randomUUID(), 'v=0\noffer', folder.spaceId, foreign.id),
    ).toMatchObject({ ok: false, reason: 'Choose a discussion in this project.' })
    expect(start).toHaveBeenCalledTimes(1)
  })
  it('waits for the old empty voice session to retire before starting the next one', async () => {
    const first = randomUUID(),
      second = randomUUID()
    const start = vi
      .spyOn(service.agent, 'startLive')
      .mockResolvedValue({ ok: true, sdp: 'v=0\nanswer' })
    let release!: () => void
    vi.spyOn(service.agent, 'stopLive')
      .mockResolvedValue()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
    expect(await service.startLive(first, 'v=0\noffer', folder.spaceId, null)).toMatchObject({
      ok: true,
    })
    const retiring = service.stopLive(first)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const opening = service.startLive(second, 'v=0\nnext offer', folder.spaceId, null)
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(1)
    release()
    await retiring
    expect(await opening).toMatchObject({ ok: true })
    expect(service.snapshot().voice?.sessionId).toBe(second)
    await service.stopLive(first)
    expect(service.snapshot().voice?.sessionId).toBe(second)
    await service.stopLive(second)
    expect(store.discussions()).toHaveLength(0)
  })
  it('keeps legacy ideas snapshots readable and writes new revisions under notes', () => {
    const note = capture(),
      old = store.documents().find((d) => d.id === note.id)!
    const legacyDirectory = join(box.root, 'shared-spaces', 'ideas')
    renameSync(join(box.root, 'shared-spaces', 'notes'), legacyDirectory)
    const legacyPath = old.path.replace(/([\\/])notes([\\/])/, '$1ideas$2')
    store.recordDocument({ ...old, path: legacyPath })
    const original = readFileSync(legacyPath, 'utf8')
    save(note, { text: 'A new revision' })
    const next = store.documents().find((d) => d.id === note.id)!
    expect(next.path).toContain('notes')
    expect(readFileSync(legacyPath, 'utf8')).toBe(original)
    expect(readFileSync(next.path, 'utf8')).toContain('A new revision')
  })
  it('explicitly attaches legacy material without changing history and rejects reassignment', async () => {
    const note = capture()
    store.bind(note.id, 'codex:preserved-history')
    const reply = await service.request({
      action: 'attach_material',
      id: note.id,
      spaceId: folder.spaceId,
      revision: note.revision,
    })
    expect(reply.ok).toBe(true)
    expect(store.get(note.id)).toMatchObject({
      id: note.id,
      at: note.at,
      conversationId: 'codex:preserved-history',
      sharedSpaceId: folder.spaceId,
    })
    expect(
      (
        await service.request({
          action: 'attach_material',
          id: note.id,
          spaceId: folder.spaceId,
          revision: note.revision,
        })
      ).ok,
    ).toBe(false)
  })
  it('grounds Brainstorm in project capability evidence and carries reviewed rationale into unsent handoffs', async () => {
    const created = await service.request({
      action: 'create_space',
      id: randomUUID(),
      root: box.root,
      title: 'Capability project',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const spaceId = created.spaceId!
    const connectionId = randomUUID()
    memory.execute({
      action: 'create_grant',
      operationId: randomUUID(),
      spaceId,
      title: 'Browser chat',
      assignee: 'codex:two',
      readOnly: false,
      connectionId,
    })
    memory.execute({
      action: 'report_capabilities',
      operationId: randomUUID(),
      spaceId,
      assignee: 'codex:two',
      capabilities: [
        { kind: 'tool', name: 'Browser automation', description: 'Inspect browser screenshots' },
      ],
    })
    memory.connectionStatus = () => [
      {
        id: connectionId,
        code: 'TEST',
        label: 'Chat',
        provider: 'codex',
        state: 'connected',
        expiresAt: Date.now() + 60_000,
      },
    ]
    const captured = store.edit({
      action: 'create',
      id: randomUUID(),
      title: 'Browser review',
      text: 'Inspect browser screenshots',
      workspaceId,
      sharedSpaceId: spaceId,
    })
    const idea = save(captured, {
      assignments: [
        {
          id: randomUUID(),
          provider: 'codex',
          assignee: 'codex:two',
          title: 'Inspect browser',
          brief: 'Inspect the browser and save evidence.',
          rationale: 'Browser automation was manually reported; check availability first.',
        },
      ],
    })
    const send = vi.spyOn(service.agent, 'send').mockResolvedValue({ ok: true })
    expect(
      (
        await service.request({
          action: 'chat',
          id: idea.id,
          text: 'Who should inspect the browser?',
        })
      ).ok,
    ).toBe(true)
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('Browser automation'),
      'Who should inspect the browser?',
    )
    expect(send.mock.calls[0]![0]).toContain('human review')
    expect(send.mock.calls[0]![0]).toContain('untrusted descriptive data')
    expect(memory.tasks()).toHaveLength(0)
    const output = memory
      .snapshot()
      .folders.find((f) => f.spaceId === spaceId && f.title === 'Results')!
    expect(
      (
        await service.request({
          action: 'prepare',
          id: idea.id,
          revision: idea.revision,
          folderId: output.id,
        })
      ).ok,
    ).toBe(true)
    const tasks = memory.tasks().filter((t) => t.spaceId === spaceId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      state: 'draft',
      body: expect.stringContaining('Browser automation was manually reported'),
    })
  })
  it('creates named, persistent spaces with separate documents inside one workspace', async () => {
    const first = {
      action: 'create_space',
      id: randomUUID(),
      root: box.root,
      title: 'Advert storyboard',
    }
    const result = await service.request(first)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const firstId = result.spaceId!
    const base = join(box.root, 'shared-spaces', 'advert-storyboard')
    for (const area of ['notes', 'plans', 'handoffs', 'results'])
      expect(existsSync(join(base, area))).toBe(true)
    expect(JSON.parse(readFileSync(join(base, 'space.json'), 'utf8'))).toMatchObject({
      format: 'threadlight.shared-space',
      version: 1,
      id: firstId,
      name: first.title,
    })
    expect(existsSync(join(base, 'README.md'))).toBe(true)
    expect(await service.request(first)).toMatchObject({ ok: true, spaceId: firstId })
    const second = await service.request({
      action: 'create_space',
      id: randomUUID(),
      root: box.root,
      title: 'App redesign',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    for (const spaceId of [firstId, second.spaceId!]) {
      const saved = await service.request({
        action: 'create',
        id: randomUUID(),
        title: 'Idea',
        text: 'Keep in the selected space',
        workspaceId,
        sharedSpaceId: spaceId,
      })
      expect(saved.ok).toBe(true)
      const idea = store.all().find((i) => i.sharedSpaceId === spaceId)!
      const directory = store.locations().find((l) => l.spaceId === spaceId)!.directory
      expect(store.documents().find((d) => d.id === idea.id)?.path).toContain(
        join('shared-spaces', directory, 'notes'),
      )
      const outputFolder = memory
        .snapshot()
        .folders.find((f) => f.spaceId === spaceId && f.title === 'Handoffs')!
      const note = memory.execute({
        action: 'create_item',
        operationId: randomUUID(),
        folderId: outputFolder.id,
        title: 'Context',
        body: 'Shared context',
        kind: 'note',
      }) as { id: string }
      expect(store.documents().find((d) => d.id === note.id)?.path).toContain(
        join('shared-spaces', directory, 'handoffs'),
      )
      expect(memory.executionContext(spaceId)?.documentsRoot).toBe(
        join(box.root, 'shared-spaces', directory),
      )
    }
    const reopened = new SpacesStore(join(box.root, 'ideas.sqlite'))
    try {
      expect(reopened.locations()).toEqual(store.locations())
      expect(reopened.all().filter((i) => i.sharedSpaceId)).toHaveLength(2)
    } finally {
      reopened.close()
    }
    // An unrelated legacy layout problem must not redirect or block a named space.
    const legacyPlans = join(box.root, 'shared-spaces', 'plans')
    renameSync(legacyPlans, legacyPlans + '-offline')
    expect(
      (
        await service.request({
          action: 'create',
          id: randomUUID(),
          title: 'Still isolated',
          text: 'Named space remains available',
          workspaceId,
          sharedSpaceId: firstId,
        })
      ).ok,
    ).toBe(true)
    renameSync(legacyPlans + '-offline', legacyPlans)
  })
  it('keeps unknown folders and existing space identities intact, and detects missing manifests', async () => {
    const base = join(box.root, 'shared-spaces', 'keep-me')
    mkdirSync(base)
    writeFileSync(join(base, 'personal.txt'), 'Keep this')
    expect(
      (
        await service.request({
          action: 'create_space',
          id: randomUUID(),
          root: box.root,
          title: 'Keep me',
        })
      ).ok,
    ).toBe(false)
    expect(readFileSync(join(base, 'personal.txt'), 'utf8')).toBe('Keep this')
    const input = { action: 'create_space', id: randomUUID(), root: box.root, title: 'Reliable' }
    const result = await service.request(input)
    expect(result.ok).toBe(true)
    expect((await service.request({ ...input, title: 'Changed name' })).ok).toBe(false)
    if (!result.ok) return
    const manifest = join(box.root, 'shared-spaces', 'reliable', 'space.json')
    renameSync(manifest, manifest + '.saved')
    expect(service.snapshot().locations?.find((l) => l.spaceId === result.spaceId)?.ready).toBe(
      false,
    )
    expect(
      (
        await service.request({
          action: 'create',
          id: randomUUID(),
          title: 'Blocked',
          text: 'Do not write elsewhere',
          workspaceId,
          sharedSpaceId: result.spaceId,
        })
      ).ok,
    ).toBe(false)
  })
  it('creates no loose area folders when a workspace starts with named spaces', async () => {
    const root = join(box.root, 'clean-project')
    mkdirSync(root)
    sessions[0]!.cwd = root
    const result = await service.request({
      action: 'create_space',
      id: randomUUID(),
      root,
      title: 'First space',
    })
    expect(result.ok).toBe(true)
    for (const area of ['notes', 'plans', 'handoffs', 'results']) {
      expect(existsSync(join(root, area))).toBe(false)
      expect(existsSync(join(root, 'shared-spaces', area))).toBe(false)
      expect(existsSync(join(root, 'shared-spaces', 'first-space', area))).toBe(true)
    }
  })
  it('sets up only fixed workspace folders, preserves existing files and is repeatable', async () => {
    const root = join(box.root, 'shared-spaces')
    writeFileSync(join(root, 'notes', 'personal.md'), 'Keep this file')
    const count = memory.snapshot().spaces.length
    expect((await service.request({ action: 'setup', root: box.root })).ok).toBe(true)
    expect(memory.snapshot().spaces).toHaveLength(count)
    for (const area of ['notes', 'plans', 'handoffs', 'results'])
      expect(existsSync(join(root, area))).toBe(true)
    expect(readFileSync(join(root, 'notes', 'personal.md'), 'utf8')).toBe('Keep this file')
    expect((await service.request({ action: 'setup', root: join(box.root, '..') })).ok).toBe(false)
  })
  it('blocks Agent work, direct assignments and dispatch until material is associated with setup', async () => {
    const legacy = store.edit({
      action: 'create',
      id: randomUUID(),
      title: 'Unassigned',
      text: 'Keep me',
    })
    const idea = save(legacy)
    expect(await service.request({ action: 'chat', id: idea.id, text: 'Start' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Set up'),
    })
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
    const space = memory.execute({
      action: 'create_space',
      operationId: randomUUID(),
      title: 'Legacy',
    }) as MemorySpace
    const oldFolder = (
      memory.execute({
        action: 'ensure_folder',
        operationId: randomUUID(),
        spaceId: space.id,
        title: 'Notes',
        description: 'Old context',
        reason: 'Legacy',
      }) as { folder: MemoryFolder }
    ).folder
    expect(() =>
      memory.execute({
        action: 'create_task',
        operationId: randomUUID(),
        folderId: oldFolder.id,
        title: 'Attempt bypass',
        body: 'Do work',
        assignee: 'claude-one',
      }),
    ).toThrow('Set up')
  })
  it('preserves external edits and rejects saves without changing the database revision', async () => {
    const idea = capture(),
      doc = store.documents().find((d) => d.id === idea.id)!
    writeFileSync(doc.path, '# Human edit\nDo not overwrite')
    expect(() => save(idea)).toThrow('External edit preserved')
    expect(store.get(idea.id).revision).toBe(idea.revision)
    expect(readFileSync(doc.path, 'utf8')).toContain('Do not overwrite')
  })
  it('uses stable IDs and retains earlier readable snapshots when a title changes', () => {
    const idea = capture(),
      first = store.documents().find((d) => d.id === idea.id)!
    const next = save(idea, { title: 'Renamed idea' })
    const second = store.documents().find((d) => d.id === idea.id)!
    expect(second.id).toBe(first.id)
    expect(second.path).not.toBe(first.path)
    expect(readFileSync(first.path, 'utf8')).toContain('Quiet updates')
    expect(readFileSync(second.path, 'utf8')).toContain('Renamed idea')
    expect(next.revision).toBe(2)
  })
  it('requires a fresh migration preview, preserves IDs/history and detects file conflicts', async () => {
    const legacy = store.edit({
      action: 'create',
      id: randomUUID(),
      title: 'Old idea',
      text: 'Original',
    })
    store.bind(legacy.id, 'codex:saved-discussion')
    const input = { workspaceId, ideaIds: [legacy.id], spaceIds: [] }
    const preview = await service.request({ action: 'migration_preview', ...input })
    if (!preview.ok || !preview.migration) throw new Error('Missing preview')
    writeFileSync(preview.migration.files[0]!, 'Existing file must survive')
    expect(
      (await service.request({ action: 'migrate', ...input, token: preview.migration.token })).ok,
    ).toBe(false)
    expect(store.get(legacy.id).workspaceId).toBeNull()
    const conflict = await service.request({ action: 'migration_preview', ...input })
    expect(conflict.ok && conflict.migration?.conflicts.length).toBe(1)
    renameSync(preview.migration.files[0]!, preview.migration.files[0]! + '.preserved')
    const fresh = await service.request({ action: 'migration_preview', ...input })
    if (!fresh.ok || !fresh.migration) throw new Error('Missing preview')
    expect(
      (await service.request({ action: 'migrate', ...input, token: fresh.migration.token })).ok,
    ).toBe(true)
    expect(store.get(legacy.id)).toMatchObject({
      id: legacy.id,
      workspaceId,
      conversationId: 'codex:saved-discussion',
    })
    expect(readFileSync(preview.migration.files[0]! + '.preserved', 'utf8')).toBe(
      'Existing file must survive',
    )
  })
  it('migrates shared material explicitly and writes later peer results in the original workspace', async () => {
    const space = memory.execute({
      action: 'create_space',
      operationId: randomUUID(),
      title: 'Old shared material',
    }) as MemorySpace
    const oldFolder = (
      memory.execute({
        action: 'ensure_folder',
        operationId: randomUUID(),
        spaceId: space.id,
        title: 'Notes',
        description: 'Context',
        reason: 'Legacy',
      }) as { folder: MemoryFolder }
    ).folder
    const item = memory.execute({
      action: 'create_item',
      operationId: randomUUID(),
      folderId: oldFolder.id,
      title: 'Peer finding',
      body: 'Verified evidence',
    }) as { id: string }
    const input = { workspaceId, ideaIds: [], spaceIds: [space.id] }
    const preview = await service.request({ action: 'migration_preview', ...input })
    if (!preview.ok || !preview.migration) throw new Error('Missing preview')
    expect(
      (await service.request({ action: 'migrate', ...input, token: preview.migration.token })).ok,
    ).toBe(true)
    memory.execute({
      action: 'revise_item',
      operationId: randomUUID(),
      id: item.id,
      expectedRevision: 1,
      body: 'Later peer finding',
    })
    const doc = store.documents().find((d) => d.id === item.id)!
    expect(doc.workspaceId).toBe(workspaceId)
    expect(readFileSync(doc.path, 'utf8')).toContain('Later peer finding')
  })
  it('blocks missing or redirected directories and never falls back to another path', async () => {
    const idea = save(capture()),
      path = join(box.root, 'shared-spaces', 'plans')
    renameSync(path, path + '-saved')
    expect((await service.request({ action: 'chat', id: idea.id, text: 'Start' })).ok).toBe(false)
    expect(service.snapshot().workspaces[0]!.ready).toBe(false)
    symlinkSync(path + '-saved', path, process.platform === 'win32' ? 'junction' : 'dir')
    expect((await service.request({ action: 'setup', root: box.root })).ok).toBe(false)
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
  })
  it('rechecks setup before authorization and dispatch, and saves replies in the bound results folder', async () => {
    const idea = save(capture())
    expect(
      (
        await service.request({
          action: 'prepare',
          id: idea.id,
          revision: idea.revision,
          folderId: folder.id,
        })
      ).ok,
    ).toBe(true)
    const task = memory.tasks()[0]!
    expect(task.workspaceId).toBe(workspaceId)
    memory.execute({ action: 'authorize_task', operationId: randomUUID(), id: task.id })
    const path = join(box.root, 'shared-spaces', 'results')
    renameSync(path, path + '-saved')
    expect(() => memory.reserveDispatch(task.id)).toThrow('missing')
    expect(() =>
      memory.execute({
        action: 'authorize_task',
        operationId: randomUUID(),
        id: memory.tasks()[1]!.id,
      }),
    ).toThrow('missing')
    expect(memory.tasks()[0]!.state).toBe('queued')
    renameSync(path + '-saved', path)
    memory.updateDelivery(task.id, { state: 'completed', reply: 'Later provider result' })
    const result = store.documents().find((d) => d.id === `result-${task.id}`)!
    expect(result.workspaceId).toBe(workspaceId)
    expect(result.path.startsWith(path)).toBe(true)
    expect(readFileSync(result.path, 'utf8')).toContain('Later provider result')
  })
  it('maps workspace aliases to one identity without redirecting active ownership', async () => {
    const alias = join(box.root, 'alias')
    symlinkSync(box.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    sessions[0]!.cwd = alias
    expect((await service.request({ action: 'setup', root: alias })).ok).toBe(true)
    expect(store.workspaces()).toHaveLength(1)
    expect(service.snapshot().workspaces[0]!.aliases).toContain(alias)
    expect(store.workspaces()[0]!.id).toBe(workspaceId)
  })
  it('isolates workspaces and rejects cross-workspace destinations', async () => {
    const otherRoot = join(box.root, 'other')
    mkdirSync(otherRoot)
    sessions[1]!.cwd = otherRoot
    expect((await service.request({ action: 'setup', root: otherRoot })).ok).toBe(true)
    const otherId = store.workspaces().find((w) => w.id !== workspaceId)!.id
    const idea = save(capture())
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
    const otherIdea = store.edit({
      action: 'create',
      id: randomUUID(),
      workspaceId: otherId,
      title: 'Other project',
      text: 'Separate',
    })
    expect(store.documents().find((d) => d.id === otherIdea.id)!.workspaceId).toBe(otherId)
    const preview = await service.request({
      action: 'migration_preview',
      workspaceId: otherId,
      ideaIds: [idea.id],
      spaceIds: [],
    })
    expect(
      preview.ok && preview.migration?.conflicts.some((c) => c.includes('another workspace')),
    ).toBe(true)
  })
  it('backs up the old schema and keeps old ideas unassigned on upgrade', () => {
    const path = join(box.root, 'v1.sqlite'),
      old = new DatabaseSync(path),
      id = randomUUID()
    old.exec('CREATE TABLE ideas(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=1;')
    const idea = { ...capture(), id }
    const { workspaceId: unused, ...legacy } = idea
    void unused
    old.prepare('INSERT INTO ideas VALUES(?,?)').run(id, JSON.stringify(legacy))
    old.close()
    const upgraded = new SpacesStore(path)
    try {
      expect(upgraded.get(id).workspaceId).toBeNull()
      expect(existsSync(path + '.before-workspaces')).toBe(true)
    } finally {
      upgraded.close()
    }
  })
  it('captures without provider calls, survives restart, rejects stale edits and duplicate capture conflicts', () => {
    const idea = capture()
    const moved = save(idea)
    expect(() => save(idea)).toThrow('changed')
    store.close()
    store = new SpacesStore(join(box.root, 'ideas.sqlite'))
    expect(store.get(idea.id)).toEqual(moved)
    expect(store.workspaces()[0]!.id).toBe(workspaceId)
    expect(store.owners()[folder.spaceId]).toBe(workspaceId)
    const restoredDocument = store.documents().find((d) => d.id === idea.id)!
    expect(restoredDocument.workspaceId).toBe(workspaceId)
    expect(readFileSync(restoredDocument.path, 'utf8')).toContain(moved.text)
    expect(() =>
      store.edit({
        action: 'create',
        id: idea.id,
        title: 'Different',
        text: idea.text,
        workspaceId,
      }),
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
    const first = save(capture(folder.spaceId)),
      second = save(capture(folder.spaceId))
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
    expect(send.mock.calls[0]![0]).toContain('Use scoped note tools')
    expect(send.mock.calls[0]![0]).toContain('exact human-authorized revision')
    expect(send.mock.calls[0]![0]).not.toContain('propose only')
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

  it('waits for Brainstorm retirement before starting a different discussion or reporting End complete', async () => {
    const first = save(capture(folder.spaceId)),
      second = save(capture(folder.spaceId))
    const send = vi.spyOn(service.agent, 'send').mockResolvedValue({ ok: true })
    const close = vi.spyOn(service.agent, 'close').mockResolvedValue()
    expect((await service.request({ action: 'chat', id: first.id, text: 'First' })).ok).toBe(true)
    let release!: () => void
    close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const next = service.request({ action: 'chat', id: second.id, text: 'Second' })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2))
    expect(send).toHaveBeenCalledTimes(1)
    release()
    expect((await next).ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
    let ended = false
    const ending = service.request({ action: 'close', id: second.id }).then(() => {
      ended = true
    })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(3))
    expect(ended).toBe(false)
    expect((await service.request({ action: 'chat', id: first.id, text: 'Too early' })).ok).toBe(
      false,
    )
    expect(send).toHaveBeenCalledTimes(2)
    release()
    await ending
    expect(service.snapshot().activeId).toBeNull()
  })
})
