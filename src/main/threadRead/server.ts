import { MemoryTransport, openMemoryProxy, type MemoryTransportOptions } from '../memory/transport'
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
  mcp?: import('../memory/transport').MemoryProxy
  endpoint: string
  token: string
  close: () => void
}
export class ThreadReadServer {
  private transport?: MemoryTransport
  private endpoint = ''
  private connections = new Map<
    string,
    { scope: ReadScope; receipt: (r: ThreadToolReceipt) => void }
  >()
  constructor(
    private service: ThreadReadService,
    private transportOptions: MemoryTransportOptions = {},
  ) {}
  resolve(connection: ThreadReadConnection, ref: string) {
    const caller = this.connections.get(connection.token)
    return caller ? this.service.resolve(caller.scope, ref) : null
  }
  async cards(connection: ThreadReadConnection, ref: string) {
    const caller = this.connections.get(connection.token)
    return caller ? this.service.cards(caller.scope, ref) : null
  }
  find(connection: ThreadReadConnection, input: unknown) {
    const caller = this.connections.get(connection.token)
    if (!caller) throw Error('Reader connection expired.')
    return this.service.find(caller.scope, input)
  }
  read(connection: ThreadReadConnection, input: unknown) {
    const caller = this.connections.get(connection.token)
    if (!caller) throw Error('Reader connection expired.')
    return this.service.read(caller.scope, input)
  }
  connect(
    receipt: (r: ThreadToolReceipt) => void,
    permits?: ReadScope['permits'],
  ): ThreadReadConnection {
    if (!this.endpoint) throw new Error('Thread reader is not listening.')
    const token = randomBytes(32).toString('hex'),
      scope = this.service.open(permits)
    this.connections.set(token, { scope, receipt })
    const proxy = openMemoryProxy(this.endpoint, token)
    return {
      mcp: proxy.mcp,
      endpoint: this.endpoint,
      token,
      close: () => {
        proxy.close()
        this.service.close(scope)
        this.connections.delete(token)
      },
    }
  }
  async start() {
    this.transport = new MemoryTransport((request, response, finish) => {
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
    this.endpoint = await this.transport.start(0, this.transportOptions, 'thread-read-auth')
  }
  close() {
    for (const c of this.connections.values()) this.service.close(c.scope)
    this.connections.clear()
    this.transport?.close()
    this.endpoint = ''
  }
}
