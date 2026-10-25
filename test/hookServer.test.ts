import { request } from 'node:http'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startHookServer, type HookServer } from '../src/main/hookServer'

let server: HookServer
let events: unknown[]

beforeEach(async () => {
  events = []
  server = await startHookServer({ port: 0, onEvent: (payload) => events.push(payload) })
})
afterEach(() => server.close())

/** A raw HTTP call, so tests control every header (fetch would add its own). */
function send(options: {
  path?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: options.path ?? '/hook/PreToolUse',
        method: options.method ?? 'POST',
        headers: options.headers,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end(options.body ?? '{"session_id":"session-a","hook_event_name":"PreToolUse"}')
  })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('hook server', () => {
  it('accepts a hook event and answers with no body', async () => {
    const reply = await send({})
    await settle()
    expect(reply).toEqual({ status: 204, body: '' })
    expect(events).toEqual([{ session_id: 'session-a', hook_event_name: 'PreToolUse' }])
  })

  it('fills in the event name from the path when the payload lacks it', async () => {
    await send({ path: '/hook/Stop', body: '{"session_id":"session-a"}' })
    await settle()
    expect(events).toEqual([{ session_id: 'session-a', hook_event_name: 'Stop' }])
  })

  it('refuses anything a web page could send', async () => {
    expect((await send({ headers: { Origin: 'https://example.com' } })).status).toBe(403)
    expect((await send({ headers: { Referer: 'https://example.com/' } })).status).toBe(403)
    expect((await send({ headers: { Host: 'attacker.example:80' } })).status).toBe(403)
    await settle()
    expect(events).toEqual([])
  })

  it('answers GET /status when given a status, refusing web pages as for events', async () => {
    expect((await send({ path: '/status', method: 'GET' })).status).toBe(404) // none given
    await server.close()
    server = await startHookServer({
      port: 0,
      onEvent: () => {},
      status: () => ({ hookEvents: 3 }),
    })
    expect(await send({ path: '/status', method: 'GET' })).toEqual({
      status: 200,
      body: '{"hookEvents":3}',
    })
    const page = { path: '/status', method: 'GET', headers: { Origin: 'https://example.com' } }
    expect((await send(page)).status).toBe(403)
  })

  it('holds POST /ask open until replied, answering with the body or with nothing', async () => {
    await server.close()
    let replyTo: ((body: string | null) => void) | undefined
    server = await startHookServer({
      port: 0,
      onEvent: () => {},
      onAsk: (_payload, reply) => {
        replyTo = reply
        return true
      },
    })
    const pending = send({ path: '/ask', body: '{"tool_name":"AskUserQuestion"}' })
    await settle()
    replyTo?.('{"ok":1}')
    expect(await pending).toEqual({ status: 200, body: '{"ok":1}' })

    const released = send({ path: '/ask', body: '{}' })
    await settle()
    replyTo?.(null)
    expect(await released).toEqual({ status: 204, body: '' })
  })

  it('answers /ask with nothing at once when there is nothing to hold, or no handler', async () => {
    expect(await send({ path: '/ask', body: '{}' })).toEqual({ status: 404, body: '' })
    await server.close()
    server = await startHookServer({ port: 0, onEvent: () => {}, onAsk: () => false })
    expect(await send({ path: '/ask', body: '{}' })).toEqual({ status: 204, body: '' })
    expect((await send({ path: '/ask', headers: { Origin: 'https://example.com' } })).status).toBe(
      403,
    )
  })

  it('ignores other methods, paths and broken JSON', async () => {
    expect((await send({ method: 'GET' })).status).toBe(404)
    expect((await send({ path: '/send' })).status).toBe(404)
    expect((await send({ path: '/hook/../x' })).status).toBe(404)
    expect((await send({ body: '{broken' })).status).toBe(204)
    await settle()
    expect(events).toEqual([])
  })
})
