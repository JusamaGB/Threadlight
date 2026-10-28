import { createServer } from 'node:http'
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
  server = new MemoryServer(store)
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
    expect(c.request(a).state).toBe('rejected')
  })
  it('expires requests/connections without recursive notifications and revokes orphan grants', () => {
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
    expect(store.snapshot().grants.find((g) => g.id === granted.grantId)?.revoked).toBe(true)
    const manual = execute({ action: 'create_grant', spaceId: space.id, title: 'Manual' }) as {
      id: string
    }
    const interrupted = request()
    c.request(interrupted)
    const orphan = approve(c, interrupted.id)
    new MemoryConnections(store)
    expect(store.snapshot().grants.find((g) => g.id === orphan.grantId)?.revoked).toBe(true)
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
      fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    expect((await post(r, { Origin: 'http://example.test' })).status).toBe(403)
    expect((await post({ ...r, action: 'approve' })).status).toBe(400)
    expect((await post({ ...r, spaceId: space.id })).status).toBe(400)
    expect((await post(r)).status).toBe(200)
    expect(
      (
        await fetch(base.replace('/plugin/connect', '/plugin/mcp/' + r.id), {
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
      fetch(endpoint.replace('/mcp', `/plugin/runtime/${r.id}`), {
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
    env: { ...process.env, THREADLIGHT_MEMORY_URL: endpoint },
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
    rpc,
    output: () => output,
    call: (name: string, args: Record<string, unknown> = {}) =>
      rpc('tools/call', { name, arguments: args }),
  }
}
const value = (reply: Reply) => JSON.parse(reply.result!.content![0]!.text!)

describe('actual packaged stdio bridges', () => {
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
      const initial = value(await b.call('memory_connect', { label: 'First scope' })),
        id = initial.connectionId
      expect(initial.state).toBe('pending')
      expect((await b.call('memory_briefing', { connectionId: id })).result?.isError).toBe(true)
      approve(server.connections, id, { readOnly: false, createFolders: true })
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
      const second = value(await b.call('memory_connect', { label: 'Second scope' })).connectionId
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
  const endpoint = createServer((req, res) => {
    req.resume()
    if (req.url === '/plugin/connect') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'approved' }))
    } else {
      writes++
      req.socket.destroy()
    }
  })
  await new Promise<void>((done) => endpoint.listen(0, '127.0.0.1', done))
  const address = endpoint.address()
  if (!address || typeof address === 'string') throw new Error('Missing test endpoint')
  try {
    const b = bridge('claude', 'http://127.0.0.1:' + address.port + '/mcp')
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
    endpoint.closeAllConnections()
    await new Promise<void>((done) => endpoint.close(() => done()))
  }
})
