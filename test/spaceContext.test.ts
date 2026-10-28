import { randomUUID } from 'node:crypto'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { request as httpRequest } from 'node:http'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { AgentRun } from '../src/main/agent/agentRun'
import { afterEach, describe, expect, it } from 'vitest'
import { SpacesStore } from '../src/main/spaces/store'
import { MemoryStore } from '../src/main/memory/store'
import { SpaceContextService } from '../src/main/spaces/context'
import { SpaceContextServer } from '../src/main/spaces/contextServer'
import { ThreadReadServer } from '../src/main/threadRead/server'
import { ThreadReadService } from '../src/main/threadRead/service'
import { unknownStatus, type ThreadAdapter } from '../src/main/threadRead/types'
import type { MemorySpace } from '../src/shared/memory'
import type { Session } from '../src/shared/types'
import { ideaSchema } from '../src/shared/spaces'
import {
  SPACE_CONTEXT_TOOLS,
  SPACE_CONTEXT_SERVER,
  BRAINSTORM_INSTRUCTIONS,
} from '../src/shared/spaceContext'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'threadlight-space-context-'))
  const store = new SpacesStore(join(root, 'notes.sqlite')),
    memory = new MemoryStore(join(root, 'memory.sqlite'))
  cleanup.push(
    () => store.close(),
    () => memory.close(),
  )
  const workspaceId = randomUUID()
  store.putWorkspace({ id: workspaceId, root, name: 'Same workspace', ready: true, issue: null })
  const spaces = ['Threadlight', 'Private design'].map(
    (title) =>
      memory.execute({ action: 'create_space', operationId: randomUUID(), title }) as MemorySpace,
  )
  store.assign(
    workspaceId,
    [],
    spaces.map((s) => s.id),
  )
  const notes = spaces.map((space, index) =>
    store.edit({
      action: 'create',
      id: randomUUID(),
      title: index ? 'Other-space secret' : 'Restart decision',
      text: index ? 'Do not disclose by default' : 'Graceful restart must preserve drafts',
      sharedSpaceId: space.id,
      workspaceId,
    }),
  )
  const discussion = store.discussion(
    {
      action: 'create_discussion',
      id: randomUUID(),
      spaceId: spaces[0]!.id,
      title: 'Space planning',
      noteIds: [notes[0]!.id],
    },
    workspaceId,
  )
  const grants = spaces.map(
    (space, index) =>
      memory.execute({
        action: 'create_grant',
        operationId: randomUUID(),
        spaceId: space.id,
        title: `Chat ${index}`,
        assignee: `codex:${index ? 'other' : 'one'}`,
        readOnly: true,
      }) as { grant: { id: string } },
  )
  const adapter: ThreadAdapter = {
    provider: 'codex',
    catalog: async () => ({
      entries: ['one', 'other'].map((nativeId) => ({
        provider: 'codex',
        nativeId,
        title: nativeId,
        titleSource: 'explicit',
        workspace: root,
        archived: false,
        lastActiveAt: 1,
      })),
      complete: true,
      sources: [],
    }),
    locate: async (nativeId) => ({
      provider: 'codex',
      nativeId,
      title: nativeId,
      titleSource: 'explicit',
      workspace: root,
      archived: false,
      lastActiveAt: 1,
    }),
    read: async () => ({
      items: Array.from({ length: 130 }, (_, i) => ({
        id: String(i),
        text: i === 0 ? 'old restart decision: preserve drafts' : `ordinary message ${i}`,
        role: 'assistant',
        kind: 'message',
        phase: 'final',
        at: i + 1,
        turnId: String(i),
        complete: true,
        source: 'fixture',
      })),
      sources: [{ source: 'fixture_history', health: 'ok', checkedAt: Date.now() }],
      status: unknownStatus(),
      coverage: [],
      changedDuringRead: false,
    }),
  }
  const reader = new ThreadReadServer(new ThreadReadService([adapter], () => ['codex']))
  await reader.start()
  cleanup.push(() => reader.close())
  const service = new SpaceContextService(
    store,
    () => memory,
    () =>
      [
        { id: 'codex:one', provider: 'codex', cwd: root, state: 'working', title: 'Build' },
      ] as Session[],
    reader,
  )
  const server = new SpaceContextServer(service)
  await server.start()
  cleanup.push(() => server.close())
  return { root, workspaceId, store, memory, spaces, notes, discussion, grants, service, server }
}
describe('space-aware Brainstorm', () => {
  it('reads handoffs, questions and real authors without dispatching or accepting results', async () => {
    const f = await fixture(),
      spaceId = f.spaces[0]!.id
    const ensured = f.memory.execute({
      action: 'ensure_folder',
      operationId: randomUUID(),
      spaceId,
      title: 'Handoffs',
      description: 'Fixture',
      reason: 'Fixture',
    }) as { folder: { id: string } }
    f.memory.execute({
      action: 'create_task',
      operationId: randomUUID(),
      folderId: ensured.folder.id,
      title: 'Review restart',
      body: 'Check draft preservation',
      assignee: 'codex:one',
    })
    const questionId = randomUUID()
    f.memory.communications.put(
      'question',
      {
        id: questionId,
        spaceId,
        sender: 'codex:one',
        audience: 'human',
        body: 'Should we retain the old plan?',
        choices: ['Yes', 'No'],
        generation: 'generation-one',
        state: 'pending',
        at: Date.now(),
      },
      'Question asked',
    )
    const scope = f.service.open(f.discussion.id)
    const activity = await f.service.call(scope, 'threadlight_get_space_activity', {})
    expect(JSON.stringify(activity)).toContain('Review restart')
    const question = await f.service.call(scope, 'threadlight_read_space_source', {
      sourceRef: `communication-question:${questionId}`,
    })
    expect(JSON.stringify(question)).toContain('codex:one')
    expect(JSON.stringify(question)).toContain('pending')
    expect(f.memory.tasks()[0]!.state).toBe('draft')
    expect(f.memory.communications.get('question', questionId).state).toBe('pending')
    expect(f.memory.communications.list('message')).toEqual([])
    f.service.close(scope)
  })
  it('Claude receives only the scoped MCP, executes a read and rejects shell/worker escalation', async () => {
    const f = await fixture(),
      stdin = new PassThrough(),
      stdout = new PassThrough(),
      stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => true })
    let argv: string[] = []
    const replies: string[] = []
    stdin.on('data', (data) => replies.push(String(data)))
    const run = new AgentRun({
      cli: { command: 'fake', prefixArgs: [] },
      model: 'fixture',
      workspace: f.root,
      onChange: () => {},
      spaceContext: () => f.server.connect(f.discussion.id),
      start: (_c, args) => {
        argv = args
        return child as never
      },
    })
    try {
      run.send('Read my space')
      expect(argv[argv.indexOf('--tools') + 1]).toBe('')
      expect(argv).toContain('--strict-mcp-config')
      expect(argv).not.toContain('--agents')
      expect(argv[argv.indexOf('--append-system-prompt') + 1]).toContain(BRAINSTORM_INSTRUCTIONS)
      const config = JSON.parse(argv[argv.indexOf('--mcp-config') + 1]!) as {
        mcpServers: Record<string, { url: string; headers: Record<string, string> }>
      }
      expect(Object.keys(config.mcpServers)).toEqual([SPACE_CONTEXT_SERVER])
      const endpoint = config.mcpServers[SPACE_CONTEXT_SERVER]!
      const rpc = () =>
        fetch(endpoint.url, {
          method: 'POST',
          headers: { ...endpoint.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'threadlight_get_space_context', arguments: {} },
          }),
        })
      expect(await (await rpc()).text()).toContain('Restart decision')
      for (const name of ['Bash', 'Task', 'mcp__outside__send_message']) {
        stdout.write(
          JSON.stringify({
            type: 'control_request',
            request_id: name,
            request: { subtype: 'can_use_tool', tool_name: name, input: {} },
          }) + '\n',
        )
        expect(replies.at(-1)).toContain('deny')
      }
      run.close()
      expect((await rpc()).status).toBe(401)
    } finally {
      run.close()
    }
  })
  it('keeps notes when creating independent discussions and preserves versioned source evidence', async () => {
    const f = await fixture(),
      scope = f.service.open(f.discussion.id)
    expect(f.store.all()).toHaveLength(2)
    expect(f.store.discussions()).toHaveLength(1)
    const old = f.notes[0]!
    f.store.edit({
      action: 'save',
      id: old.id,
      revision: old.revision,
      title: old.title,
      text: 'Revised note',
      stage: old.stage,
      plan: '',
      assignments: [],
    })
    const source = await f.service.call(scope, 'threadlight_read_space_source', {
      sourceRef: `note:${old.id}`,
      revision: '1',
    })
    expect(source).toMatchObject({
      outcome: 'ok',
      source: { revision: '1', body: expect.stringContaining('preserve drafts') },
    })
    expect(() =>
      f.store.discussion(
        {
          action: 'create_discussion',
          id: f.discussion.id,
          spaceId: f.spaces[1]!.id,
          title: 'Different',
          noteIds: [],
        },
        f.workspaceId,
      ),
    ).toThrow()
    f.service.close(scope)
  })
  it('isolates spaces sharing a workspace, permits explicit comparison, and rejects spoofed writes', async () => {
    const f = await fixture(),
      scope = f.service.open(f.discussion.id)
    const overview = await f.service.call(scope, 'threadlight_get_space_context', {})
    expect(JSON.stringify(overview)).toContain('Restart decision')
    expect(JSON.stringify(overview)).not.toContain('Other-space secret')
    expect(
      await f.service.call(scope, 'threadlight_read_space_source', {
        sourceRef: `note:${f.notes[1]!.id}`,
      }),
    ).toMatchObject({ outcome: 'not_found' })
    await expect(
      f.service.call(scope, 'threadlight_send_message', { confirmed: true }),
    ).rejects.toThrow()
    await expect(
      f.service.call(scope, 'threadlight_get_space_context', { spaceId: f.spaces[1]!.id }),
    ).rejects.toThrow()
    const comparison = f.service.open(f.discussion.id, [f.spaces[1]!.id])
    expect(
      JSON.stringify(await f.service.call(comparison, 'threadlight_get_space_context', {})),
    ).toContain('Other-space secret')
    f.service.close(comparison)
    f.service.close(scope)
    await expect(f.service.call(scope, 'threadlight_get_space_context', {})).rejects.toThrow()
  })
  it('searches older transcript pages, keeps exact membership and revokes existing references', async () => {
    const f = await fixture(),
      scope = f.service.open(f.discussion.id)
    const discovery = (await f.service.call(scope, 'threadlight_find_threads', { query: '' })) as {
      candidates: { threadRef: string; title: string }[]
    }
    expect(discovery.candidates.map((c) => c.title)).toEqual(['one'])
    const threadRef = discovery.candidates[0]!.threadRef
    const recent = (await f.service.call(scope, 'threadlight_search_thread', {
      threadRef,
      query: 'restart',
    })) as { items: unknown[]; nextCursor?: string }
    expect(recent.items).toEqual([])
    expect(recent.nextCursor).toBeTruthy()
    const older = (await f.service.call(scope, 'threadlight_search_thread', {
      threadRef,
      query: 'restart',
      cursor: recent.nextCursor,
    })) as { items: { text: string }[] }
    expect(older.items[0]?.text).toContain('old restart decision')
    const grant = f.memory.snapshot().grants.find((g) => g.assignee === 'codex:one')!
    f.memory.execute({ action: 'revoke_grant', operationId: randomUUID(), id: grant.id })
    expect(await f.service.call(scope, 'threadlight_read_thread', { threadRef })).toMatchObject({
      outcome: 'out_of_scope',
    })
    f.service.close(scope)
  })
  it('enforces loopback endpoint policy, exact inventory and caller revocation', async () => {
    const f = await fixture(),
      connection = f.server.connect(f.discussion.id)
    const rpc = (method: string, headers = {}, params?: unknown) =>
      fetch(connection.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    const tools = (await (await rpc('tools/list')).json()) as {
      result: { tools: { name: string }[] }
    }
    expect(tools.result.tools.map((t) => t.name)).toEqual(SPACE_CONTEXT_TOOLS)
    expect((await rpc('tools/list', { Origin: 'null' })).status).toBe(403)
    const wrongHost = await new Promise<number>((resolve) => {
      const req = httpRequest(
        connection.endpoint,
        { method: 'POST', headers: { Host: 'localhost' } },
        (res) => {
          res.resume()
          resolve(res.statusCode!)
        },
      )
      req.end()
    })
    expect(wrongHost).toBe(403)
    const failed = (await (
      await rpc('tools/call', {}, { name: 'threadlight_restart_app', arguments: {} })
    ).json()) as { error?: unknown }
    expect(failed.error).toBeTruthy()
    connection.close()
    expect((await rpc('tools/list')).status).toBe(401)
  })
  it('migrates old brainstorm records once without losing original IDs or conversations', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'threadlight-notes-migration-')), 'old.sqlite')
    const old = new DatabaseSync(file),
      id = randomUUID()
    old.exec('CREATE TABLE ideas(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=3;')
    const note = ideaSchema.parse({
      id,
      title: 'Old plan',
      text: 'Keep me',
      stage: 'brainstorm',
      revision: 7,
      plan: 'Reviewed plan',
      assignments: [],
      conversationId: 'codex:original',
      prepared: { folderId: randomUUID(), taskIds: [randomUUID()] },
      at: 123,
    })
    old.prepare('INSERT INTO ideas VALUES(?,?)').run(id, JSON.stringify(note))
    old.close()
    let store = new SpacesStore(file)
    const discussion = store.discussions()[0]!
    expect(store.get(id)).toMatchObject(note)
    expect(discussion).toMatchObject({
      legacyNoteId: id,
      noteIds: [id],
      conversationId: 'codex:original',
      prepared: note.prepared,
      at: 123,
    })
    expect(existsSync(file + '.before-notes')).toBe(true)
    store.close()
    store = new SpacesStore(file)
    expect(store.discussions()).toHaveLength(1)
    expect(store.discussions()[0]!.id).toBe(discussion.id)
    store.close()
  })
})
