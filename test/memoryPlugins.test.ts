import type { Session } from '../src/shared/types'
import { projectParticipants } from '../src/shared/projectParticipants'
import { readFileSync } from 'node:fs'
import { SpacesStore } from '../src/main/spaces/store'
import { SpacesService } from '../src/main/spaces/service'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { createServer } from 'node:http'
import { MemoryTransport } from '../src/main/memory/transport'
import { memoryTestTransport } from './memoryTransportHelper'
import { backup } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/main/memory/store'
import { MemoryServer } from '../src/main/memory/server'
import { MemoryConnections } from '../src/main/memory/connections'
import { CommunicationService } from '../src/main/communication/service'
import type { MemoryInput, MemorySpace, MemoryFolder } from '../src/shared/memory'
import { sandbox, type Sandbox } from './helpers'

let auth: ReturnType<typeof memoryTestTransport>
let box: Sandbox, store: MemoryStore, server: MemoryServer
let space: MemorySpace, folder: MemoryFolder
const children: ChildProcessWithoutNullStreams[] = []
const execute = (input: MemoryInput) => store.execute({ ...input, operationId: randomUUID() })
const request = (provider: 'claude' | 'codex' = 'codex') => ({
  action: 'request',
  id: randomUUID(),
  secret: randomBytes(32).toString('hex'),
  provider,
  label: `Synthetic ${provider}`,
  spaceId: space.id,
})
const approve = (c: MemoryConnections, id: string, extra: Partial<MemoryInput> = {}) =>
  c.approve(id, {
    action: 'create_grant',
    spaceId: space.id,
    folderId: folder.id,
    title: 'Approved synthetic chat',
    ...extra,
  })
beforeEach(async () => {
  box = await sandbox()
  store = new MemoryStore(join(box.root, 'memory.sqlite'))
  store.connectionProjects = () => store.projectIdentities()
  auth = memoryTestTransport(box.root)
  server = new MemoryServer(store, auth)
  space = execute({ action: 'create_space', title: 'Allowed' }) as MemorySpace
  folder = (
    execute({
      action: 'ensure_folder',
      spaceId: space.id,
      parentId: null,
      title: 'Evidence',
      description: 'Verified evidence',
      reason: 'Synthetic',
    }) as { folder: MemoryFolder }
  ).folder
})
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((done) => {
          if (child.exitCode !== null) return done()
          const timer = setTimeout(() => {
            child.kill()
            done()
          }, 6500)
          child.once('close', () => {
            clearTimeout(timer)
            done()
          })
          child.stdin.end()
        }),
    ),
  )
  server.close()
  store.close()
  await box.cleanup()
})

describe('plugin enrollment authority and recovery', () => {
  it('refuses historical pending requests without a stored destination', () => {
    const c = server.connections,
      r = request()
    c.request(r)
    // Simulate an in-memory record created by the historical schema, not a new client.
    const records = (c as unknown as { records: Map<string, { spaceId?: string }> }).records
    delete records.get(r.id)!.spaceId
    expect(() => approve(c, r.id)).toThrow('legacy request')
    expect(() => c.request({ ...r, action: 'status' })).toThrow('legacy request')
    expect(store.snapshot().grants).toHaveLength(0)
    c.reject(r.id)
    expect(c.list()[0]!.state).toBe('rejected')
  })

  it('grants nothing until approved and keeps secrets out of public views', () => {
    const c = server.connections,
      r = request()
    const pending = c.request(r)
    expect(pending.state).toBe('pending')
    expect(() => c.authenticate(r.id, r.secret)).toThrow('Approve')
    expect(() => c.request({ ...r, action: 'status', secret: 'a'.repeat(64) })).toThrow(
      'unavailable',
    )
    const approved = approve(c, r.id)
    expect(approved.state).toBe('approved')
    const actor = c.authenticate(r.id, r.secret),
      brief = store.briefing(actor)
    expect(brief.enrollment).toMatchObject({
      folderId: folder.id,
      readOnly: true,
      createFolders: false,
      delegate: false,
    })
    expect(c.list()[0]?.state).toBe('connected')
    const view = JSON.stringify([pending, approved, c.list(), brief, store.snapshot()])
    expect(view).not.toContain(r.secret)
    expect(view).not.toContain('tokenHash')
    expect(view).not.toContain('secretHash')
    expect(() =>
      execute({
        action: 'create_grant',
        spaceId: space.id,
        title: 'bad',
        readOnly: true,
        createFolders: true,
      }),
    ).toThrow()
    expect(() =>
      c.approve(r.id, { action: 'create_grant', spaceId: space.id, title: 'duplicate' }),
    ).toThrow('no longer')
  })
  it('rejects scope/provider mismatch, denial, revocation and foreign connection IDs', () => {
    const c = server.connections,
      a = request(),
      b = request('claude')
    c.request(a)
    c.request(b)
    expect(() => approve(c, a.id, { assignee: randomUUID() })).toThrow('provider')
    approve(c, a.id, { assignee: `codex:${randomUUID()}` })
    expect(() => c.authenticate(b.id, a.secret)).toThrow('unavailable')
    c.reject(b.id)
    expect(c.request({ ...b, action: 'status' }).state).toBe('rejected')
    expect(() => approve(c, b.id)).toThrow('no longer')
    execute({ action: 'revoke_grant', id: c.list().find((r) => r.id === a.id)!.grantId })
    expect(() => c.authenticate(a.id, a.secret)).toThrow('capability')
    // Approval bound this previously unbound request to a native chat. A legacy
    // request cannot change that identity; status still reports the revoked grant.
    expect(() => c.request(a)).toThrow('Connection ID already used')
    expect(c.request({ ...a, action: 'status' }).state).toBe('rejected')
  })
  it('expires pending requests, preserves approved links and revokes only legacy orphan grants', () => {
    let now = 1000
    const c = new MemoryConnections(store, () => now),
      r = request()
    c.onChange = () => {
      c.list()
    }
    c.request(r)
    now += 300001
    expect(c.list()).toEqual([])
    expect(() => approve(c, r.id)).toThrow('no longer')
    const active = request()
    c.request(active)
    const granted = approve(c, active.id)
    now += 8 * 3600000 + 1
    c.sweep()
    expect(store.snapshot().grants.find((g) => g.id === granted.grantId)?.revoked).toBe(false)
    const manual = execute({ action: 'create_grant', spaceId: space.id, title: 'Manual' }) as {
      id: string
    }
    const orphan = execute({
      action: 'create_grant',
      spaceId: space.id,
      title: 'Historical orphan',
      connectionId: randomUUID(),
    }) as { id: string }
    new MemoryConnections(store)
    expect(store.snapshot().grants.find((g) => g.id === orphan.id)?.revoked).toBe(true)
    expect(store.snapshot().grants.find((g) => g.id === manual.id)?.revoked).toBe(false)
  })
  it('revokes access after restore and safely cleans up grants absent from the backup', async () => {
    const file = join(box.root, 'before-pairing.sqlite')
    await backup(store.databaseForBackup(), file)
    const c = server.connections,
      r = request()
    c.request(r)
    approve(c, r.id)
    expect(c.authenticate(r.id, r.secret).grantId).toBeTruthy()
    store.restoreFrom(file)
    expect(() => c.authenticate(r.id, r.secret)).toThrow()
    expect(() => c.close()).not.toThrow()
    expect(c.list()).toEqual([])
  })
  it('keeps briefings scoped, bounded and free of document bodies', () => {
    for (let i = 0; i < 42; i++)
      execute({
        action: 'ensure_folder',
        spaceId: space.id,
        parentId: folder.id,
        title: 'Sector ' + i,
        description: 'Purpose',
        reason: 'Test',
      })
    execute({
      action: 'create_item',
      folderId: folder.id,
      title: 'Private body',
      body: 'BODY_MUST_BE_READ_EXPLICITLY',
    })
    execute({ action: 'create_space', title: 'UNRELATED_SPACE_MUST_NOT_APPEAR' })
    const c = server.connections,
      r = request()
    c.request(r)
    approve(c, r.id)
    const brief = store.briefing(c.authenticate(r.id, r.secret))
    expect(brief.sectors).toHaveLength(40)
    expect(brief.omittedSectors).toBe(3)
    expect(brief.spaces.map((s) => s.id)).toEqual([space.id])
    expect(JSON.stringify(brief)).not.toContain('BODY_MUST_BE_READ_EXPLICITLY')
    expect(JSON.stringify(brief)).not.toContain('UNRELATED_SPACE_MUST_NOT_APPEAR')
  })
  it('bounds creation and exposes no approval route through HTTP', async () => {
    const endpoint = await server.start(0),
      base = endpoint.replace('/mcp', '/plugin/connect')
    const r = request()
    const post = (body: unknown, headers = {}) =>
      auth.fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    expect((await post(r, { Origin: 'http://example.test' })).status).toBe(403)
    expect((await post({ ...r, action: 'approve' })).status).toBe(400)
    expect((await post({ ...r, spaceId: randomUUID() })).status).toBe(400)
    expect((await post(r)).status).toBe(200)
    expect(
      (
        await auth.fetch(base.replace('/plugin/connect', '/plugin/mcp/' + r.id), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + r.secret, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
      ).status,
    ).toBe(401)
    for (let i = 0; i < 9; i++) server.connections.request(request())
    expect(() => server.connections.request(request())).toThrow('Too many')
  })
  it('requires paired writable enrollment for private runtime registration and never exposes tokens as tools', async () => {
    const endpoint = await server.start(0),
      r = request('claude')
    server.connections.request(r)
    const post = (body: unknown, secret = r.secret, origin?: string) =>
      auth.fetch(endpoint.replace('/mcp', `/plugin/runtime/${r.id}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      })
    const registration = { action: 'register', socket: 'test', token: 'PRIVATE_NATIVE_TEST_TOKEN' }
    expect((await post(registration)).status).toBe(401)
    approve(server.connections, r.id, { assignee: randomUUID(), readOnly: true })
    expect((await post(registration, 'invalid')).status).toBe(401)
    expect((await post(registration, r.secret, 'http://example.test')).status).toBe(403)
    const forbidden = await post(registration)
    expect(forbidden.status).toBe(400)
    expect(JSON.stringify(await forbidden.json())).not.toContain(registration.token)
    expect(
      (
        await post({
          action: 'register',
          socket: 'test',
          token: registration.token,
          target: randomUUID(),
        })
      ).status,
    ).toBe(400)
    server.connections.reject(r.id)
    expect((await post({ action: 'unregister' })).status).toBe(401)
  })
})

type Reply = {
  result?: {
    content?: { type: string; text?: string }[]
    isError?: boolean
    instructions?: string
    tools?: { name: string; inputSchema: { required?: string[] } }[]
  }
  error?: unknown
}
function bridge(provider: 'claude' | 'codex', endpoint: string) {
  const path = resolve(
    provider === 'codex' ? 'codex-plugin/scripts/memory-bridge.mjs' : 'scripts/memory-bridge.mjs',
  )
  const child = spawn(process.execPath, [path, '--provider', provider], {
    env: {
      ...process.env,
      THREADLIGHT_MEMORY_URL: endpoint,
      THREADLIGHT_MEMORY_AUTH_FILE: auth.authFile,
    },
    windowsHide: true,
    stdio: 'pipe',
  })
  children.push(child)
  let counter = 0,
    output = ''
  const pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += line
    const r = JSON.parse(line)
    pending.get(r.id)?.resolve(r)
    pending.delete(r.id)
  })
  child.once('exit', () => {
    for (const p of pending.values()) p.reject(new Error('Bridge exited'))
  })
  const rpc = (method: string, params?: unknown) =>
    new Promise<Reply>((resolveReply, reject) => {
      const id = ++counter
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Bridge response timed out'))
      }, 10000)
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolveReply(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  return {
    close: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) return done()
        child.once('close', () => done())
        child.stdin.end()
      }),
    rpc,
    output: () => output,
    call: (name: string, args: Record<string, unknown> = {}) =>
      rpc('tools/call', {
        name,
        arguments:
          name === 'memory_connect' && !args.connectionId ? { spaceId: space.id, ...args } : args,
      }),
  }
}
const value = (reply: Reply) => JSON.parse(reply.result!.content![0]!.text!)

it.each(['claude', 'codex'] as const)(
  '%s keeps its approved project link across app/bridge restarts and key rotation, until explicit disconnect',
  async (provider) => {
    const chatId = randomUUID(),
      assignee = provider === 'codex' ? `codex:${chatId}` : chatId
    let endpoint = await server.start(0)
    const first = bridge(provider, endpoint)
    const request = value(await first.call('memory_connect', { label: 'Persistent chat', chatId }))
    const approved = approve(server.connections, request.connectionId, {
      folderId: undefined,
      assignee,
      readOnly: false,
    })
    const args = { connectionId: request.connectionId }
    expect((await first.call('memory_briefing', args)).result?.isError).toBe(false)
    await first.close()
    expect(store.snapshot().grants.find((g) => g.id === approved.grantId)?.revoked).toBe(false)
    server.close()
    store.close()
    store = new MemoryStore(join(box.root, 'memory.sqlite'))
    store.connectionProjects = () => store.projectIdentities()
    auth = memoryTestTransport(box.root)
    server = new MemoryServer(store, auth)
    endpoint = await server.start(0)
    const linked = projectParticipants(
      { ...store.snapshot(), connections: server.connections.list() },
      [{ id: assignee, provider, title: 'Persistent chat' } as Session],
      space.id,
      Date.now() + 365 * 86400000,
    )
    expect(linked).toMatchObject([{ status: 'connected', canPublish: true }])
    expect(server.connections.list()).toMatchObject([{ id: request.connectionId, expiresAt: 0 }])
    const second = bridge(provider, endpoint)
    expect((await second.call('memory_connect', args)).result?.isError).toBe(true)
    expect(
      (await second.call('memory_connect', { ...args, chatId: randomUUID(), spaceId: space.id }))
        .result?.isError,
    ).toBe(true)
    const resumed = value(
      await second.call('memory_connect', { ...args, chatId, spaceId: space.id }),
    )
    expect(resumed).toMatchObject({
      connectionId: request.connectionId,
      state: 'connected',
      spaceId: space.id,
    })
    expect((await second.call('memory_briefing', args)).result?.isError).toBe(false)
    // A still-running bridge reads the new protected key on the next call; no write is replayed.
    const port = Number(new URL(endpoint).port)
    server.close()
    auth = memoryTestTransport(box.root)
    server = new MemoryServer(store, auth)
    await server.start(port)
    expect((await second.call('memory_briefing', args)).result?.isError).toBe(false)
    expect(server.connections.list().filter((c) => c.state === 'pending')).toHaveLength(0)
    const serialized = JSON.stringify([
      store.snapshot(),
      server.connections.list(),
      store.savedPairings(),
    ])
    expect(serialized).not.toContain('"token":')
    expect(serialized).not.toContain('"secret":')
    expect((await second.call('memory_disconnect', args)).result?.isError).toBe(false)
    server.close()
    server = new MemoryServer(store, auth)
    endpoint = await server.start(0)
    const third = bridge(provider, endpoint)
    expect(
      (await third.call('memory_connect', { ...args, chatId, spaceId: space.id })).result?.isError,
    ).toBe(true)
    expect(store.snapshot().grants.find((g) => g.id === approved.grantId)?.revoked).toBe(true)
    expect(
      projectParticipants(store.snapshot(), [{ id: assignee, provider } as Session], space.id)[0]
        ?.canPublish,
    ).toBe(false)
  },
)

it.each(['claude', 'codex'] as const)(
  '%s packaged workflow tools preserve scope, revision identity and human execution authority',
  async (provider) => {
    const target = `${provider === 'codex' ? 'codex:' : ''}${randomUUID()}`,
      human = { id: 'human', kind: 'human' as const }
    const service = new CommunicationService(store.communications, {
      destinations: async () => [],
      deliver: async () => {
        throw Error('No live delivery')
      },
      authorize: (actor, id) => store.authorizeCommunication(actor, id),
      input: (actor, id, revision) => store.communicationInput(actor, id, revision),
      project: (id) => store.space(id),
    })
    store.communicationService = service
    try {
      execute({
        action: 'update_space',
        id: space.id,
        mode: 'automatic',
        paused: false,
        durationMinutes: 60,
        maxDispatches: 20,
      })
      service.configure(
        {
          id: randomUUID(),
          spaceId: space.id,
          revision: 1,
          mode: 'automatic',
          paused: false,
          participants: [
            {
              id: randomUUID(),
              target,
              role: 'Coordinator',
              model: 'test',
              communicate: true,
              requestWork: true,
            },
          ],
          coordinator: target,
          maxConcurrent: 1,
          maxDispatches: 20,
          expiresAt: Date.now() + 3600000,
          recover: false,
          acceptBy: 'human',
        },
        0,
        human,
      )
      const b = bridge(provider, await server.start(0)),
        connectionId = value(
          await b.call('memory_connect', { label: 'Workflow fixture' }),
        ).connectionId
      approve(server.connections, connectionId, {
        folderId: undefined,
        readOnly: false,
        assignee: target,
      })
      const definition = {
        schemaVersion: 1,
        id: randomUUID(),
        spaceId: space.id,
        revision: 1,
        name: 'Packaged fixture',
        nodes: [
          { id: 'finish', type: 'finish', title: 'Finish', x: 0, y: 0, inputs: {}, success: true },
        ],
        edges: [],
        trigger: { type: 'manual' },
        maxConcurrent: 1,
        maxOperations: 5,
      }
      const saved = { connectionId, operationId: randomUUID(), expectedRevision: 0, definition }
      expect(value(await b.call('threadlight_save_process', saved))).toMatchObject({
        id: definition.id,
        revision: 1,
      })
      expect(value(await b.call('threadlight_save_process', saved))).toMatchObject({
        id: definition.id,
        revision: 1,
      })
      const invoke = {
        connectionId,
        operationId: randomUUID(),
        spaceId: space.id,
        definitionId: definition.id,
        revision: 1,
        objective: 'Packaged proof',
      }
      expect((await b.call('threadlight_invoke_process', invoke)).result?.isError).toBe(true)
      expect(
        (await b.rpc('tools/list')).result?.tools?.some(
          (t) => t.name === 'threadlight_authorize_process',
        ),
      ).toBe(false)
      await service.execute(
        'authorize_process',
        {
          operationId: randomUUID(),
          spaceId: space.id,
          definitionId: definition.id,
          revision: 1,
          triggers: false,
        },
        human,
      )
      const run = value(await b.call('threadlight_invoke_process', invoke))
      expect(run.status).toBe('running')
      expect(value(await b.call('threadlight_invoke_process', invoke)).id).toBe(run.id)
      await service.processes.tick()
      const snapshot = value(
        await b.call('threadlight_get_workflow', { connectionId, spaceId: space.id }),
      )
      expect(snapshot.processRuns[0]).toMatchObject({ id: run.id, status: 'completed' })
      expect(
        (
          await b.call('threadlight_save_process', {
            ...saved,
            operationId: randomUUID(),
            definition: { ...definition, id: randomUUID(), spaceId: randomUUID() },
          })
        ).result?.isError,
      ).toBe(true)
      expect(store.communications.list('message')).toHaveLength(0)
    } finally {
      service.close()
    }
  },
)

describe('actual packaged stdio bridges', { timeout: 30_000 }, () => {
  it.each(['claude', 'codex'] as const)(
    '%s discovers minimal projects before enrollment and binds approval immutably',
    async (provider) => {
      const other = execute({
        action: 'create_space',
        title: 'Allowed',
        description: 'SECRET_DESCRIPTION',
      }) as MemorySpace
      execute({
        action: 'create_item',
        folderId: folder.id,
        title: 'SECRET_FILENAME',
        body: 'SECRET_BODY',
      })
      const endpoint = await server.start(0)
      const b = bridge(provider, endpoint)
      const discovered = value(await b.call('memory_list_projects'))
      expect(discovered).toEqual({
        projects: [
          { id: space.id, name: 'Allowed' },
          { id: other.id, name: 'Allowed' },
        ],
      })
      expect(server.connections.list()).toEqual([])
      const tools = await b.rpc('tools/list')
      expect(JSON.stringify(tools)).toContain('clarify duplicate names')
      const skill = readFileSync(
        resolve(
          provider === 'codex'
            ? 'codex-plugin/skills/shared-memory/SKILL.md'
            : 'skills/shared-memory/SKILL.md',
        ),
        'utf8',
      )
      expect(skill).toContain('duplicate names')
      expect(skill).toContain('foreground project')
      const legacy = await b.rpc('tools/call', {
        name: 'memory_connect',
        arguments: { label: 'Old client' },
      })
      expect(legacy.result?.isError).toBe(true)
      const chatId = randomUUID()
      const pending = value(
        await b.call('memory_connect', {
          label: 'Bound request',
          spaceId: discovered.projects[1].id,
          chatId,
        }),
      )
      expect(pending).toMatchObject({
        spaceId: other.id,
        projectName: 'Allowed',
        chatId,
        state: 'pending',
      })
      expect((await b.call('memory_briefing', { connectionId: pending.id })).result?.isError).toBe(
        true,
      )
      expect((await b.call('memory_snapshot', { connectionId: pending.id })).result?.isError).toBe(
        true,
      )
      expect(
        (await b.call('memory_connect', { connectionId: pending.id, spaceId: space.id })).result
          ?.isError,
      ).toBe(true)
      const assignee = `${provider === 'codex' ? 'codex:' : ''}${chatId}`
      expect(() => approve(server.connections, pending.id, { assignee })).toThrow(
        'requested project',
      )
      expect(() =>
        approve(server.connections, pending.id, {
          spaceId: other.id,
          folderId: undefined,
          assignee: `${provider === 'codex' ? 'codex:' : ''}${randomUUID()}`,
        }),
      ).toThrow('exact requesting native chat')
      expect(store.snapshot().grants).toHaveLength(0)
      expect(
        value(
          await b.call('memory_wait_for_approval', { connectionId: pending.id, chatId, waitMs: 0 }),
        ),
      ).toMatchObject({ spaceId: other.id, state: 'pending', continuation: 'none' })
      approve(server.connections, pending.id, { spaceId: other.id, folderId: undefined, assignee })
      expect(
        value(
          await b.call('memory_wait_for_approval', { connectionId: pending.id, chatId, waitMs: 0 }),
        ),
      ).toMatchObject({ spaceId: other.id, continuation: 'verify-connection' })
      expect(value(await b.call('memory_connect', { connectionId: pending.id }))).toMatchObject({
        spaceId: other.id,
        state: 'approved',
      })
      const brief = value(await b.call('memory_briefing', { connectionId: pending.id }))
      expect(brief.spaces.map((p: { id: string }) => p.id)).toEqual([other.id])
      expect(JSON.stringify(brief)).not.toContain('SECRET_FILENAME')
      expect(JSON.stringify(brief)).not.toContain('SECRET_BODY')
      expect(
        (await b.call('memory_connect', { label: 'Unknown target', spaceId: randomUUID() })).result
          ?.isError,
      ).toBe(true)
      const raw = { ...request(provider), chatId }
      server.connections.request(raw)
      expect(() => server.connections.request({ ...raw, spaceId: other.id })).toThrow(
        'already used',
      )
      expect(() =>
        server.connections.request({ ...request(provider), spaceId: undefined }),
      ).toThrow('legacy request')
      // Exercise renamed and deleted persisted identities, without a fabricated success response.
      const db = store.databaseForBackup()
      const row = db.prepare('SELECT data FROM records WHERE id=?').get(other.id) as {
        data: string
      }
      db.prepare('UPDATE records SET data=? WHERE id=?').run(
        JSON.stringify({ ...JSON.parse(row.data), title: 'Renamed project' }),
        other.id,
      )
      expect(value(await b.call('memory_connect', { connectionId: pending.id })).projectName).toBe(
        'Renamed project',
      )
      db.prepare('DELETE FROM records WHERE id=?').run(other.id)
      expect(value(await b.call('memory_list_projects')).projects).toEqual([
        { id: space.id, name: 'Allowed' },
      ])
      expect((await b.call('memory_connect', { connectionId: pending.id })).result?.isError).toBe(
        true,
      )
      expect(
        (await b.call('memory_wait_for_approval', { connectionId: pending.id, chatId, waitMs: 0 }))
          .result?.isError,
      ).toBe(true)
      expect((await b.call('memory_briefing', { connectionId: pending.id })).result?.isError).toBe(
        true,
      )
      expect(
        (await b.call('memory_connect', { label: 'Deleted target', spaceId: other.id })).result
          ?.isError,
      ).toBe(true)
      store.connectionProjects = () => []
      expect(() => approve(server.connections, raw.id, { assignee })).toThrow('unavailable')
      expect(value(await b.call('memory_list_projects'))).toEqual({ projects: [] })
    },
  )

  it.each(['claude', 'codex'] as const)(
    '%s routes purpose through the packaged interface with persisted authenticated provenance',
    async (provider) => {
      const testSessions: Session[] = []
      const notes = new SpacesStore(join(box.root, 'notes.sqlite'))
      const spaces = new SpacesService(
        notes,
        () => store,
        () => testSessions,
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
        () => [box.root],
      )
      try {
        expect((await spaces.request({ action: 'setup', root: box.root })).ok).toBe(true)
        notes.assign(notes.workspaces()[0]!.id, [], [space.id])
        const b = bridge(provider, await server.start(0))
        const unassigned = execute({
          action: 'create_space',
          title: 'Unassigned legacy project',
        }) as MemorySpace
        expect(value(await b.call('memory_list_projects'))).toEqual({
          projects: store.projectIdentities().filter((p) => !!notes.owners()[p.id]),
        })
        expect(
          (
            await b.call('memory_connect', {
              label: 'Ineligible legacy space',
              spaceId: unassigned.id,
            })
          ).result?.isError,
        ).toBe(true)
        const chatId = randomUUID(),
          assignee = `${provider === 'codex' ? 'codex:' : ''}${chatId}`
        const connectionId = value(
          await b.call('memory_connect', { label: 'User idea saver', chatId, spaceId: space.id }),
        ).connectionId
        approve(server.connections, connectionId, { assignee, readOnly: false })
        const args = {
          connectionId,
          operationId: randomUUID(),
          folderId: folder.id,
          title: 'User idea',
          body: 'Keep this idea for me.',
          purpose: 'note',
        }
        const saved = value(await b.call('memory_create_item', args))
        expect(saved).toMatchObject({
          purpose: 'note',
          revision: 1,
          saver: { provider, chatId: assignee, connectionId },
        })
        expect(value(await b.call('memory_create_item', args))).toEqual(saved)
        expect(
          (await b.call('memory_create_item', { ...args, saver: { provider: 'human' } })).result
            ?.isError,
        ).toBe(true)
        expect(
          (
            await b.call('memory_create_item', {
              ...args,
              operationId: randomUUID(),
              author: 'Human',
            })
          ).result?.isError,
        ).toBe(true)
        const original = store.read({}, saved.id).revision
        expect(original.saver).toEqual(saved.saver)
        expect(original.purpose).toBe('note')
        expect(original.title).toBe(args.title)
        expect(spaces.snapshot().ideas.filter((n) => n.id === saved.id)).toHaveLength(1)
        expect(notes.revision(saved.id, 1).text).toBe(args.body)
        const firstPath = notes.documents().find((d) => d.id === saved.id)!.path
        expect(firstPath.replaceAll('\\', '/')).toContain('/notes/')
        expect(readFileSync(firstPath, 'utf8')).toContain(
          `Saved by ${provider === 'codex' ? 'Codex' : 'Claude'}`,
        )
        expect(readFileSync(firstPath, 'utf8')).toContain(assignee)
        const discussionId = randomUUID()
        expect(
          (
            await spaces.request({
              action: 'create_discussion',
              id: discussionId,
              spaceId: space.id,
              title: 'Discuss idea',
              noteIds: [saved.id],
            })
          ).ok,
        ).toBe(true)
        expect(notes.get(discussionId).noteIds).toEqual([saved.id])
        const edit = await spaces.request({
          action: 'save',
          id: saved.id,
          revision: 1,
          title: 'Human edit',
          text: 'Refined by the user.',
          stage: 'idea',
          plan: '',
          assignments: [],
        })
        expect(edit.ok).toBe(true)
        expect(store.read({}, saved.id).revision.saver?.provider).toBe('human')
        expect(store.read({}, saved.id, 1).revision).toEqual(original)
        expect(readFileSync(firstPath, 'utf8')).toContain(args.body)
        expect(
          (
            await b.call('memory_revise_item', {
              connectionId,
              operationId: randomUUID(),
              id: saved.id,
              expectedRevision: 1,
              body: 'Stale',
            })
          ).result?.isError,
        ).toBe(true)
        const corrected = value(
          await b.call('memory_revise_item', {
            connectionId,
            operationId: randomUUID(),
            id: saved.id,
            expectedRevision: 2,
            body: 'Continuation context',
            purpose: 'work_context',
          }),
        )
        expect(corrected).toMatchObject({
          id: saved.id,
          revision: 3,
          purpose: 'work_context',
          saver: { provider, chatId: assignee },
        })
        expect(spaces.snapshot().ideas.some((n) => n.id === saved.id)).toBe(false)
        expect(
          notes
            .documents()
            .find((d) => d.id === saved.id)!
            .path.replaceAll('\\', '/'),
        ).toContain('/handoffs/')
        expect(store.read({}, saved.id, 1).revision.purpose).toBe('note')
        expect(notes.get(discussionId).noteIds).toEqual([saved.id])
        for (const purpose of ['work_context', 'result', undefined]) {
          const item = value(
            await b.call('memory_create_item', { ...args, operationId: randomUUID(), purpose }),
          )
          expect(
            notes
              .documents()
              .find((d) => d.id === item.id)!
              .path.replaceAll('\\', '/'),
          ).toContain(purpose === 'result' ? '/results/' : '/handoffs/')
          expect(spaces.snapshot().ideas.some((n) => n.id === item.id)).toBe(false)
        }
        expect(store.tasks()).toEqual([])
        expect(store.snapshot().messages).toEqual([])
        const foreign = execute({ action: 'create_space', title: 'Other project' }) as MemorySpace
        const other = (
          execute({
            action: 'ensure_folder',
            spaceId: foreign.id,
            title: 'Private',
            description: 'Private',
            reason: 'Isolation',
          }) as { folder: MemoryFolder }
        ).folder
        expect(
          (
            await b.call('memory_create_item', {
              ...args,
              operationId: randomUUID(),
              folderId: other.id,
            })
          ).result?.isError,
        ).toBe(true)
        const foreignItem = execute({
          action: 'create_item',
          folderId: other.id,
          title: 'Private note',
          body: 'Secret',
          purpose: 'note',
        }) as { id: string }
        expect(
          (await b.call('memory_read', { connectionId, id: foreignItem.id })).result?.isError,
        ).toBe(true)
        expect(
          value(await b.call('memory_snapshot', { connectionId })).items.some(
            (i: { id: string }) => i.id === foreignItem.id,
          ),
        ).toBe(false)
        expect(
          (
            await spaces.request({
              action: 'create_discussion',
              id: discussionId,
              spaceId: space.id,
              title: 'Discuss idea',
              noteIds: [saved.id],
            })
          ).ok,
        ).toBe(true)
        expect(
          (
            await spaces.request({
              action: 'save',
              id: discussionId,
              revision: 1,
              title: 'Still linked',
              text: 'Discussion',
              stage: 'brainstorm',
              plan: '',
              assignments: [],
              noteIds: [saved.id],
            })
          ).ok,
        ).toBe(true)
        const history = await spaces.request({
          action: 'source',
          id: discussionId,
          sourceRef: `item:${saved.id}`,
          revision: '1',
        })
        expect(history).toMatchObject({
          ok: true,
          context: { outcome: 'ok', source: { revision: '1', body: args.body } },
        })
        const result = value(
          await b.call('memory_create_item', {
            ...args,
            operationId: randomUUID(),
            purpose: 'result',
          }),
        )
        testSessions.push({ id: assignee, provider, cwd: box.root } as Session)
        const task = execute({
          action: 'create_task',
          folderId: folder.id,
          assignee,
          title: 'Deliver',
          body: 'Save a result',
          inputs: [{ itemId: saved.id, revision: 1 }],
        }) as { id: string }
        store.updateDelivery(task.id, { state: 'completed' })
        expect(
          (
            await b.call('memory_submit_result', {
              connectionId,
              operationId: randomUUID(),
              id: task.id,
              outputIds: [result.id],
              body: 'Delivered',
            })
          ).result?.isError,
        ).toBe(false)
        expect(store.tasks().find((t) => t.id === task.id)?.state).toBe('submitted')
        expect(store.read({}, result.id).item.acceptedRevision).toBeNull()
        const readOnlyId = value(
          await b.call('memory_connect', { label: 'Read only', spaceId: space.id }),
        ).connectionId
        approve(server.connections, readOnlyId, { assignee, readOnly: true })
        expect(
          (
            await b.call('memory_create_item', {
              ...args,
              operationId: randomUUID(),
              connectionId: readOnlyId,
            })
          ).result?.isError,
        ).toBe(true)
        const wrongId = value(
          await b.call('memory_connect', {
            label: 'Wrong binding',
            chatId: randomUUID(),
            spaceId: space.id,
          }),
        ).connectionId
        expect(() => approve(server.connections, wrongId, { assignee, readOnly: false })).toThrow(
          'exact requesting native chat',
        )
        expect(
          (
            await b.call('memory_create_item', {
              ...args,
              operationId: randomUUID(),
              connectionId: wrongId,
            })
          ).result?.isError,
        ).toBe(true)
        const reloaded = new MemoryStore(store.file)
        try {
          expect(reloaded.read({}, saved.id, 1).revision).toEqual(original)
        } finally {
          reloaded.close()
        }
        const persistedNotes = notes['db']
          .prepare('SELECT data FROM ideas WHERE id=?')
          .get(saved.id)
        expect(persistedNotes).toBeUndefined()
      } finally {
        await spaces.close()
      }
    },
  )

  it.each(['claude', 'codex'] as const)(
    '%s returns approval only to the exact waiting caller, once, before authenticated briefing',
    async (provider) => {
      const b = bridge(provider, await server.start(0))
      const chatId = randomUUID(),
        otherChat = randomUUID()
      const id = value(await b.call('memory_connect', { label: 'Waiting', chatId })).connectionId
      const other = value(
        await b.call('memory_connect', { label: 'Other', chatId: otherChat }),
      ).connectionId
      const args = { connectionId: id, chatId, waitMs: 7000 }
      const waiting = b.call('memory_wait_for_approval', args)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect((await b.call('memory_wait_for_approval', args)).result?.isError).toBe(true)
      expect(
        (await b.call('memory_wait_for_approval', { ...args, chatId: otherChat })).result?.isError,
      ).toBe(true)
      const otherWaiting = b.call('memory_wait_for_approval', {
        connectionId: other,
        chatId: otherChat,
        waitMs: 200,
      })
      expect(value(await otherWaiting)).toMatchObject({ state: 'pending', continuation: 'none' })
      // Exercise the real packaged bridge beyond its ordinary five-second timeout.
      await new Promise((resolve) => setTimeout(resolve, 5100))
      approve(server.connections, id, {
        assignee: `${provider === 'codex' ? 'codex:' : ''}${chatId}`,
      })
      expect(value(await waiting)).toMatchObject({ id, chatId, continuation: 'verify-connection' })
      expect(value(await b.call('memory_wait_for_approval', { ...args, waitMs: 0 }))).toMatchObject(
        { continuation: 'already-delivered' },
      )
      expect(value(await b.call('memory_connect', { connectionId: id })).state).toBe('approved')
      expect(value(await b.call('memory_briefing', { connectionId: id })).enrollment.folderId).toBe(
        folder.id,
      )
      server.connections.reject(id)
      expect(value(await b.call('memory_wait_for_approval', { ...args, waitMs: 0 }))).toMatchObject(
        { state: 'rejected', continuation: 'none' },
      )
      expect((await b.call('memory_briefing', { connectionId: id })).result?.isError).toBe(true)
      expect(store.communications.list('message')).toHaveLength(0)
      expect(store.communications.list('workflow')).toHaveLength(0)
    },
    15000,
  )
  it('does not signal wrong binding, revoked grants, expired requests or a restarted connection', async () => {
    let now = Date.now()
    const c = new MemoryConnections(store, () => now)
    const make = () => {
      const r = { ...request(), chatId: randomUUID() }
      c.request(r)
      return r
    }
    const wait = (r: ReturnType<typeof make>) =>
      c.wait({ action: 'wait', id: r.id, secret: r.secret, chatId: r.chatId, waitMs: 0 })
    const mismatch = make()
    await expect(
      c.wait({
        action: 'wait',
        id: mismatch.id,
        secret: '0'.repeat(64),
        chatId: mismatch.chatId,
        waitMs: 0,
      }),
    ).rejects.toThrow('unavailable')
    expect(() => approve(c, mismatch.id, { assignee: `codex:${randomUUID()}` })).toThrow(
      'exact requesting native chat',
    )
    expect(await wait(mismatch)).toMatchObject({ state: 'pending', continuation: 'none' })
    const revoked = make()
    const grant = approve(c, revoked.id, { assignee: `codex:${revoked.chatId}` })
    execute({ action: 'revoke_grant', id: grant.grantId })
    expect(await wait(revoked)).toMatchObject({ state: 'rejected', continuation: 'none' })
    const denied = make()
    const deniedWait = c.wait({
      action: 'wait',
      id: denied.id,
      secret: denied.secret,
      chatId: denied.chatId,
      waitMs: 1000,
    })
    c.reject(denied.id)
    expect(await deniedWait).toMatchObject({ state: 'rejected', continuation: 'none' })
    const stale = make()
    const staleWait = c.wait({
      action: 'wait',
      id: stale.id,
      secret: stale.secret,
      chatId: stale.chatId,
      waitMs: 1000,
    })
    const staleGrant = approve(c, stale.id, { assignee: `codex:${stale.chatId}` })
    execute({ action: 'revoke_grant', id: staleGrant.grantId })
    expect(await staleWait).toMatchObject({ state: 'rejected', continuation: 'none' })
    const expired = make()
    now += 300001
    await expect(wait(expired)).rejects.toThrow('expired')
    const replaced = make()
    const oldWait = c.wait({
      action: 'wait',
      id: replaced.id,
      secret: replaced.secret,
      chatId: replaced.chatId,
      waitMs: 1000,
    })
    now += 300001
    c.sweep()
    c.request(replaced)
    approve(c, replaced.id, { assignee: `codex:${replaced.chatId}` })
    await expect(oldWait).rejects.toThrow('expired request')
    const closed = make()
    const pending = c.wait({
      action: 'wait',
      id: closed.id,
      secret: closed.secret,
      chatId: closed.chatId,
      waitMs: 1000,
    })
    c.close()
    await expect(pending).rejects.toThrow('expired')
    await expect(wait(closed)).rejects.toThrow('expired')
  })
  it.each(['claude', 'codex'] as const)(
    '%s reports only its linked project capabilities through the packaged bridge',
    async (provider) => {
      const b = bridge(provider, await server.start(0))
      const id = value(await b.call('memory_connect', { label: 'Capability report' })).connectionId
      const assignee = provider === 'codex' ? 'codex:capability-chat' : 'capability-chat'
      approve(server.connections, id, { folderId: undefined, assignee, readOnly: false })
      const args = {
        connectionId: id,
        operationId: randomUUID(),
        capabilities: [
          { kind: 'tool', name: 'Browser automation', description: 'Browser screenshots' },
        ],
      }
      const report = value(await b.call('memory_report_capabilities', args))
      expect(report).toMatchObject({
        spaceId: space.id,
        assignee,
        source: 'reported',
        verifications: [],
      })
      expect(value(await b.call('memory_report_capabilities', args)).id).toBe(report.id)
      expect(
        value(await b.call('memory_briefing', { connectionId: id })).capabilityReports,
      ).toEqual([report])
      expect(
        (await b.call('memory_report_capabilities', { ...args, assignee: 'pretend-other' })).result
          ?.isError,
      ).toBe(true)
      expect(
        (
          await b.call('memory_verify_capability', {
            connectionId: id,
            id: report.id,
            capabilityIndex: 0,
            evidence: 'pretend verified',
          })
        ).result?.isError,
      ).toBe(true)
    },
  )
  it.each(['claude', 'codex'] as const)(
    '%s collects a human card answer on its original bridge beyond the normal HTTP timeout',
    async (provider) => {
      const service = new CommunicationService(store.communications, {
        destinations: async () => [],
        deliver: async () => {
          throw new Error('Decision cards must not launch a provider')
        },
        authorize: (actor, id) => store.authorizeCommunication(actor, id),
        input: (actor, id, revision) => store.communicationInput(actor, id, revision),
        project: (id) => store.space(id),
      })
      store.communicationService = service
      const target = `${provider === 'codex' ? 'codex:' : ''}${randomUUID()}`
      try {
        service.configure(
          {
            id: randomUUID(),
            spaceId: space.id,
            revision: 1,
            mode: 'manual',
            paused: true,
            participants: [
              {
                id: randomUUID(),
                target,
                role: 'Test',
                model: 'test',
                communicate: true,
                requestWork: false,
              },
            ],
            maxConcurrent: 1,
            maxDispatches: 1,
            expiresAt: Date.now() + 60000,
            recover: false,
            acceptBy: 'human',
          },
          0,
          { id: 'human', kind: 'human' },
        )
        const b = bridge(provider, await server.start(0))
        const id = value(
          await b.call('memory_connect', { label: 'Decision card test' }),
        ).connectionId
        approve(server.connections, id, { folderId: undefined, readOnly: false, assignee: target })
        const asked = await b.call('threadlight_ask_question', {
          connectionId: id,
          operationId: randomUUID(),
          spaceId: space.id,
          audience: 'human',
          body: 'Choose the next step',
          choices: ['Explore', 'Build'],
          answerDelivery: 'tool',
          allowOther: true,
        })
        expect(asked.result?.isError).toBe(false)
        const q = value(asked)
        const pending = b.call('threadlight_read_question', {
          connectionId: id,
          id: q.id,
          generation: q.generation,
          waitMs: 7000,
        })
        // Exercise the actual bridge's former five-second abort, not a mocked fetch.
        await new Promise((resolve) => setTimeout(resolve, 5500))
        await service.execute(
          'answer_request',
          {
            operationId: randomUUID(),
            id: q.id,
            generation: q.generation,
            answer: 'Explore, then build',
          },
          { id: 'human', kind: 'human' },
        )
        const response = await pending
        expect(response.result?.isError).toBe(false)
        expect(value(response)).toMatchObject({
          id: q.id,
          state: 'answered',
          answer: 'Explore, then build',
          senderTarget: target,
        })
        expect(store.communications.list('message')).toHaveLength(0)
      } finally {
        service.close()
      }
    },
    15000,
  )
  it.each(['claude', 'codex'] as const)(
    '%s initializes offline and requires explicit per-call connection IDs',
    async (provider) => {
      const b = bridge(provider, 'http://127.0.0.1:1/mcp')
      expect((await b.rpc('initialize')).result?.instructions).toContain('THIS chat')
      const list = (await b.rpc('tools/list')).result!.tools!
      expect(list.find((t) => t.name === 'memory_briefing')?.inputSchema.required).toContain(
        'connectionId',
      )
      expect(list.some((t) => t.name === 'memory_create_grant')).toBe(false)
      expect((await b.call('memory_snapshot')).result?.isError).toBe(true)
    },
  )
  it.each(['claude', 'codex'] as const)(
    '%s connects, reads, publishes, handles conflicts and isolates concurrent scopes',
    async (provider) => {
      const b = bridge(provider, await server.start(0))
      const chatId = randomUUID()
      const initial = value(await b.call('memory_connect', { label: 'First scope', chatId })),
        id = initial.connectionId
      expect(initial.state).toBe('pending')
      expect(initial.chatId).toBe(chatId)
      expect(server.connections.list().find((c) => c.id === id)?.chatId).toBe(chatId)
      expect((await b.call('memory_briefing', { connectionId: id })).result?.isError).toBe(true)
      approve(server.connections, id, {
        readOnly: false,
        createFolders: true,
        assignee: `${provider === 'codex' ? 'codex:' : ''}${chatId}`,
      })
      expect(value(await b.call('memory_connect', { connectionId: id })).state).toBe('approved')
      expect(value(await b.call('memory_briefing', { connectionId: id })).enrollment.folderId).toBe(
        folder.id,
      )
      const args = {
        connectionId: id,
        folderId: folder.id,
        title: 'Saved result',
        body: 'Synthetic evidence',
        operationId: randomUUID(),
      }
      const item = value(await b.call('memory_create_item', args))
      expect(value(await b.call('memory_create_item', args)).id).toBe(item.id)
      const otherSpace = execute({ action: 'create_space', title: 'Unrelated' }) as MemorySpace
      const otherFolder = (
        execute({
          action: 'ensure_folder',
          spaceId: otherSpace.id,
          title: 'Private',
          description: 'Other scope',
          reason: 'Test',
        }) as { folder: MemoryFolder }
      ).folder
      const second = value(
        await b.call('memory_connect', { label: 'Second scope', spaceId: otherSpace.id }),
      ).connectionId
      approve(server.connections, second, { spaceId: otherSpace.id, folderId: otherFolder.id })
      expect(
        (await b.call('memory_read', { connectionId: second, id: item.id })).result?.isError,
      ).toBe(true)
      expect(
        value(await b.call('memory_read', { connectionId: id, id: item.id, revision: 1 })).revision
          .body,
      ).toBe('Synthetic evidence')
      expect(
        (
          await b.call('memory_revise_item', {
            connectionId: id,
            id: item.id,
            body: 'Stale',
            expectedRevision: 2,
            operationId: randomUUID(),
          })
        ).result?.isError,
      ).toBe(true)
      expect(
        (
          await b.call('memory_create_item', {
            ...args,
            connectionId: second,
            folderId: otherFolder.id,
            operationId: randomUUID(),
          })
        ).result?.isError,
      ).toBe(true)
      expect(value(await b.call('memory_disconnect', { connectionId: id }))).toEqual({
        disconnected: true,
      })
      expect((await b.call('memory_read', { connectionId: id, id: item.id })).result?.isError).toBe(
        true,
      )
      expect(b.output()).not.toContain('tokenHash')
      expect(b.output()).not.toContain('secretHash')
    },
    20000,
  )
})

// The real bridge must report a lost response without submitting the write twice.
it('does not replay a mutation after the server drops its response', async () => {
  let writes = 0
  const transport = new MemoryTransport((req, res, finish) => {
    req.resume()
    if (req.url === '/plugin/connect') {
      finish(200, { state: 'approved' })
    } else {
      writes++
      res.destroy()
    }
  })
  const url = await transport.start(0, auth)
  try {
    const b = bridge('claude', url)
    const connected = value(await b.call('memory_connect', { label: 'Lost response proof' }))
    const result = await b.call('memory_create_item', {
      connectionId: connected.connectionId,
      folderId: folder.id,
      title: 'Once',
      body: 'Synthetic',
      operationId: randomUUID(),
    })
    expect(result.result?.isError).toBe(true)
    expect(result.result?.content?.[0]?.text).toContain('Do not blindly retry')
    expect(writes).toBe(1)
  } finally {
    transport.close()
  }
})

it.each(['claude', 'codex'] as const)(
  '%s packaged bridge rejects a forged pairing reply without disclosing registration secrets',
  async (provider) => {
    let wire = '',
      authorization: string | undefined
    const fake = createServer((req, res) => {
      authorization = req.headers.authorization
      req.on('data', (b) => {
        wire += b
      })
      req.on('end', () => {
        res.end(JSON.stringify({ state: 'approved', code: 'FAKE_APPROVAL' }))
      })
    })
    await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done))
    const address = fake.address()
    if (!address || typeof address === 'string') throw Error('No test endpoint')
    try {
      const b = bridge(provider, `http://127.0.0.1:${address.port}/mcp`)
      const result = await b.call('memory_connect', { label: 'CONFIDENTIAL_LABEL' })
      expect(result.result?.isError).toBe(true)
      expect(authorization).toBeUndefined()
      expect(wire).not.toContain('CONFIDENTIAL_LABEL')
      expect(wire).not.toContain('secret')
      expect(b.output()).not.toContain('FAKE_APPROVAL')
    } finally {
      fake.closeAllConnections()
      await new Promise<void>((done) => fake.close(() => done()))
    }
  },
)
