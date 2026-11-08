import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { HookAuthentication, publishLocalKey, sealHook } from '../hookAuth'
import proxySource from './proxySource'

export interface MemoryTransportOptions {
  /** Isolated tests supply both values; production always publishes a Windows-protected key. */
  key?: Buffer
  directory?: string
}
export interface MemoryProxy {
  command: string
  args: string[]
  env: Record<string, string>
}
const listeners = new Map<
  string,
  { key: Buffer; directory: string; script: string; files: Set<string> }
>()

export function openMemoryProxy(endpoint: string, token: string) {
  const state = listeners.get(new URL(endpoint).origin)
  if (!state) throw new Error('Authenticated memory service is unavailable.')
  const path = join(state.directory, `proxy-${randomBytes(24).toString('hex')}.json`)
  writeFileSync(path, JSON.stringify({ endpoint, token, key: state.key.toString('hex') }), {
    flag: 'wx',
    mode: 0o600,
  })
  state.files.add(path)
  const mcp: MemoryProxy = {
    command: process.execPath,
    args: [state.script, '--threadlight-memory-proxy', path],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
  return {
    mcp,
    close: () => {
      try {
        rmSync(path, { force: true })
        state.files.delete(path)
      } catch {
        // An antivirus/file lock must not prevent the caller from revoking its token.
        // Keep the path for another cleanup attempt when the listener closes.
      }
    },
  }
}

type Finish = (status: number, value?: unknown) => void
/** No plaintext compatibility route: every memory request and response is authenticated. */
export class MemoryTransport {
  private auth?: HookAuthentication
  private origin = ''
  private active = 0
  private buffered = 0
  readonly server
  constructor(
    handler: (request: IncomingMessage, response: ServerResponse, finish: Finish) => void,
  ) {
    this.server = createServer((request, response) => {
      const reject = (status: number) => {
        if (response.writableEnded || response.destroyed) return
        response.writeHead(status, { 'Cache-Control': 'no-store' })
        response.end()
      }
      if (!this.auth) return reject(503)
      if (
        'origin' in request.headers ||
        'referer' in request.headers ||
        request.headers.host !== new URL(this.origin).host
      )
        return reject(403)
      if (request.url !== '/secure-memory') return reject(404)
      if (request.method !== 'POST') return reject(405)
      if (request.headers['content-type'] !== 'application/json') return reject(415)
      if (this.active >= 64) return reject(429)
      this.active++
      response.once('close', () => {
        this.active--
      })
      const chunks: Buffer[] = []
      let size = 0,
        accounted = 0
      const releaseBody = () => {
        this.buffered -= accounted
        accounted = 0
      }
      const timer = setTimeout(() => request.destroy(), 15000)
      request.once('close', () => {
        clearTimeout(timer)
        releaseBody()
      })
      request.on('error', () => {})
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        this.buffered += chunk.length
        accounted += chunk.length
        if (size > 19_000_000 || this.buffered > 32_000_000) {
          reject(413)
          request.destroy()
        } else chunks.push(chunk)
      })
      request.on('end', () => {
        clearTimeout(timer)
        releaseBody()
        if (response.writableEnded) return
        let nonce: string, input: { path: string; token: string; body: unknown }
        const aad = `threadlight-memory-v1:${this.origin}`
        try {
          const opened = this.auth!.accept(`${aad}:request`, Buffer.concat(chunks).toString('utf8'))
          nonce = opened.nonce
          input = JSON.parse(opened.body)
          if (
            !input ||
            typeof input.path !== 'string' ||
            !/^\/(?:mcp|communication|plugin\/(?:connect|(?:mcp|runtime)\/[a-f0-9-]{36}))$/.test(
              input.path,
            ) ||
            typeof input.token !== 'string' ||
            input.token.length > 1024
          )
            throw new Error('Invalid envelope')
        } catch {
          return reject(401)
        }
        const finish: Finish = (status, value) => {
          if (response.writableEnded || response.destroyed) return
          const wire = sealHook(this.auth!.key, `${aad}:response:${nonce}`, { status, value })
          if (Buffer.byteLength(wire) > 23_000_000) {
            reject(500)
            return
          }
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          response.end(wire)
        }
        const body = Buffer.from(JSON.stringify(input.body) ?? 'null')
        if (body.length > 14_100_000) return finish(413)
        const decoded = Readable.from([body]) as IncomingMessage
        decoded.url = input.path
        decoded.method = 'POST'
        decoded.socket = request.socket
        decoded.setTimeout = request.setTimeout.bind(request)
        decoded.headers = {
          host: request.headers.host,
          'content-type': 'application/json',
          authorization: `Bearer ${input.token}`,
        }
        try {
          handler(decoded, response, finish)
        } catch {
          finish(500)
        }
      })
    })
    this.server.requestTimeout = 15000
  }
  async start(
    port: number,
    options: MemoryTransportOptions,
    area:
      | 'memory-auth'
      | 'thread-read-auth'
      | 'space-context-auth'
      | 'app-control-auth' = 'memory-auth',
  ) {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    try {
      const address = this.server.address()
      if (!address || typeof address === 'string') throw new Error('Memory listener unavailable.')
      this.origin = `http://127.0.0.1:${address.port}`
      if (!!options.key !== !!options.directory)
        throw new Error('Test transport requires a key and directory.')
      if (!options.key && area === 'memory-auth' && port !== 47618)
        throw new Error('An explicit test key is required for a nonstandard port.')
      const key = options.key ?? (await publishLocalKey(area, 'server.key'))
      const directory =
        options.directory ??
        join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Threadlight', area)
      if (options.directory) mkdirSync(directory, { recursive: true, mode: 0o700 })
      this.auth = new HookAuthentication(key)
      // A successful replacement listener invalidates old server keys. Remove only our
      // own stale proxy files; never traverse directories or touch other application data.
      if (!options.key && area === 'memory-auth')
        for (const name of readdirSync(directory)) {
          if (/^proxy-[a-f0-9]{48}\.(?:json|mjs)$/.test(name))
            rmSync(join(directory, name), { force: true })
        }
      const script = join(directory, `proxy-${randomBytes(24).toString('hex')}.mjs`)
      writeFileSync(script, proxySource, { flag: 'wx', mode: 0o600 })
      listeners.set(this.origin, { key, directory, script, files: new Set([script]) })
      return `${this.origin}/mcp`
    } catch (error) {
      this.close()
      throw error
    }
  }
  close() {
    const state = listeners.get(this.origin)
    if (state) {
      for (const file of state.files) {
        try {
          rmSync(file, { force: true })
        } catch {
          /* Revocation and listener shutdown take precedence over file cleanup. */
        }
      }
      listeners.delete(this.origin)
    }
    this.server.closeAllConnections()
    this.server.close()
    // In-flight handlers may still settle, but cannot send on closed responses.
  }
}
