// Receives Claude Code hook events on 127.0.0.1. Each hook runs `curl --data-binary @- …`,
// piping the event JSON Claude Code gave it. This endpoint can only update session state;
// it has no way to send messages, so the worst a stray request can do is mislabel a dot.
// `GET /status` answers with a few counts, for the installer's check.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const DEFAULT_HOOK_PORT = 47615
/** Tool-call payloads can carry whole files; anything larger is not worth reading. */
const MAX_BODY_BYTES = 16 * 1024 * 1024
const PATH = /^\/hook\/([A-Za-z]{1,40})$/

export interface HookServerOptions {
  port: number
  onEvent: (payload: unknown) => void
  /** Answer to `GET /status`; nothing private, only that it runs and how many events arrived. */
  status?: () => object
}

export interface HookServer {
  port: number
  close(): Promise<void>
}

export function startHookServer({ port, onEvent, status }: HookServerOptions): Promise<HookServer> {
  const server = createServer((request, response) =>
    handle(request, response, onEvent, status, server),
  )
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function handle(
  request: IncomingMessage,
  response: ServerResponse,
  onEvent: (payload: unknown) => void,
  status: (() => object) | undefined,
  server: Server,
): void {
  if (request.method === 'GET' && request.url === '/status' && status) {
    if (!fromLocalTool(request, server)) return finish(response, 403)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(status()))
    return
  }
  const match = PATH.exec(request.url ?? '')
  if (request.method !== 'POST' || !match) return finish(response, 404)
  if (!fromLocalTool(request, server)) return finish(response, 403)

  const chunks: Buffer[] = []
  let size = 0
  request.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size <= MAX_BODY_BYTES) chunks.push(chunk)
  })
  request.on('end', () => {
    // Always answer 204 with no body: hook output can end up in Claude's context.
    finish(response, 204)
    if (size > MAX_BODY_BYTES) return
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return
    }
    if (typeof payload === 'object' && payload !== null && !('hook_event_name' in payload)) {
      ;(payload as Record<string, unknown>)['hook_event_name'] = match[1]
    }
    onEvent(payload)
  })
}

/**
 * Browsers always send Origin (and usually Referer) on cross-site POSTs, and a DNS-rebinding
 * page arrives with a foreign Host header. curl sends neither, so both are refused.
 */
function fromLocalTool(request: IncomingMessage, server: Server): boolean {
  if (request.headers.origin !== undefined || request.headers.referer !== undefined) return false
  const port = (server.address() as AddressInfo).port
  const host = request.headers.host ?? ''
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

function finish(response: ServerResponse, status: number): void {
  response.writeHead(status)
  response.end()
}
