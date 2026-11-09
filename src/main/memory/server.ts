import { browserCommand, browserTools } from '../../shared/browser'
import { callBrowser, browserContent } from '../browser/registry'
import { MemoryTransport, openMemoryProxy, type MemoryTransportOptions } from './transport'
import { z } from 'zod'
import { type MemoryRead, type MemoryInput, type MemoryManualConnection } from '../../shared/memory'
import { MemoryError, MemoryStore } from './store'
import { agentActions, toolSchemas, memoryTools, memoryInstructions } from './protocol'
import { MemoryConnections } from './connections'
import { randomBytes, randomUUID } from 'node:crypto'
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
  private transport: MemoryTransport | null = null
  private proxies = new Map<string, () => void>()
  endpoint: string | null = null
  readonly connections: MemoryConnections
  readonly runtime: ClaudeRuntimeInbox
  private ownedCommunication = new Map<string, () => CommunicationActor>()
  enroll(input: MemoryInput): MemoryManualConnection {
    if (!this.endpoint) throw new Error('Shared memory is offline.')
    const grant = this.store.execute({ ...input, action: 'create_grant' }) as {
      id: string
      token: string
      label: string
    }
    if (typeof grant.token !== 'string')
      throw new Error('This configuration was already issued. Create a fresh enrollment.')
    try {
      const proxy = openMemoryProxy(this.endpoint, grant.token)
      this.proxies.set(grant.id, proxy.close)
      return {
        label: grant.label,
        claude: JSON.stringify(
          { mcpServers: { threadlight: { type: 'stdio', ...proxy.mcp } } },
          null,
          2,
        ),
        codex: `[mcp_servers.threadlight]\ncommand = ${JSON.stringify(proxy.mcp.command)}\nargs = [${proxy.mcp.args.map((s) => JSON.stringify(s)).join(', ')}]\nenv = { ELECTRON_RUN_AS_NODE = "1" }`,
      }
    } catch (error) {
      this.store.execute({ action: 'revoke_grant', id: grant.id, operationId: randomUUID() })
      throw error
    }
  }
  releaseEnrollment(id: string) {
    this.proxies.get(id)?.()
    this.proxies.delete(id)
  }
  revokeCommunication() {
    for (const close of this.proxies.values()) close()
    this.proxies.clear()
    this.ownedCommunication.clear()
    this.runtime.clear()
  }
  connectCommunication(actor: () => CommunicationActor) {
    if (!this.endpoint) throw new Error('Communication endpoint is unavailable.')
    const token = randomBytes(32).toString('hex')
    const endpoint = this.endpoint.replace('/mcp', '/communication')
    const proxy = openMemoryProxy(endpoint, token)
    this.proxies.set(token, proxy.close)
    this.ownedCommunication.set(token, actor)
    return {
      mcp: proxy.mcp,
      endpoint,
      token,
      close: () => {
        proxy.close()
        this.proxies.delete(token)
        this.ownedCommunication.delete(token)
      },
    }
  }
  constructor(
    private readonly store: MemoryStore,
    private readonly transportOptions: MemoryTransportOptions = {},
  ) {
    this.connections = new MemoryConnections(store)
    store.connectionStatus = () => this.connections.list()
    this.runtime = new ClaudeRuntimeInbox(store.communications)
  }
  async start(port = 47618) {
    const transport = new MemoryTransport((request, response, finish) => {
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
        if (response.writableEnded || response.destroyed) return
        try {
          const token = request.headers.authorization!.slice(7)
          if (communicationOnly) {
            communicationActor = this.ownedCommunication.get(token)?.()
            if (!communicationActor) throw new Error('Connection expired.')
          } else
            actor = connection
              ? this.connections.authenticate(connection, token)
              : this.store.authenticate(token)
        } catch {
          return finish(401, { error: 'Connection expired or revoked.' })
        }
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
                : [...memoryTools, ...communicationTools, ...(connection ? browserTools : [])],
            }
          else if (msg.method === 'tools/call') {
            const params = z
              .object({
                name: z.string(),
                arguments: z.record(z.string(), z.unknown()).default({}),
              })
              .parse(msg.params)
            if (params.name === 'threadlight_browser') {
              if (!connection || communicationOnly)
                throw Error('Use an enrolled Codex or Claude plugin connection.')
              const connectionId = connection
              const secret = request.headers.authorization!.slice(7)
              const valid = () => {
                try {
                  this.connections.authenticate(connectionId, secret)
                  return true
                } catch {
                  return false
                }
              }
              const record = this.connections.list().find((c) => c.id === connectionId)
              const value = await callBrowser(
                { id: connectionId, label: record?.label ?? 'Connected agent', valid },
                browserCommand.parse(params.arguments),
              )
              return finish(200, { jsonrpc: '2.0', id, result: browserContent(value) })
            }
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
    this.transport = transport
    this.endpoint = await transport.start(port, this.transportOptions)
    return this.endpoint
  }
  close() {
    this.runtime.close()
    for (const close of this.proxies.values()) close()
    this.proxies.clear()
    this.ownedCommunication.clear()
    this.connections.close()
    this.transport?.close()
    this.endpoint = null
  }
}
