import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer, connect } from 'node:net'
import { NativeCodexQuestions, readNativeAnswer } from '../src/main/codex/nativeQuestions'
import {
  initializeDesktopConnection,
  type DesktopConnection,
} from '../src/main/codex/desktopConnection'
import { CodexTracker } from '../src/main/codex/tracker'
import { CodexHolds } from '../src/main/codex/holds'
import { codexPaths } from '../src/main/sessions/paths'

const id = '11111111-1111-4111-8111-111111111111'
const ref = { turnId: '22222222-2222-4222-8222-222222222222', itemId: 'call_native' }
let home: string, history: string, journal: string, db: DatabaseSync
const question = {
  type: 'agentMessage',
  id: ref.itemId,
  delivery: 'async',
  questions: [
    { title: 'Choose a colour', options: ['Blue', 'Green'] },
    { title: 'Any details?', options: [] },
  ],
}
function add(item: object, ordinal = 2) {
  db.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?,?)').run(
    id,
    ref.turnId,
    ordinal,
    JSON.stringify(item),
    (item as { type: string }).type,
    1,
    2,
  )
}
function connection(onSteer?: () => Promise<Record<string, unknown>>): DesktopConnection {
  return {
    close: vi.fn(),
    request: vi.fn(async (method) =>
      method === 'thread-owner-discovery'
        ? { resultType: 'success', handledByClientId: 'owner' }
        : onSteer
          ? onSteer()
          : {
              resultType: 'success',
              handledByClientId: 'owner',
              result: { result: { turnId: ref.turnId } },
            },
    ),
  }
}
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'threadlight-native-cards-'))
  history = join(home, 'thread_history_1.sqlite')
  journal = join(home, 'receipts')
  db = new DatabaseSync(history)
  db.exec(
    'CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER); CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT,started_at_ms INTEGER,completed_at_ms INTEGER)',
  )
  db.prepare("INSERT INTO thread_turns VALUES (?,?,1,'inProgress',1,NULL)").run(id, ref.turnId)
  add(question, 1)
})
afterEach(() => {
  db.close()
  rmSync(home, { recursive: true, force: true })
})

it('exposes the exact native question identity through the real tracker', async () => {
  const paths = codexPaths({ CODEX_HOME: home }, home)
  mkdirSync(paths.sessions)
  const rollout = join(paths.sessions, 'test.jsonl')
  writeFileSync(rollout, '{}\n')
  const state = new DatabaseSync(paths.state)
  state.exec(
    'CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,archived INTEGER,updated_at INTEGER,rollout_path TEXT)',
  )
  state
    .prepare('INSERT INTO threads VALUES (?,?,?,0,?,?)')
    .run(id, home, 'Native card', Date.now() / 1000, rollout)
  state.close()
  const tracker = new CodexTracker(paths, new CodexHolds(() => {}))
  expect((await tracker.snapshot()).sessions[0]?.attention).toMatchObject({
    kind: 'question',
    nativeCodex: ref,
  })
  db.exec("UPDATE thread_turns SET status='completed'")
  expect((await tracker.snapshot()).sessions[0]?.attention).toBeNull()
})

it('submits exact native IDs and free text to the discovered owner without opening or queueing', async () => {
  const client = connection(),
    service = new NativeCodexQuestions(history, journal, async () => client)
  expect(await service.answer(`codex:${id}`, ref, ['Green', 'Keep it quiet.'])).toEqual({
    ok: true,
  })
  const call = vi.mocked(client.request).mock.calls[1]!
  expect(call[0]).toBe('thread-follower-steer-turn')
  expect(call[3]).toBe('owner')
  const input = call[1].input as { text: string }[]
  const replies = JSON.parse(input[0]!.text.split('\n')[1]!)
  expect(replies).toEqual([
    {
      questionItemId: JSON.stringify(['request_user_input_async', ref.itemId, 0]),
      question: 'Choose a colour',
      answer: 'Green',
    },
    {
      questionItemId: JSON.stringify(['request_user_input_async', ref.itemId, 1]),
      question: 'Any details?',
      answer: 'Keep it quiet.',
    },
  ])
  expect(client.close).toHaveBeenCalled()
  expect(
    (
      await new NativeCodexQuestions(history, journal, async () => client).answer(
        `codex:${id}`,
        ref,
        ['Green', 'Again'],
      )
    ).ok,
  ).toBe(false)
  expect(client.request).toHaveBeenCalledTimes(2)
})

it.each(['completed', 'failed', 'interrupted'])(
  'rejects a %s card before connecting',
  async (status) => {
    db.prepare('UPDATE thread_turns SET status=?').run(status)
    const connect = vi.fn(async () => connection())
    expect(
      (
        await new NativeCodexQuestions(history, journal, connect).answer(`codex:${id}`, ref, [
          'Blue',
          'Details',
        ])
      ).ok,
    ).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  },
)

it('revalidates expiry after owner discovery and releases an unsent claim', async () => {
  const client = connection()
  vi.mocked(client.request).mockImplementation(async () => {
    db.exec("UPDATE thread_turns SET status='completed'")
    return { resultType: 'success', handledByClientId: 'owner' }
  })
  expect(
    (
      await new NativeCodexQuestions(history, journal, async () => client).answer(
        `codex:${id}`,
        ref,
        ['Blue', 'Details'],
      )
    ).ok,
  ).toBe(false)
  expect(client.request).toHaveBeenCalledTimes(1)
  expect(readdirSync(journal)).toEqual([])
})

it('rejects changed cards and replies already accepted in Codex', () => {
  expect(() =>
    readNativeAnswer(history, id, { ...ref, itemId: 'wrong' }, ['Blue', 'Details']),
  ).toThrow('changed')
  expect(() => readNativeAnswer(history, id, ref, ['Blue'])).toThrow('each question')
  const text = readNativeAnswer(history, id, ref, ['Blue', 'Details'])
  add({ type: 'userMessage', content: [{ type: 'text', text }] })
  expect(() => readNativeAnswer(history, id, ref, ['Blue', 'Details'])).toThrow(
    'already been answered',
  )
})

it('blocks duplicate clicks and retains uncertain submissions across a service restart', async () => {
  let finish!: () => void
  const wait = new Promise<void>((resolve) => {
    finish = resolve
  })
  const client = connection(async () => {
    await wait
    throw Error('disconnected')
  })
  const service = new NativeCodexQuestions(history, journal, async () => client)
  const first = service.answer(`codex:${id}`, ref, ['Blue', 'Details'])
  expect((await service.answer(`codex:${id}`, ref, ['Green', 'Duplicate'])).ok).toBe(false)
  finish()
  expect(await first).toMatchObject({ ok: false, retryable: false })
  expect(
    await new NativeCodexQuestions(history, journal, async () => client).answer(
      `codex:${id}`,
      ref,
      ['Green', 'Retry'],
    ),
  ).toMatchObject({ ok: false, retryable: false })
  expect(client.request).toHaveBeenCalledTimes(2)
})

it('does not call a response for a different turn a successful answer', async () => {
  const client = connection(async () => ({
    resultType: 'success',
    handledByClientId: 'owner',
    result: { result: { turnId: 'different' } },
  }))
  expect(
    await new NativeCodexQuestions(history, journal, async () => client).answer(
      `codex:${id}`,
      ref,
      ['Blue', 'Details'],
    ),
  ).toMatchObject({ ok: false, retryable: false })
})

it('permits reconnecting after a definite connection failure without recording a send', async () => {
  const service = new NativeCodexQuestions(history, journal, async () => {
    throw Error('Offline')
  })
  expect(await service.answer(`codex:${id}`, ref, ['Blue', 'Details'])).toMatchObject({
    ok: false,
    retryable: true,
  })
  expect(
    await new NativeCodexQuestions(history, journal, async () => connection()).answer(
      `codex:${id}`,
      ref,
      ['Blue', 'Details'],
    ),
  ).toEqual({ ok: true })
})

it('handles fragmented native frames and registers only as Threadlight', async () => {
  const frame = (value: object) => {
    const body = Buffer.from(JSON.stringify(value)),
      header = Buffer.alloc(4)
    header.writeUInt32LE(body.length)
    return Buffer.concat([header, body])
  }
  const received: Record<string, unknown>[] = []
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const length = buffer.readUInt32LE(0),
          m = JSON.parse(buffer.subarray(4, 4 + length).toString())
        buffer = buffer.subarray(4 + length)
        received.push(m)
        const response = frame({
          type: 'response',
          requestId: m.requestId,
          resultType: 'success',
          result: m.method === 'initialize' ? { clientId: 'assigned-client' } : { ok: true },
        })
        socket.write(response.subarray(0, 2))
        setImmediate(() => socket.write(response.subarray(2)))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const client = await initializeDesktopConnection(connect(address.port, '127.0.0.1'))
  try {
    expect(
      await client.request('thread-owner-discovery', { hostId: 'local', conversationId: id }, 1),
    ).toMatchObject({ resultType: 'success' })
    expect(received[0]!.params).toEqual({ clientType: 'threadlight' })
    expect(received[1]!.sourceClientId).toBe('assigned-client')
  } finally {
    client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
