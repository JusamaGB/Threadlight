import { MemoryTransport, openMemoryProxy, type MemoryTransportOptions } from '../memory/transport'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  APP_CONTROL_INSTRUCTIONS,
  APP_CONTROL_VERSION,
  controlTools,
} from '../../shared/appControl'
import type { ThreadReadConnection } from '../threadRead/server'
import { AppControlService, type ControlCaller } from './service'

/** Foreground Agent only. Never mounted on the shared-memory/plugin server. */
export class AppControlServer {
  private transport?: MemoryTransport
  private endpoint = ''
  private callers = new Map<string, ControlCaller>()
  constructor(
    readonly service: AppControlService,
    private transportOptions: MemoryTransportOptions = {},
  ) {}
  connect(caller: ControlCaller): ThreadReadConnection {
    if (!this.endpoint) throw Error('Application control unavailable.')
    const token = randomBytes(32).toString('hex')
    this.callers.set(token, caller)
    const proxy = openMemoryProxy(this.endpoint, token)
    return {
      mcp: proxy.mcp,
      endpoint: this.endpoint,
      token,
      close: () => {
        proxy.close()
        this.service.revoke(caller)
        this.callers.delete(token)
      },
    }
  }
  async start() {
    this.transport = new MemoryTransport((request, response, finish) => {
      if (
        request.socket.remoteAddress !== '127.0.0.1' ||
        request.headers.origin !== undefined ||
        request.headers.host !== new URL(this.endpoint).host
      )
        return finish(403)
      if (request.url !== '/mcp') return finish(404)
      const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
      const caller = token ? this.callers.get(token) : undefined
      if (!caller?.active) return finish(401)
      if (request.method !== 'POST') return finish(405)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))
        return finish(415)
      const chunks: Buffer[] = []
      let size = 0
      request.setTimeout(6000, () => request.destroy())
      request.on('error', () => {})
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 300000) {
          finish(413)
          request.destroy()
        } else chunks.push(chunk)
      })
      request.on('end', () => {
        void (async () => {
          let id: string | number | null = null
          try {
            const msg = z
              .object({
                jsonrpc: z.literal('2.0'),
                id: z.union([z.string().max(200), z.number()]).optional(),
                method: z.string().max(100),
                params: z.record(z.string(), z.unknown()).optional(),
              })
              .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            if (
              size > 32000 &&
              !(msg.method === 'tools/call' && msg.params?.name === 'threadlight_replace_pin')
            )
              return finish(413)
            id = msg.id ?? null
            if (!caller.active) return finish(401)
            if (msg.id === undefined) return finish(202)
            let result: unknown
            if (msg.method === 'initialize')
              result = {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: {
                  name: 'Threadlight application control',
                  version: APP_CONTROL_VERSION,
                },
                instructions: APP_CONTROL_INSTRUCTIONS,
              }
            else if (msg.method === 'ping') result = {}
            else if (msg.method === 'tools/list')
              result = {
                tools: controlTools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: z.toJSONSchema(t.schema),
                  annotations: {
                    readOnlyHint: t.effect === 'read',
                    destructiveHint: t.effect === 'write',
                    openWorldHint: false,
                  },
                })),
              }
            else if (msg.method === 'tools/call') {
              const params = z
                .object({ name: z.string().max(100), arguments: z.unknown() })
                .parse(msg.params)
              let timer: ReturnType<typeof setTimeout> | undefined
              const value = await Promise.race([
                this.service.call(caller, params.name, params.arguments),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(Error('Deadline')), 6000)
                }),
              ])
                .catch(() => this.service.failure())
                .finally(() => clearTimeout(timer))
              if (!caller.active) return finish(401)
              if (params.name === 'threadlight_foreground_window' && value.outcome === 'ok') {
                const { jpeg, ...identity } =
                  value.data as import('../liveScreen').WindowObservation
                result = {
                  content: [
                    { type: 'text', text: JSON.stringify(identity) },
                    ...(jpeg ? [{ type: 'image', mimeType: 'image/jpeg', data: jpeg }] : []),
                  ],
                }
              } else
                result = {
                  content: [{ type: 'text', text: JSON.stringify(value) }],
                  isError: !['ok', 'pending'].includes(value.outcome),
                }
              response.once('finish', () => this.service.responseFlushed(value))
            } else
              return finish(200, {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: 'Method unavailable' },
              })
            finish(200, { jsonrpc: '2.0', id, result })
          } catch {
            finish(200, {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Invalid or timed-out request. Recover a write using get_operation.',
              },
            })
          }
        })()
      })
    })
    this.endpoint = await this.transport.start(0, this.transportOptions, 'app-control-auth')
  }
  close() {
    for (const caller of this.callers.values()) this.service.revoke(caller)
    this.callers.clear()
    this.transport?.close()
    this.endpoint = ''
  }
}
