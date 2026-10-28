import { createServer, type Server } from 'node:http'
import { z } from 'zod'
import { type MemoryRead } from '../../shared/memory'
import { MemoryError, MemoryStore } from './store'
import { agentActions, toolSchemas, memoryTools, memoryInstructions } from './protocol'
import { MemoryConnections } from './connections'
import { randomBytes } from 'node:crypto'
import { ClaudeRuntimeInbox } from '../communication/claudeRuntime'
import {
  communicationInstructions,
  communicationSchemas,
  communicationTools,
  type CommunicationAction,
  type CommunicationActor,
} from '../../shared/communication'

/** Stateless Streamable HTTP MCP, bound to loopback and authenticated on every request. */
export class MemoryServer {
  private server: Server | null = null
  endpoint: string | null = null
  readonly connections: MemoryConnections
  readonly runtime: ClaudeRuntimeInbox
  private ownedCommunication = new Map<string, () => CommunicationActor>()
  revokeCommunication() {
    this.ownedCommunication.clear()
    this.runtime.clear()
  }
  connectCommunication(actor: () => CommunicationActor) {
    if (!this.endpoint) throw new Error('Communication endpoint is unavailable.')
    const token = randomBytes(32).toString('hex')
    this.ownedCommunication.set(token, actor)
    return {
      endpoint: this.endpoint.replace('/mcp', '/communication'),
      token,
      close: () => {
        this.ownedCommunication.delete(token)
      },
    }
  }
  constructor(private readonly store: MemoryStore) {
    this.connections = new MemoryConnections(store)
    store.connectionStatus = () => this.connections.list()
    this.runtime = new ClaudeRuntimeInbox(store.communications)
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
      const runtimeConnection = request.url?.match(/^\/plugin\/runtime\/([a-f0-9-]{36})$/)?.[1]
      const connection =
        runtimeConnection ?? request.url?.match(/^\/plugin\/mcp\/([a-f0-9-]{36})$/)?.[1]
      const communicationOnly = request.url === '/communication'
      if (request.url !== '/mcp' && !connection && !communicationOnly) return finish(404)
      let actor: import('./store').MemoryActor | undefined
      let communicationActor: CommunicationActor | undefined
      try {
        if (!request.headers.authorization?.startsWith('Bearer ')) throw new Error('Missing bearer')
        if (communicationOnly) {
          communicationActor = this.ownedCommunication.get(
            request.headers.authorization.slice(7),
          )?.()
          if (!communicationActor) throw new Error('Communication connection expired.')
        } else
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
      request.on('end', async () => {
        if (response.writableEnded) return
        let id: string | number | null = null
        try {
          if (runtimeConnection) {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (body.action === 'unregister') {
              z.object({ action: z.literal('unregister') })
                .strict()
                .parse(body)
              this.runtime.unregister(runtimeConnection)
              return finish(200, { disconnected: true })
            }
            const input = z
              .object({
                action: z.literal('register'),
                socket: z.string().max(240),
                token: z.string().max(1024),
              })
              .strict()
              .parse(body)
            return finish(
              200,
              await this.runtime.register(
                runtimeConnection,
                () => {
                  const actor = this.store.communicationActor(
                    this.connections.authenticate(
                      runtimeConnection,
                      request.headers.authorization!.slice(7),
                    ),
                  )
                  if (
                    !actor.spaceId ||
                    !this.store.communicationService
                      ?.workflow(actor.spaceId)
                      ?.participants.some((p) => p.target === actor.target && p.communicate)
                  )
                    throw new Error(
                      'Enable communication for this enrolled workflow participant first.',
                    )
                  return actor
                },
                { socket: input.socket, token: input.token },
              ),
            )
          }
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
              instructions: communicationOnly
                ? communicationInstructions
                : `${memoryInstructions}\n${communicationInstructions}`,
            }
          else if (msg.method === 'ping') result = {}
          else if (msg.method === 'tools/list')
            result = {
              tools: communicationOnly
                ? communicationTools
                : [...memoryTools, ...communicationTools],
            }
          else if (msg.method === 'tools/call') {
            const params = z
              .object({
                name: z.string(),
                arguments: z.record(z.string(), z.unknown()).default({}),
              })
              .parse(msg.params)
            const action = agentActions.find((a) => `memory_${a}` === params.name)
            const communicationAction = Object.keys(communicationSchemas).find(
              (a) => `threadlight_${a}` === params.name,
            ) as CommunicationAction | undefined
            if (communicationAction) {
              try {
                if (!this.store.communicationService)
                  throw new Error('Thread communication is unavailable.')
                if (
                  connection &&
                  ['claim_delivery', 'complete_delivery'].includes(communicationAction)
                ) {
                  const recipient = this.store.communicationActor(
                    this.connections.authenticate(
                      connection,
                      request.headers.authorization!.slice(7),
                    ),
                  )
                  const capability = recipient.target
                    ? await this.runtime.destination(recipient.target)
                    : undefined
                  if (!capability?.send)
                    throw new Error('The recipient runtime is no longer verified.')
                }
                const value = await this.store.communicationService.execute(
                  communicationAction,
                  params.arguments,
                  communicationActor ??
                    (connection
                      ? this.runtime.actor(
                          connection,
                          this.store.communicationActor(
                            this.connections.authenticate(
                              connection,
                              request.headers.authorization!.slice(7),
                            ),
                          ),
                        )
                      : this.store.communicationActor(
                          this.store.authenticate(request.headers.authorization!.slice(7)),
                        )),
                  () => {
                    if (response.destroyed) throw new Error('Question reader disconnected.')
                    const token = request.headers.authorization!.slice(7)
                    if (communicationOnly) {
                      if (!this.ownedCommunication.has(token))
                        throw new Error('Communication connection expired.')
                    } else if (connection) this.connections.authenticate(connection, token)
                    else this.store.authenticate(token)
                  },
                )
                return finish(200, {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text: JSON.stringify(value) }],
                    isError: false,
                  },
                })
              } catch (error) {
                return finish(200, {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: error instanceof Error ? error.message : 'Communication failed.',
                      },
                    ],
                    isError: true,
                  },
                })
              }
            }
            if (communicationOnly)
              throw new Error('Only communication tools are available on this connection.')
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
        } catch (error) {
          if (runtimeConnection)
            return finish(400, {
              error: error instanceof Error ? error.message : 'Runtime registration failed.',
            })
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
    this.runtime.close()
    this.ownedCommunication.clear()
    this.connections.close()
    this.server?.closeAllConnections()
    this.server?.close()
    this.endpoint = null
  }
}
