// Receives Claude Code hook events on 127.0.0.1. Each hook runs the packaged Node helper,
// sending authenticated, encrypted event JSON. This server handles state and sensitive
// question/permission responses; all POST routes require the current user-scoped key.
// `GET /status` answers with a few counts, for the installer's check.
// `POST /ask`, `/stop`, `/permission` and `/offer` are the routes that answer with a body: the
// question-card, Stop, PermissionRequest and session-offer hooks wait on them, and get either
// the user's answer or nothing (holds.ts).
// `POST /context` is the one route whose answer is meant for Claude: the SessionStart hook
// passes it on as context, asking threads to note each plan step's files (planContext).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { HookAuthentication, publishHookKey, sealHook } from './hookAuth'

export const DEFAULT_HOOK_PORT = 47615
const PATH = /^\/hook\/([A-Za-z]{1,40})$/

export interface HookServerOptions {
  port: number
  /** Explicit ephemeral key for isolated tests; production publishes a protected user key. */
  authKey?: Buffer
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
  /** What a starting session is told (`POST /context`); null for nothing. */
  context?: () => string | null
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

const authenticated = new WeakMap<ServerResponse, { key: Buffer; nonce: string }>()
export async function startHookServer(options: HookServerOptions): Promise<HookServer> {
  let auth: HookAuthentication | undefined
  const server = createServer((request, response) => {
    if (!fromLocalTool(request, server)) return finish(response, 403)
    if (request.method === 'GET' && request.url === '/status')
      return handle(request, response, options, server, '')
    if (!auth || request.method !== 'POST') return finish(response, 403)
    const chunks: Buffer[] = []
    let size = 0
    request.setTimeout(10000, () => request.destroy())
    request.on('error', () => {
      if (!response.writableEnded) finish(response, 400)
    })
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 23 * 1024 * 1024) {
        finish(response, 413)
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      request.setTimeout(0)
      if (response.writableEnded || size > 23 * 1024 * 1024) return
      let input: { nonce: string; body: string }
      try {
        input = auth!.accept(request.url ?? '', Buffer.concat(chunks).toString('utf8'))
      } catch {
        return finish(response, 403)
      }
      authenticated.set(response, { key: auth!.key, nonce: input.nonce })
      handle(request, response, options, server, input.body)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  try {
    auth = new HookAuthentication(options.authKey ?? (await publishHookKey(options.port)))
    return {
      port: (server.address() as AddressInfo).port,
      close: () => new Promise<void>((done) => server.close(() => done())),
    }
  } catch (error) {
    server.close()
    throw error
  }
}

function handle(
  request: IncomingMessage,
  response: ServerResponse,
  { onEvent, status, onAsk, onStop, onPermission, onOffer, context }: HookServerOptions,
  server: Server,
  body: string,
): void {
  if (request.method === 'POST' && request.url === '/context' && context) {
    if (!fromLocalTool(request, server)) return finish(response, 403)
    // Read and drop the event, then answer in the SessionStart hook's documented shape.
    return readJson(body, () => {
      const text = context()
      if (!text) return finish(response, 204)
      finish(
        response,
        200,
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
        }),
      )
    })
  }
  const holders: Record<string, HoldHandler | undefined> = {
    '/ask': onAsk,
    '/stop': onStop,
    '/permission': onPermission,
    '/offer': onOffer,
  }
  const holder = Object.hasOwn(holders, request.url ?? '') ? holders[request.url!] : undefined
  if (request.method === 'POST' && holder) {
    if (!fromLocalTool(request, server)) return finish(response, 403)
    return readJson(body, (payload) => ask(payload, response, holder))
  }
  if (request.method === 'GET' && request.url === '/status' && status) {
    if (!fromLocalTool(request, server)) return finish(response, 403)
    finish(response, 200, JSON.stringify(status()))
    return
  }
  const match = PATH.exec(request.url ?? '')
  if (request.method !== 'POST' || !match) return finish(response, 404)
  if (!fromLocalTool(request, server)) return finish(response, 403)

  finish(response, 204)
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return
  }
  if (typeof payload === 'object' && payload !== null && !('hook_event_name' in payload)) {
    ;(payload as Record<string, unknown>)['hook_event_name'] = match[1]
  }
  onEvent(payload)
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
    finish(response, 200, body)
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
function readJson(body: string, done: (payload: unknown) => void): void {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return done(undefined)
  }
  done(value)
}

function finish(response: ServerResponse, status: number, body = ''): void {
  if (response.writableEnded) return
  const auth = authenticated.get(response)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
  if (auth) {
    authenticated.delete(response)
    response.writeHead(200)
    response.end(sealHook(auth.key, 'response:' + auth.nonce, { status, body }))
  } else {
    response.writeHead(status)
    response.end(body)
  }
}
