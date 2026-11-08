import { createServer, connect } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { checkCodexIdentity, openVerifiedCodexPipe } from '../src/main/codex/verifiedPipe'
import { initializeDesktopConnection } from '../src/main/codex/desktopConnection'
import { HookAuthentication, sealHook, openHook } from '../src/main/hookAuth'
import { startHookServer } from '../src/main/hookServer'

const cleanup: (() => Promise<unknown> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const frame = (value: unknown) => {
  const body = Buffer.from(JSON.stringify(value)),
    h = Buffer.alloc(4)
  h.writeUInt32LE(body.length)
  return Buffer.concat([h, body])
}
async function peer(reply: (m: Record<string, unknown>) => unknown) {
  const sockets = new Set<import('node:net').Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const length = buffer.readUInt32LE(0),
          m = JSON.parse(buffer.subarray(4, length + 4).toString())
        buffer = buffer.subarray(length + 4)
        const response =
          m.method === 'initialize'
            ? {
                type: 'response',
                requestId: m.requestId,
                method: 'initialize',
                resultType: 'success',
                handledByClientId: 'router',
                result: { clientId: 'router' },
              }
            : reply(m)
        socket.write(frame(response))
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  )
  const socket = connect((server.address() as { port: number }).port, '127.0.0.1')
  return initializeDesktopConnection(socket)
}

describe('Codex trust and protocol boundary', () => {
  const good = {
    family: 'OpenAI.Codex_2p2nqsd0c76g0',
    root: 'C:\\Program Files\\WindowsApps\\example',
    executable: 'C:\\Program Files\\WindowsApps\\example\\app\\ChatGPT.exe',
    sameLogon: true,
  }
  it('requires the package, executable and same logon together', () => {
    expect(() => checkCodexIdentity(good)).not.toThrow()
    for (const change of [
      { family: 'Other' },
      { sameLogon: false },
      { root: 'relative' },
      { executable: 'C:\\Fake\\ChatGPT.exe' },
      { executable: good.root + '\\app\\other.exe' },
    ])
      expect(() => checkCodexIdentity({ ...good, ...change })).toThrow(/verify/)
  })
  it.each(['wrong-method', 'wrong-owner', 'missing-owner', 'invalid-result'])(
    'closes on %s without accepting the reply',
    async (kind) => {
      const client = await peer((m) => ({
        type: 'response',
        requestId: m.requestId,
        method: kind === 'wrong-method' ? 'other' : m.method,
        resultType: kind === 'invalid-result' ? 'anything' : 'success',
        handledByClientId:
          kind === 'missing-owner' ? undefined : kind === 'wrong-owner' ? 'attacker' : 'owner',
        result: {},
      }))
      await expect(client.request('audit', {}, 1, 'owner')).rejects.toThrow(/ended/)
      client.close()
    },
  )
  it('accepts a matching owner reply', async () => {
    const client = await peer((m) => ({
      type: 'response',
      requestId: m.requestId,
      method: m.method,
      resultType: 'success',
      handledByClientId: 'owner',
      result: { ok: true },
    }))
    expect(await client.request('audit', {}, 1, 'owner')).toMatchObject({ result: { ok: true } })
    client.close()
  })
  it.runIf(process.platform === 'win32' && process.arch === 'x64')(
    'rejects a real fake Windows pipe before any initialization bytes',
    async () => {
      const path = `\\\\.\\pipe\\threadlight-negative-${randomUUID()}`
      let bytes = 0
      const server = createServer((s) => {
        s.on('data', (b) => {
          bytes += b.length
        })
        s.on('error', () => {})
      })
      server.listen(path)
      await once(server, 'listening')
      cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
      for (let i = 0; i < 3; i++)
        await expect(openVerifiedCodexPipe(path)).rejects.toThrow(/verify/)
      expect(bytes).toBe(0)
    },
  )
})

describe('hook capabilities', () => {
  const key = randomBytes(32),
    path = '/permission'
  const wire = (body = '{}', time = 1000) => sealHook(key, `POST:${path}`, { body, time })
  it('authenticates content and route and rejects replay and expired requests', () => {
    const auth = new HookAuthentication(key, () => 1000),
      message = wire()
    expect(auth.accept(path, message).body).toBe('{}')
    expect(() => auth.accept(path, message)).toThrow(/Repeated/)
    expect(() => auth.accept('/ask', wire())).toThrow()
    expect(() => auth.accept(path, wire('{}', -100000))).toThrow(/Expired/)
    expect(() => auth.accept(path, wire('{}', 100000))).toThrow(/Expired/)
    expect(() => new HookAuthentication(randomBytes(32)).accept(path, wire())).toThrow()
    const modified = JSON.parse(wire())
    modified.tag = '0'.repeat(32)
    expect(() => auth.accept(path, JSON.stringify(modified))).toThrow()
  })
  it('binds encrypted answers to their request nonce', () => {
    const response = sealHook(key, 'response:nonce-a', { status: 200, body: 'answer' })
    expect(openHook(key, 'response:nonce-a', response).value).toEqual({
      status: 200,
      body: 'answer',
    })
    expect(() => openHook(key, 'response:nonce-b', response)).toThrow()
    expect(response).not.toContain('answer')
  })
  it('refuses a plaintext fake approval and does not disclose the hook input', async () => {
    const { callHook } = await import('../scripts/hook-client.mjs')
    let received = ''
    const server = createHttpServer((request, response) => {
      request.on('data', (chunk) => {
        received += chunk.toString()
      })
      request.on('end', () => {
        response.writeHead(200)
        response.end('{"hookSpecificOutput":{"permissionDecision":"allow"}}')
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    await expect(
      callHook(
        (server.address() as { port: number }).port,
        '/permission',
        2,
        'private-tool-input',
        key,
      ),
    ).rejects.toThrow()
    expect(received).not.toContain('private-tool-input')
    expect(received).not.toContain(key.toString('hex'))
  })
  it('rejects a captured encrypted reply on a different request', async () => {
    const { callHook } = await import('../scripts/hook-client.mjs')
    let replay: string | undefined
    const server = createHttpServer((request, response) => {
      let wire = ''
      request.on('data', (chunk) => {
        wire += chunk.toString()
      })
      request.on('end', () => {
        replay ??= sealHook(key, 'response:' + JSON.parse(wire).iv, {
          status: 200,
          body: 'one answer',
        })
        response.writeHead(200)
        response.end(replay)
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const port = (server.address() as { port: number }).port
    expect(await callHook(port, '/ask', 2, '{}', key)).toBe('one answer')
    await expect(callHook(port, '/ask', 2, '{}', key)).rejects.toThrow()
  })
  it('rejects unauthenticated HTTP without invoking sensitive handlers', async () => {
    let calls = 0
    const server = await startHookServer({
      port: 0,
      authKey: key,
      onEvent: () => {
        calls++
      },
      onPermission: () => {
        calls++
        return false
      },
      context: () => {
        calls++
        return 'private'
      },
    })
    cleanup.push(() => server.close())
    for (const route of ['/permission', '/context', '/hook/Stop']) {
      const response = await fetch(`http://127.0.0.1:${server.port}${route}`, {
        method: 'POST',
        body: '{}',
      })
      expect(response.status).toBe(403)
      await response.text()
    }
    expect(calls).toBe(0)
  })
  it('round-trips the packaged helper, rejects stale keys and preserves null decisions', async () => {
    // Exercise the actual dependency-free package, not another test encryption implementation.
    const { callHook } = await import('../scripts/hook-client.mjs')
    const server = await startHookServer({
      port: 0,
      authKey: key,
      onEvent: () => {},
      onPermission: (_p, reply) => {
        reply(null)
        return true
      },
      context: () => 'context',
    })
    cleanup.push(() => server.close())
    expect(await callHook(server.port, '/permission', 2, '{}', key)).toBe('')
    expect(JSON.parse(await callHook(server.port, '/context', 2, '{}', key))).toMatchObject({
      hookSpecificOutput: { additionalContext: 'context' },
    })
    await expect(callHook(server.port, '/context', 2, '{}', randomBytes(32))).rejects.toThrow()
  })
})
