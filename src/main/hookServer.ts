// Receives Claude Code hook events on 127.0.0.1. Each hook runs `curl --data-binary @- …`,
// piping the event JSON Claude Code gave it. This endpoint can only update session state;
// it has no way to send messages, so the worst a stray request can do is mislabel a dot.
// `GET /status` answers with a few counts, for the installer's check.
// `POST /ask`, `/stop`, `/permission` and `/offer` are the routes that answer with a body: the
// question-card, Stop, PermissionRequest and session-offer hooks wait on them, and get either
// the user's answer or nothing (holds.ts).

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
  /** A question card the hook is waiting on (`POST /ask`). */
  onAsk?: HoldHandler
  /** The end of a turn the Stop hook is waiting on (`POST /stop`). */
  onStop?: HoldHandler
  /** A tool waiting for permission (`POST /permission`). */
  onPermission?: HoldHandler
  /** A New session / Do it here offer (`POST /offer`). */
  onOffer?: HoldHandler
}

/**
 * Call `reply` once, with the hook's output or null for none; `dropped` runs if the hook stops
 * waiting first. Return false to reply empty at once.
 */
export type HoldHandler = (
  payload: unknown,
  reply: (body: string | null) => void,
  dropped: (listener: () => void) => void,
) => boolean

export interface HookServer {
  port: number
  close(): Promise<void>
}

export function startHookServer(options: HookServerOptions): Promise<HookServer> {
  const { port } = options
  const server = createServer((request, response) => handle(request, response, options, server))
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
  { onEvent, status, onAsk, onStop, onPermission, onOffer }: HookServerOptions,
  server: Server,
): void {
  const holders: Record<string, HoldHandler | undefined> = {
    '/ask': onAsk,
    '/stop': onStop,
    '/permission': onPermission,
    '/offer': onOffer,
  }
  const holder = Object.hasOwn(holders, request.url ?? '') ? holders[request.url!] : undefined
  if (request.method === 'POST' && holder) {
    if (!fromLocalTool(request, server)) return finish(response, 403)
    return readJson(request, (payload) => ask(payload, response, holder))
  }
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

/** Holds the response open until the user answers here or the card is let go. */
function ask(payload: unknown, response: ServerResponse, onAsk: HoldHandler): void {
  let done = false
  const reply = (body: string | null) => {
    if (done) return
    done = true
    if (body === null) return finish(response, 204)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(body)
  }
  const listeners: (() => void)[] = []
  response.on('close', () => {
    if (done) return
    done = true
    for (const listener of listeners) listener()
  })
  if (payload === undefined || !onAsk(payload, reply, (listener) => listeners.push(listener))) {
    reply(null)
  }
}

/** Reads a small JSON body; anything unreadable arrives as undefined. */
function readJson(request: IncomingMessage, done: (payload: unknown) => void): void {
  const chunks: Buffer[] = []
  let size = 0
  request.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size <= MAX_BODY_BYTES) chunks.push(chunk)
  })
  request.on('end', () => {
    if (size > MAX_BODY_BYTES) return done(undefined)
    try {
      done(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      done(undefined)
    }
  })
}

function finish(response: ServerResponse, status: number): void {
  response.writeHead(status)
  response.end()
}
