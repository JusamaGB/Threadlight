import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { CodexClient } from '../src/main/agent/codexClient'
import { CodexLive } from '../src/main/agent/codexLive'

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

  it.each([
    ['canonical', 'timeout'],
    ['canonical', 'rejection'],
    ['reconnect', 'timeout'],
    ['reconnect', 'rejection'],
  ])(
    'does not release queued or later proposal speech when %s progress submission ends in %s',
    async (source, failure) => {
      vi.useFakeTimers()
      const { client, writes, say } = fixture()
      const live = new CodexLive(
        client,
        'thread',
        'session',
        () => {},
        () => {},
      )
      try {
        live.beginTurn('work')
        const ack =
          source === 'canonical'
            ? 'I’ll check the current editor buffer.'
            : 'I’ll reconnect to the active buffer and continue with the unknown-item message change.'
        if (source === 'canonical')
          live.completedCommentary('work', {
            type: 'agentMessage',
            id: 'ack',
            phase: 'commentary',
            text: ack,
          })
        else {
          live.completedCommentary('work', {
            type: 'agentMessage',
            id: 'mixed',
            phase: 'commentary',
            text: ack,
          })
          live.editorActivity('work', 'capabilities', false, {})
          await vi.advanceTimersByTimeAsync(1)
        }
        expect(writes).toHaveLength(1)
        expect(JSON.stringify(writes[0])).toContain(ack)
        const queued = expect(live.coachStep('First shown proposal.', true, true)).rejects.toThrow(
          /confirmed playback boundary/,
        )
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30001)
        else say({ id: writes[0]!.id, error: { code: -1, message: 'Submission rejected' } })
        await queued
        expect(writes).toHaveLength(1)
        live.playbackBoundary('assistant', 'foreign')
        live.playbackBoundary('done', 'foreign', 'A separate spoken reply.')
        await expect(live.coachStep('Shown after the RPC failed.', true, true)).rejects.toThrow(
          /confirmed playback boundary/,
        )
        expect(writes).toHaveLength(1)
        // Late positive proof can make a subsequent fresh request eligible, but
        // must never replay either of the cancelled instructions.
        live.playbackBoundary('assistant', 'progress')
        live.playbackBoundary('done', 'progress', ack)
        await vi.advanceTimersByTimeAsync(1)
        expect(writes).toHaveLength(1)
        const fresh = live.coachStep('New visible step after confirmed progress.', true, true)
        expect(writes).toHaveLength(2)
        expect(JSON.stringify(writes[1])).toContain('New visible step')
        say({ id: writes[1]!.id, result: {} })
        await fresh
      } finally {
        live.disconnect('done')
        client.close()
        vi.useRealTimers()
      }
    },
  )

  it('offers only an explicit readout for final prose that arrives after an unacknowledged progress request', async () => {
    vi.useFakeTimers()
    const { client, writes, say } = fixture()
    const offered = vi.fn()
    const live = new CodexLive(
      client,
      'thread',
      'session',
      () => {},
      () => {},
      false,
      undefined,
      offered,
    )
    try {
      live.beginTurn('work')
      live.completedCommentary('work', {
        type: 'agentMessage',
        id: 'ack',
        phase: 'commentary',
        text: 'I’ll check the editor.',
      })
      await vi.advanceTimersByTimeAsync(30001)
      await live.finishTurn({
        id: 'work',
        status: 'completed',
        items: [
          {
            id: 'answer',
            type: 'agentMessage',
            phase: 'final_answer',
            text: 'The answer is in the thread.',
          },
        ],
      })
      expect(writes).toHaveLength(1)
      const token = offered.mock.lastCall?.[0]?.token
      expect(token).toBeTypeOf('string')
      const manual = live.readRemaining(token)
      expect(writes).toHaveLength(2)
      expect(JSON.stringify(writes[1])).toContain('The answer is in the thread.')
      say({ id: writes[1]!.id, result: {} })
      await manual
      await expect(live.readRemaining(token)).rejects.toThrow()
    } finally {
      live.disconnect('done')
      client.close()
      vi.useRealTimers()
    }
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
