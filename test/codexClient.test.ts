import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { CodexClient } from '../src/main/agent/codexClient'

function fixture() {
  const stdout = new PassThrough(),
    stdin = new PassThrough(),
    stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout, stdin, stderr, kill: vi.fn() })
  const writes: Record<string, unknown>[] = []
  stdin.on('data', (chunk) => writes.push(JSON.parse(String(chunk))))
  const start = vi.fn(() => child)
  const client = new CodexClient(
    { command: 'synthetic-codex.exe', prefixArgs: [] },
    'C:/synthetic',
    start as unknown as typeof spawn,
  )
  return {
    client,
    child,
    writes,
    start,
    say: (value: object) => stdout.write(JSON.stringify(value) + '\n'),
  }
}

describe('Codex stdio transport', () => {
  it('initializes once, parses split frames, and handles out-of-order replies and typed server request IDs', async () => {
    const { client, child, writes, say, start } = fixture()
    const initialized = client.initialize()
    expect(writes[0]).toMatchObject({ method: 'initialize', id: 1 })
    child.stdout.write('{"id":1,"res')
    child.stdout.write('ult":{}}\n')
    await initialized
    expect(writes[1]).toMatchObject({ method: 'initialized' })
    expect(start.mock.calls[0]).toBeDefined()
    const first = client.request('first'),
      second = client.request('second')
    say({ id: 3, result: { value: 'second' } })
    say({ id: 2, result: { value: 'first' } })
    expect(await first).toEqual({ value: 'first' })
    expect(await second).toEqual({ value: 'second' })
    const event = vi.fn()
    client.onEvent = event
    say({ method: 'request', id: '2', params: { value: 1 } })
    expect(event).toHaveBeenCalledWith('request', { value: 1 }, '2')
    client.respond('2', { decision: 'decline' })
    expect(writes.at(-1)).toEqual({ id: '2', result: { decision: 'decline' } })
    client.close()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('fails bounded malformed input and rejects pending requests on disconnection', async () => {
    const { client, child } = fixture()
    const failed = vi.fn()
    client.onFailure = failed
    const pending = client.request('pending')
    const rejection = expect(pending).rejects.toThrow('ended')
    child.stdout.write('not json\n')
    await rejection
    expect(failed).toHaveBeenCalledTimes(1)
    child.emit('close')
    expect(failed).toHaveBeenCalledTimes(1)
  })

  it('times out an unknown acknowledgement without replaying the request', async () => {
    vi.useFakeTimers()
    try {
      const { client, writes } = fixture()
      const pending = client.request('turn/start', {}, 20)
      const failure = expect(pending).rejects.toThrow('before retrying')
      await vi.advanceTimersByTimeAsync(21)
      await failure
      expect(writes).toHaveLength(1)
      client.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
