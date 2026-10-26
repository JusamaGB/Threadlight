import { createServer, type Server } from 'node:http'
import { z } from 'zod'
import { type MemoryRead } from '../../shared/memory'
import { MemoryError, MemoryStore } from './store'
import { agentActions, toolSchemas, memoryTools, memoryInstructions } from './protocol'
import { MemoryConnections } from './connections'

/** Stateless Streamable HTTP MCP, bound to loopback and authenticated on every request. */
export class MemoryServer {
  private server: Server | null = null
  endpoint: string | null = null
  readonly connections: MemoryConnections
  constructor(private readonly store: MemoryStore) {
    this.connections = new MemoryConnections(store)
  }
  async start(port = 47618) {
    const server = createServer((request, response) => {
      const finish = (status: number, value?: unknown) => {
        if (response.writableEnded) return
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(value === undefined ? undefined : JSON.stringify(value))
      }
      if (request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? ''))
        return finish(403)
      if (request.url === '/plugin/connect') {
        this.connections.handle(request, finish)
        return
      }
      const connection = request.url?.match(/^\/plugin\/mcp\/([a-f0-9-]{36})$/)?.[1]
      if (request.url !== '/mcp' && !connection) return finish(404)
      let actor
      try {
        if (!request.headers.authorization?.startsWith('Bearer ')) throw new Error('Missing bearer')
        actor = connection
          ? this.connections.authenticate(connection, request.headers.authorization.slice(7))
          : this.store.authenticate(request.headers.authorization.slice(7))
      } catch {
        return finish(401, { error: 'An enrolled shared-memory capability is required.' })
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST')
        return finish(405)
      }
      if (!request.headers['content-type']?.startsWith('application/json')) return finish(415)
      const chunks: Buffer[] = []
      request.on('error', () => {
        /* Disconnected clients cannot crash the memory service. */
      })
      let size = 0
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 14_100_000) {
          finish(413)
          request.destroy()
        } else chunks.push(chunk)
      })
      request.on('end', () => {
        if (response.writableEnded) return
        let id: string | number | null = null
        try {
          const msg = z
            .object({
              jsonrpc: z.literal('2.0'),
              id: z.union([z.string(), z.number()]).optional(),
              method: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          id = msg.id ?? null
          if (msg.id === undefined) return finish(202)
          let result: unknown
          if (msg.method === 'initialize')
            result = {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'Threadlight Shared Spaces', version: '1.0.0' },
              instructions: memoryInstructions,
            }
          else if (msg.method === 'ping') result = {}
          else if (msg.method === 'tools/list')
            result = {
              tools: memoryTools,
            }
          else if (msg.method === 'tools/call') {
            const params = z
              .object({
                name: z.string(),
                arguments: z.record(z.string(), z.unknown()).default({}),
              })
              .parse(msg.params)
            const action = agentActions.find((a) => `memory_${a}` === params.name)
            if (!action) throw new MemoryError('invalid_input', 'Unknown memory tool.')
            try {
              const value = this.store.execute(
                { ...toolSchemas[action].parse(params.arguments), action },
                actor,
              )
              const read = action === 'read' ? (value as MemoryRead) : null
              const image = read?.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
              const content: unknown[] = [
                {
                  type: 'text',
                  text: JSON.stringify(read ? { ...read, dataUrl: undefined } : value),
                },
              ]
              if (image) content.push({ type: 'image', mimeType: image[1], data: image[2] })
              if (read?.dataUrl?.startsWith('data:application/pdf;base64,'))
                content.push({
                  type: 'resource',
                  resource: {
                    uri: `threadlight://items/${read.item.id}/v${read.revision.revision}`,
                    mimeType: 'application/pdf',
                    blob: read.dataUrl.split(',')[1],
                  },
                })
              result = { content, isError: false }
            } catch (error) {
              result = {
                content: [
                  {
                    type: 'text',
                    text: error instanceof Error ? error.message : 'Memory operation failed.',
                  },
                ],
                isError: true,
              }
            }
          } else
            return finish(200, {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: 'Method not supported' },
            })
          finish(200, { jsonrpc: '2.0', id, result })
        } catch {
          finish(400, {
            jsonrpc: '2.0',
            id,
            error: { code: -32600, message: 'Invalid memory request' },
          })
        }
      })
    })
    server.requestTimeout = 15_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    this.server = server
    const address = server.address()
    this.endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/mcp`
    return this.endpoint
  }
  close() {
    this.connections.close()
    this.server?.closeAllConnections()
    this.server?.close()
    this.endpoint = null
  }
}
