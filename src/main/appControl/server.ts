import { createServer, type Server } from 'node:http'
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
  private server?: Server
  private endpoint = ''
  private callers = new Map<string, ControlCaller>()
  constructor(readonly service: AppControlService) {}
  connect(caller: ControlCaller): ThreadReadConnection {
    if (!this.endpoint) throw Error('Application control unavailable.')
    const token = randomBytes(32).toString('hex')
    this.callers.set(token, caller)
    return {
      endpoint: this.endpoint,
      token,
      close: () => {
        this.service.revoke(caller)
        this.callers.delete(token)
      },
    }
  }
  async start() {
    this.server = createServer((request, response) => {
      const finish = (status: number, value?: unknown) => {
        if (response.writableEnded) return
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        response.end(value === undefined ? undefined : JSON.stringify(value))
      }
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
        if (size > 32000) {
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
    this.server.requestTimeout = 6500
    this.server.headersTimeout = 6500
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw Error('Control listener unavailable')
    this.endpoint = `http://127.0.0.1:${address.port}/mcp`
  }
  close() {
    for (const caller of this.callers.values()) this.service.revoke(caller)
    this.callers.clear()
    this.server?.closeAllConnections()
    this.server?.close()
    this.endpoint = ''
  }
}
