import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  findThreadsSchema,
  readThreadSchema,
  THREAD_READ_INSTRUCTIONS,
  THREAD_READ_TOOLS,
  type ThreadToolReceipt,
} from '../../shared/threadRead'
import { ThreadReadService, type ReadScope } from './service'

export interface ThreadReadConnection {
  endpoint: string
  token: string
  close: () => void
}
export class ThreadReadServer {
  private server: Server | null = null
  private endpoint = ''
  private connections = new Map<
    string,
    { scope: ReadScope; receipt: (r: ThreadToolReceipt) => void }
  >()
  constructor(private service: ThreadReadService) {}
  connect(receipt: (r: ThreadToolReceipt) => void): ThreadReadConnection {
    if (!this.endpoint) throw new Error('Thread reader is not listening.')
    const token = randomBytes(32).toString('hex'),
      scope = this.service.open()
    this.connections.set(token, { scope, receipt })
    return {
      endpoint: this.endpoint,
      token,
      close: () => {
        this.service.close(scope)
        this.connections.delete(token)
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
      if (request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? ''))
        return finish(403)
      if (request.url !== '/mcp') return finish(404)
      const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
      const connection = token ? this.connections.get(token) : undefined
      if (!connection) return finish(401)
      if (request.method !== 'POST') return finish(405)
      if (!request.headers['content-type']?.startsWith('application/json')) return finish(415)
      let size = 0
      const chunks: Buffer[] = []
      request.on('error', () => {})
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 32_000) {
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
                method: z.string(),
                params: z.record(z.string(), z.unknown()).optional(),
              })
              .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            id = msg.id ?? null
            if (!connection.scope.active) return finish(401)
            if (msg.id === undefined) return finish(202)
            let result: unknown
            if (msg.method === 'initialize')
              result = {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'Threadlight chat reader', version: '1.0.0' },
                instructions: THREAD_READ_INSTRUCTIONS,
              }
            else if (msg.method === 'ping') result = {}
            else if (msg.method === 'tools/list')
              result = {
                tools: THREAD_READ_TOOLS.map((name, i) => ({
                  name,
                  description: i
                    ? 'Read a resolved chat from current local evidence; does not wake or change it.'
                    : 'Find named local chats. Continue incomplete searches using the same query and returned cursor. Clarify ambiguity before reading.',
                  inputSchema: z.toJSONSchema(i ? readThreadSchema : findThreadsSchema),
                  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
                })),
              }
            else if (msg.method === 'tools/call') {
              const params = z
                .object({ name: z.enum(THREAD_READ_TOOLS), arguments: z.unknown() })
                .parse(msg.params)
              let timer: ReturnType<typeof setTimeout> | undefined
              const value = await Promise.race([
                params.name === THREAD_READ_TOOLS[0]
                  ? this.service.find(connection.scope, params.arguments)
                  : this.service.read(connection.scope, params.arguments),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () =>
                      reject(new Error('Read deadline exceeded; no fresh result was delivered.')),
                    5000,
                  )
                }),
              ]).finally(() => clearTimeout(timer))
              if (!connection.scope.active) return finish(401)
              const receipt: ThreadToolReceipt = {
                callId: `${connection.scope.id}:${String(id)}:${randomUUID()}`,
                tool: params.name,
                at: Date.now(),
                correlation: 'local_runtime_call',
                result: value,
              }
              connection.receipt(receipt)
              result = {
                content: [{ type: 'text', text: JSON.stringify(value) }],
                isError: !['ok', 'partial'].includes(value.outcome),
              }
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
                message: 'Invalid or timed-out read request; no fresh evidence available.',
              },
            })
          }
        })()
      })
    })
    this.server.requestTimeout = 6000
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Reader listener unavailable.')
    this.endpoint = `http://127.0.0.1:${address.port}/mcp`
  }
  close() {
    for (const c of this.connections.values()) this.service.close(c.scope)
    this.connections.clear()
    this.server?.closeAllConnections()
    this.server?.close()
    this.endpoint = ''
  }
}
