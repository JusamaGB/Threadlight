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
import { QuestionObserver } from '../src/main/codex/questionObserver'
import { questionId } from '../src/main/codex/questionLifecycle'
import { attentionThreads } from '../src/shared/attentionMotion'
import { IgnoredInput } from '../src/main/ignoredInput'
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

function trackerWith(
  hooks = new CodexHolds(() => {}),
  observer?: QuestionObserver,
  ignored?: IgnoredInput,
) {
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
  return new CodexTracker(
    paths,
    hooks,
    undefined,
    undefined,
    undefined,
    observer,
    (id, ref) => !!ignored?.isQuestionDismissed(id, ref),
  )
}

it('exposes the exact native question identity through the real tracker', async () => {
  const tracker = trackerWith()
  expect((await tracker.snapshot()).sessions[0]?.attention).toMatchObject({
    kind: 'question',
    nativeCodex: ref,
  })
  db.exec("UPDATE thread_turns SET status='completed'")
  expect((await tracker.snapshot()).sessions[0]?.attention).toBeNull()
})

it('reads saved answers beyond the preview page and scopes cancellation to its original turn', async () => {
  const tracker = trackerWith()
  const text = readNativeAnswer(history, id, ref, ['Blue', 'Details'])
  const replies = JSON.parse(text.split('\n')[1]!)
  add(
    {
      type: 'userMessage',
      content: [
        {
          type: 'text',
          text: `<send_user_message_question_reply>${JSON.stringify(replies[0])}</send_user_message_question_reply>`,
        },
      ],
    },
    3,
  )
  for (let i = 0; i < 205; i++) add({ type: 'reasoning', id: 'step-' + i }, 10 + i)
  expect((await tracker.snapshot()).sessions[0]?.attention).toMatchObject({
    questions: [{ question: 'Any details?' }],
  })
  add({ type: 'userMessage', content: [{ type: 'text', text }] }, 222)
  add({ type: 'agentMessage', phase: 'final_answer', text: 'Would you like another example?' }, 223)
  expect(attentionThreads((await tracker.snapshot()).sessions)).toEqual([])
  db.exec("UPDATE thread_turns SET status='interrupted'")
  expect(attentionThreads((await tracker.snapshot()).sessions)).toEqual([])
  db.prepare("INSERT INTO thread_turns VALUES (?,?,2,'inProgress',2,NULL)").run(
    id,
    '33333333-3333-4333-8333-333333333333',
  )
  expect(attentionThreads((await tracker.snapshot()).sessions)).toEqual([])
})

it('keeps another pending item available when the newer native card is dismissed', async () => {
  const ignored = new IgnoredInput(),
    tracker = trackerWith(undefined, undefined, ignored)
  add({ ...question, id: 'newer' }, 2)
  const newest = (await tracker.snapshot()).sessions[0]!
  const a = newest.attention
  if (a?.kind !== 'question' || !a.nativeCodex) throw Error('Missing question')
  expect(a.nativeCodex.itemId).toBe('newer')
  expect(ignored.dismiss(newest, a.nativeCodex)).toBe(true)
  const next = ignored.annotate(await tracker.snapshot())
  expect(attentionThreads(next.sessions)[0]?.attention).toMatchObject({ nativeCodex: ref })
  expect(readNativeAnswer(history, id, ref, ['Green', 'Quiet'])).toContain(ref.itemId)
})

it('follows only exact accepted voice/desktop receipts and releases a stale waiting hook', async () => {
  let receive!: (state: Record<string, unknown>) => void
  const stop = vi.fn(),
    changed = vi.fn()
  const observer = new QuestionObserver(changed, (_id, cb) => {
    receive = cb
    return stop
  })
  const hooks = new CodexHolds(() => {})
  hooks.event({
    session_id: id,
    turn_id: ref.turnId,
    hook_event_name: 'PreToolUse',
    tool_name: 'request_user_input_async',
  })
  const tracker = trackerWith(hooks, observer)
  const scan = async () => (await tracker.snapshot()).sessions[0]!
  const initial = (await scan()).attention
  expect(initial).toMatchObject({ nativeCodex: ref })
  const receipt = (index: number, itemId = ref.itemId) => ({
    questionItemId: questionId(itemId, index),
    question: question.questions[index]!.title,
    answer: 'Green',
  })
  const steer = (replies: unknown, status: string) => ({
    type: 'steeringUserMessage',
    status,
    input: [
      {
        type: 'text',
        text:
          '# Files mentioned by the user:\n\n## My request:\n<send_user_message_question_reply>' +
          JSON.stringify(replies) +
          '</send_user_message_question_reply>',
      },
    ],
  })
  const emit = (...items: object[]) =>
    receive({ turns: [{ turnId: ref.turnId, status: 'inProgress', items: [question, ...items] }] })
  add(
    {
      type: 'userMessage',
      content: [{ type: 'text', text: '<realtime_delegation>Green</realtime_delegation>' }],
    },
    3,
  )
  emit(steer(receipt(0), 'pending'), steer(receipt(1, 'another-item'), 'accepted'))
  expect((await scan()).attention).toEqual(initial)
  emit(steer(receipt(0), 'accepted'))
  const remaining = (await scan()).attention
  expect(remaining).toMatchObject({ questions: [{ question: 'Any details?' }] })
  if (remaining?.kind !== 'question' || !remaining.nativeCodex) throw Error('Missing revised card')
  expect(
    readNativeAnswer(history, id, remaining.nativeCodex, ['Quiet'], observer.state(id, ref.turnId)),
  ).toContain(questionId(ref.itemId, 1).replaceAll('"', '\\"'))
  emit({ ...steer(receipt(1), 'pending'), steerAcknowledged: true })
  expect((await scan()).attention).toBeNull()
  expect(attentionThreads([await scan()])).toEqual([])
  add({ ...question, id: 'later-in-this-turn' }, 12)
  expect((await scan()).attention).toMatchObject({ nativeCodex: { itemId: 'later-in-this-turn' } })
  receive({ turns: [{ turnId: ref.turnId, status: 'interrupted' }] })
  expect(attentionThreads([await scan()])).toEqual([])
  hooks.event({
    session_id: id,
    turn_id: ref.turnId,
    hook_event_name: 'PermissionRequest',
    tool_name: 'Edit',
  })
  expect((await scan()).attention?.kind).toBe('approval')
  observer.close()
  expect(stop).toHaveBeenCalled()
})

it('dismisses one generation across rescan and restart, restores on undo, and rejects stale X clicks', async () => {
  const tracker = trackerWith()
  const snapshot = await tracker.snapshot(),
    row = snapshot.sessions[0]!
  const a = row.attention
  if (a?.kind !== 'question' || !a.nativeCodex) throw Error('Missing native card')
  const file = join(home, 'dismissals.json'),
    ignored = new IgnoredInput(file)
  expect(ignored.dismiss(row, a.nativeCodex)).toBe(true)
  const restored = new IgnoredInput(file)
  const scan = restored.annotate(await tracker.snapshot())
  expect(scan.sessions[0]).toMatchObject({ ignored: true, questionDismissed: true, attention: a })
  expect(attentionThreads(scan.sessions)).toEqual([])
  restored.set(row, false)
  expect(new IgnoredInput(file).annotate(snapshot).sessions[0]?.questionDismissed).toBeUndefined()
  restored.dismiss(row, a.nativeCodex)
  db.prepare('UPDATE thread_items SET item_json=? WHERE rollout_ordinal=1').run(
    JSON.stringify({ ...question, questions: [{ title: 'Revised?' }] }),
  )
  const revised = await tracker.snapshot()
  expect(restored.dismiss(revised.sessions[0]!, a.nativeCodex)).toBe(false)
  expect(attentionThreads(restored.annotate(revised).sessions)).toHaveLength(1)
  add({ ...question, id: 'another-card' }, 3)
  expect(restored.annotate(await tracker.snapshot()).sessions[0]?.ignored).toBeUndefined()
  db.exec("UPDATE thread_turns SET status='interrupted'")
  expect(attentionThreads((await tracker.snapshot()).sessions)).toEqual([])
})

it('submits exact native IDs and free text to the discovered owner without opening or queueing', async () => {
  const confirmed = vi.fn()
  const client = connection(),
    service = new NativeCodexQuestions(history, journal, async () => client, undefined, confirmed)
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
  expect(confirmed).toHaveBeenCalledWith(id, ref.turnId, [
    questionId(ref.itemId, 0),
    questionId(ref.itemId, 1),
  ])
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
          method: m.method,
          handledByClientId: 'assigned-client',
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
