import { relayMessage } from '../src/main/relay'
import { sendCodex } from '../src/main/codex/relay'
import { proxyRpc } from './mcpProxyHelper'
import { createServer, request as httpRequest, type Server, type RequestListener } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryStore } from '../src/main/memory/store'
import { MemoryServer } from '../src/main/memory/server'
import { openMemoryProxy } from '../src/main/memory/transport'
import { sealHook, openHook } from '../src/main/hookAuth'
import { memoryPost } from '../scripts/memory-transport.mjs'
import { communicationConfig, codexCommunicationConfig } from '../src/main/agent/communicationTools'
import { codexMemoryArgs } from '../src/main/codex/relay'
import { memoryTestTransport } from './memoryTransportHelper'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox,
  store: MemoryStore,
  server: MemoryServer,
  auth: ReturnType<typeof memoryTestTransport>,
  url: string
let credential: { id: string; token: string }
const extras: Server[] = []
beforeEach(async () => {
  box = await sandbox()
  auth = memoryTestTransport(box.root)
  store = new MemoryStore(join(box.root, 'memory.sqlite'))
  store.connectionProjects = () => store.projectIdentities()
  const space = store.execute({
    action: 'create_space',
    title: 'Private',
    operationId: randomUUID(),
  }) as { id: string }
  credential = store.execute({
    action: 'create_grant',
    spaceId: space.id,
    title: 'Read only',
    operationId: randomUUID(),
  }) as typeof credential
  server = new MemoryServer(store, auth)
  url = await server.start(0)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const extra of extras.splice(0)) {
    extra.closeAllConnections()
    await new Promise<void>((done) => extra.close(() => done()))
  }
  server.close()
  store.close()
  await box.cleanup()
})
const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
function wire(endpoint = url, time = Date.now(), token = credential.token, body: unknown = ping) {
  return sealHook(auth.key, `POST:threadlight-memory-v1:${new URL(endpoint).origin}:request`, {
    time,
    body: JSON.stringify({ path: new URL(endpoint).pathname, token, body }),
  })
}
const raw = (body: string, headers: Record<string, string> = {}) =>
  fetch(new URL('/secure-memory', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
async function listen(handler: RequestListener) {
  const fake = createServer(handler)
  extras.push(fake)
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done))
  const address = fake.address()
  if (!address || typeof address === 'string') throw Error('Missing listener')
  return `http://127.0.0.1:${address.port}/mcp`
}

it('rejects all plaintext routes, empty browser headers, wrong Host, and unsupported methods', async () => {
  for (const path of [
    '/mcp',
    '/communication',
    '/plugin/connect',
    `/plugin/runtime/${randomUUID()}`,
    `/plugin/mcp/${randomUUID()}`,
  ]) {
    expect(
      (
        await fetch(new URL(path, url), {
          method: 'POST',
          headers: { Authorization: `Bearer ${credential.token}` },
          body: JSON.stringify(ping),
        })
      ).status,
    ).toBe(404)
  }
  for (const headers of [{ Origin: '' }, { Referer: '' }] as Record<string, string>[])
    expect((await raw(wire(), headers)).status, JSON.stringify(headers)).toBe(403)
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      new URL('/secure-memory', url),
      { method: 'POST', headers: { Host: '127.0.0.1:1' } },
      (res) => {
        res.resume()
        resolve(res.statusCode)
      },
    )
    request.on('error', reject)
    request.end()
  })
  expect(wrongHost).toBe(403)
  expect((await fetch(new URL('/secure-memory', url))).status).toBe(405)
  expect((await raw(JSON.stringify(ping))).status).toBe(401)
})
it('accepts authentic calls but rejects wrong keys, tampering, stale/future timestamps, replay and another port', async () => {
  expect(await memoryPost(url, ping, credential.token, auth.key)).toMatchObject({
    status: 200,
    value: { id: 1, result: {} },
  })
  await expect(memoryPost(url, ping, credential.token, randomBytes(32))).rejects.toThrow(
    'authentication',
  )
  for (const time of [Date.now() - 61000, Date.now() + 61000])
    expect((await raw(wire(url, time))).status).toBe(401)
  const original = wire(),
    bad = JSON.parse(original)
  bad.tag = (bad.tag[0] === 'a' ? 'b' : 'a') + bad.tag.slice(1)
  expect((await raw(JSON.stringify(bad))).status).toBe(401)
  expect((await raw(original)).status).toBe(200)
  expect((await raw(original)).status).toBe(401)
  expect((await raw(wire('http://127.0.0.1:1/mcp'))).status).toBe(401)
})
it('never discloses bearer or bodies to a fake server and rejects forged or misbound replies', async () => {
  let captured = '',
    receivedHeader: string | undefined
  const fakeUrl = await listen((req, res) => {
    receivedHeader = req.headers.authorization
    req.on('data', (b) => {
      captured += b
    })
    req.on('end', () => {
      res.end(JSON.stringify({ status: 200, value: { result: 'FORGED' } }))
    })
  })
  await expect(
    memoryPost(fakeUrl, { secret: 'PRIVATE_RUNTIME_TOKEN' }, credential.token, auth.key),
  ).rejects.toThrow()
  expect(receivedHeader).toBeUndefined()
  expect(captured).not.toContain(credential.token)
  expect(captured).not.toContain('PRIVATE_RUNTIME_TOKEN')
  let origin = '',
    previous = ''
  const replayUrl = await listen((req, res) => {
    let body = ''
    req.on('data', (b) => {
      body += b
    })
    req.on('end', () => {
      const nonce = JSON.parse(body).iv
      const reply = sealHook(auth.key, `threadlight-memory-v1:${origin}:response:${nonce}`, {
        status: 200,
        value: { result: 'trusted' },
      })
      res.end(previous || reply)
      previous = reply
    })
  })
  origin = new URL(replayUrl).origin
  expect((await memoryPost(replayUrl, ping, credential.token, auth.key)).status).toBe(200)
  await expect(memoryPost(replayUrl, ping, credential.token, auth.key)).rejects.toThrow()
})
it('does not follow redirects or forward secrets to another endpoint', async () => {
  let reached = 0
  const other = await listen((_req, res) => {
    reached++
    res.end('{}')
  })
  const fake = await listen((req, res) => {
    req.resume()
    res.writeHead(307, { Location: other })
    res.end()
  })
  await expect(memoryPost(fake, ping, credential.token, auth.key)).rejects.toThrow()
  expect(reached).toBe(0)
})
it('rechecks revocation after a slow encrypted upload and executes nothing', async () => {
  const body = wire()
  const response = new Promise<{ status: number }>((resolve, reject) => {
    const req = httpRequest(
      new URL('/secure-memory', url),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let reply = ''
        res.on('data', (b) => {
          reply += b
        })
        res.on('end', () =>
          resolve(
            openHook(
              auth.key,
              `threadlight-memory-v1:${new URL(url).origin}:response:${JSON.parse(body).iv}`,
              reply,
            ).value as { status: number },
          ),
        )
      },
    )
    req.on('error', reject)
    req.write(body.slice(0, -1), () => {
      store.execute({ action: 'revoke_grant', id: credential.id, operationId: randomUUID() })
      req.end(body.slice(-1))
    })
  })
  expect(await response).toMatchObject({ status: 401 })
  const pairing = {
    action: 'request',
    id: randomUUID(),
    secret: randomBytes(32).toString('hex'),
    provider: 'claude',
    label: 'Test',
    spaceId: store.projectIdentities()[0]!.id,
  }
  expect(
    (await memoryPost(url.replace('/mcp', '/plugin/connect'), pairing, undefined, auth.key)).status,
  ).toBe(200)
  expect(server.connections.list()).toHaveLength(1)
})
it('pins a server generation and rejects old keys after a restart on the same port', async () => {
  const port = Number(new URL(url).port),
    oldWire = wire()
  server.close()
  server = new MemoryServer(store, { key: randomBytes(32), directory: auth.directory })
  await server.start(port)
  expect((await raw(oldWire)).status).toBe(401)
  await expect(memoryPost(url, ping, credential.token, auth.key)).rejects.toThrow('authentication')
})
it('uses actual stdio proxies for owned Claude/Codex configurations with no secrets on argv and cleanup on revoke', async () => {
  const connection = server.connectCommunication(() => ({ id: 'owned', kind: 'agent' }))
  const claude = JSON.parse(communicationConfig(undefined, connection))
  const codex = { mcp_servers: {} }
  codexCommunicationConfig(codex, connection)
  const serialized = JSON.stringify([claude, codex, codexMemoryArgs(connection.mcp)])
  expect(serialized).not.toContain(connection.token)
  expect(serialized).not.toContain(auth.key.toString('hex'))
  expect(serialized).not.toContain('http_headers')
  const proxy = openMemoryProxy(url, credential.token),
    configPath = proxy.mcp.args.at(-1)!
  expect(JSON.parse(await readFile(configPath, 'utf8')).token).toBe(credential.token)
  const child = spawn(proxy.mcp.command, proxy.mcp.args, {
    env: { ...process.env, ...proxy.mcp.env },
    stdio: 'pipe',
    windowsHide: true,
  })
  try {
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Proxy timed out')), 5000)
      createInterface({ input: child.stdout }).once('line', (line) => {
        clearTimeout(timer)
        resolve(JSON.parse(line))
      })
      child.once('error', reject)
    })
    child.stdin.write(JSON.stringify(ping) + '\n')
    expect(await response).toMatchObject({ jsonrpc: '2.0', id: 1, result: {} })
  } finally {
    child.kill()
    await new Promise<void>((done) => child.once('close', () => done()))
    proxy.close()
  }
  await expect(access(configPath)).rejects.toThrow()
  const ownedPath = connection.mcp.args.at(-1)!
  server.revokeCommunication()
  await expect(access(ownedPath)).rejects.toThrow()
  expect((await memoryPost(connection.endpoint, ping, connection.token, auth.key)).status).toBe(401)
  expect(() =>
    communicationConfig(undefined, { endpoint: url, token: 'plaintext', close: () => {} }),
  ).toThrow('Authenticated')
})

it('manual enrollment exports authenticated stdio configuration without renderer credentials and revokes it', async () => {
  const input = {
    action: 'create_grant' as const,
    title: 'Manual',
    spaceId: store.snapshot().spaces[0]!.id,
    operationId: randomUUID(),
  }
  const configured = server.enroll(input)
  const mcp = JSON.parse(configured.claude).mcpServers.threadlight
  const privateConfig = JSON.parse(await readFile(mcp.args.at(-1), 'utf8'))
  expect(JSON.stringify(configured)).not.toContain(privateConfig.token)
  expect(JSON.stringify(configured)).not.toContain(auth.key.toString('hex'))
  expect(configured.codex).not.toContain('http_headers')
  expect(await (await proxyRpc(mcp, ping)).json()).toMatchObject({ result: {} })
  expect(() => server.enroll(input)).toThrow('already issued')
  const grant = store.snapshot().grants.find((g) => g.label === 'Manual')!
  expect(grant.revoked).toBe(false)
  store.execute({ action: 'revoke_grant', id: grant.id, operationId: randomUUID() })
  server.releaseEnrollment(grant.id)
  await expect(access(mcp.args.at(-1))).rejects.toThrow()
  expect(await (await proxyRpc(mcp, ping)).json()).toMatchObject({ error: { code: -32000 } })
})
it.each(['claude', 'codex'] as const)(
  '%s relay executes authenticated MCP and removes its private configuration after completion',
  async (provider) => {
    const file = join(box.root, 'relay-proof.json')
    vi.stubEnv('MEMORY_RELAY_PROOF', file)
    const cli = {
      command: process.execPath,
      prefixArgs: [resolve('test/fixtures/secure-memory-relay.mjs')],
    }
    const context = { attemptId: randomUUID(), url, token: credential.token }
    const id = randomUUID(),
      prompt = 'PRIVATE_RELAY_MESSAGE'
    const result =
      provider === 'claude'
        ? await relayMessage(
            { id, cwd: box.root, permissionMode: 'default', model: null },
            prompt,
            { cli, isHeld: async () => false },
            () => {},
            context,
          )
        : await sendCodex(
            { id: `codex:${id}`, cwd: box.root, model: null, live: false },
            prompt,
            cli,
            async () => false,
            () => {},
            context,
          )
    expect(result).toEqual({ ok: true, reply: prompt })
    const recorded = JSON.parse(await readFile(file, 'utf8'))
    expect(JSON.stringify(recorded.args)).not.toContain(credential.token)
    expect(JSON.stringify(recorded.args)).not.toContain(prompt)
    expect(recorded.prompt).toBe(prompt)
    await expect(access(recorded.config.args.at(-1))).rejects.toThrow()
  },
)
it.runIf(process.platform === 'win32')(
  'runs the shipped proxy under Electron in Node mode without opening an app',
  async () => {
    const proxy = openMemoryProxy(url, credential.token)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as string
    try {
      expect(
        await (await proxyRpc({ ...proxy.mcp, command: electron }, ping)).json(),
      ).toMatchObject({ result: {} })
    } finally {
      proxy.close()
    }
  },
  // Electron resolves and extracts its native binary on first use in a clean install.
  120_000,
)

it.runIf(process.platform === 'win32')(
  'revokes capability even when Windows temporarily prevents credential-file deletion',
  async () => {
    const connection = server.connectCommunication(() => ({
      id: 'locked-file-test',
      kind: 'agent',
    }))
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const kernel = koffi.load('kernel32.dll')
    const open = kernel.func(
      'void * __stdcall CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)',
    )
    const close = kernel.func('int __stdcall CloseHandle(void *)')
    const file = connection.mcp.args.at(-1)!
    const handle = open(file, 0x80000000, 1, null, 3, 0, null)
    expect(handle).toBeTruthy()
    expect(koffi.address(handle)).not.toBe(0xffffffffffffffffn)
    try {
      expect(() => connection.close()).not.toThrow()
      expect((await memoryPost(connection.endpoint, ping, connection.token, auth.key)).status).toBe(
        401,
      )
    } finally {
      close(handle)
    }
    server.close()
    await expect(access(file)).rejects.toThrow()
  },
)
