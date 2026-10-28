import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { NativeCodexMessages } from '../src/main/codex/nativeMessages'
import type { DesktopConnection } from '../src/main/codex/desktopConnection'

const id = '11111111-1111-4111-8111-111111111111',
  key = `codex:${id}`
const oldTurn = '22222222-2222-4222-8222-222222222222',
  newTurn = '33333333-3333-4333-8333-333333333333'
let root: string, history: string, journal: string, db: DatabaseSync
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'threadlight-native-messages-'))
  history = join(root, 'history.sqlite')
  journal = join(root, 'receipts')
  db = new DatabaseSync(history)
  db.exec(
    'CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,rollout_ordinal INTEGER); CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_type TEXT,item_json TEXT,rollout_ordinal INTEGER); CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY)',
  )
  db.prepare('INSERT INTO thread_turns VALUES (?,?,?,1)').run(id, oldTurn, 'completed')
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})
function fixture(
  reply?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  const connection: DesktopConnection = {
    close: vi.fn(),
    request: vi.fn(async (method, params) => {
      if (method === 'thread-owner-discovery')
        return { resultType: 'success', handledByClientId: 'owner' }
      if (reply) return reply(method, params)
      return {
        resultType: 'success',
        handledByClientId: 'owner',
        result: {
          result:
            method === 'thread-follower-start-turn'
              ? { turn: { id: newTurn } }
              : { turnId: oldTurn },
        },
      }
    }),
  }
  const connect = vi.fn(async () => connection)
  return {
    connection,
    connect,
    service: new NativeCodexMessages(history, journal, vi.fn(), connect),
  }
}
it('starts through the discovered desktop owner, preserving native model and permissions', async () => {
  const { service, connection } = fixture()
  expect(await service.send(key, 'Hello from Threadlight')).toEqual({ ok: true })
  expect(connection.request).toHaveBeenLastCalledWith(
    'thread-follower-start-turn',
    {
      conversationId: id,
      turnStart: {
        request: {
          threadId: id,
          input: [{ type: 'text', text: 'Hello from Threadlight', text_elements: [] }],
          clientUserMessageId: expect.any(String),
        },
        context: {
          inheritThreadSettings: true,
          restoreMessage: { text: 'Hello from Threadlight', context: {} },
        },
      },
    },
    2,
    'owner',
  )
  expect(service.list()[0]?.state).toBe('sent')
  expect(readFileSync(join(journal, readdirSync(journal)[0]!), 'utf8')).not.toContain('Hello from')
  db.prepare('INSERT INTO thread_turns VALUES (?,?,?,2)').run(id, newTurn, 'completed')
  db.prepare('INSERT INTO thread_items VALUES (?,?,?,?,1)').run(
    id,
    newTurn,
    'agentMessage',
    JSON.stringify({ text: 'Received' }),
  )
  service.refresh()
  expect(service.list()[0]).toMatchObject({ state: 'replied', detail: 'Received' })
})
it('steers a working turn instead of spawning or starting a second writer', async () => {
  db.exec("UPDATE thread_turns SET status='inProgress'")
  const { service, connection } = fixture()
  expect(await service.send(key, 'A follow-up')).toEqual({ ok: true })
  expect(connection.request).toHaveBeenLastCalledWith(
    'thread-follower-steer-turn',
    expect.objectContaining({ conversationId: id, clientUserMessageId: expect.any(String) }),
    1,
    'owner',
  )
})
it('sends the first message to a confirmed empty desktop chat', async () => {
  db.exec('DELETE FROM thread_turns')
  db.prepare('INSERT INTO thread_history_projection_state VALUES (?)').run(id)
  const { service, connection } = fixture()
  expect(await service.send(key, 'First message')).toEqual({ ok: true })
  expect(connection.request).toHaveBeenLastCalledWith(
    'thread-follower-start-turn',
    expect.objectContaining({ conversationId: id }),
    2,
    'owner',
  )
})
it('does not mistake missing history for an empty chat', async () => {
  db.exec('DELETE FROM thread_turns')
  const { service, connection } = fixture()
  expect((await service.send(key, 'First message')).ok).toBe(false)
  expect(connection.request).toHaveBeenCalledTimes(1)
  expect(service.list()).toEqual([])
})
it('retains the draft when the empty-chat projection cannot be read', async () => {
  db.exec('DELETE FROM thread_turns; DROP TABLE thread_history_projection_state')
  const { service, connection } = fixture()
  expect((await service.send(key, 'First message')).ok).toBe(false)
  expect(connection.request).toHaveBeenCalledTimes(1)
})
it('rejects invalid targets and messages before connecting', async () => {
  const { service, connect } = fixture()
  for (const [target, text] of [
    [id, 'hello'],
    [key, ' '],
    [key, 'x'.repeat(16001)],
  ])
    expect((await service.send(target!, text!)).ok).toBe(false)
  expect(connect).not.toHaveBeenCalled()
})
it('does not send when there is no desktop owner', async () => {
  const { service, connection } = fixture()
  vi.mocked(connection.request).mockResolvedValue({ resultType: 'error' })
  expect((await service.send(key, 'hello')).ok).toBe(false)
  expect(connection.request).toHaveBeenCalledTimes(1)
})
it('blocks duplicate clicks and uncertain sends across a restart', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const { service, connect } = fixture(async () => {
    await gate
    throw Error('lost acknowledgement')
  })
  const first = service.send(key, 'hello')
  expect((await service.send(key, 'hello')).ok).toBe(false)
  release()
  expect((await first).ok).toBe(false)
  const restarted = new NativeCodexMessages(history, journal, vi.fn(), connect)
  expect((await restarted.send(key, 'hello')).ok).toBe(false)
  expect(connect).toHaveBeenCalledTimes(1)
})
it('recovers a lost acknowledgement using the native client message ID without resending', async () => {
  const { service, connection } = fixture(async () => {
    throw Error('lost')
  })
  expect((await service.send(key, 'hello')).ok).toBe(false)
  const receipt = JSON.parse(readFileSync(join(journal, `${id}.json`), 'utf8'))
  db.prepare('INSERT INTO thread_items VALUES (?,?,?,?,1)').run(
    id,
    newTurn,
    'userMessage',
    JSON.stringify({ clientId: receipt.clientId }),
  )
  expect(await service.send(key, 'hello')).toEqual({ ok: true })
  expect(connection.request).toHaveBeenCalledTimes(2)
})
it('treats a wrong-owner acknowledgement as uncertain', async () => {
  const { service } = fixture(async () => ({
    resultType: 'success',
    handledByClientId: 'another-owner',
    result: { result: { turn: { id: newTurn } } },
  }))
  expect((await service.send(key, 'hello')).ok).toBe(false)
  expect((await service.send(key, 'hello')).ok).toBe(false)
})

it('sends image-only native input and document context through both idle and active owners', async () => {
  const { service, connection } = fixture()
  const image = {
    id: 'image',
    name: 'photo.png',
    size: 10,
    kind: 'image' as const,
    path: 'C:/staged/photo.png',
  }
  expect(await service.send(key, '', [image])).toEqual({ ok: true })
  const first = vi.mocked(connection.request).mock.calls.at(-1)![1] as {
    turnStart: { request: { input: unknown[] }; context: Record<string, unknown> }
  }
  expect(first.turnStart.request.input).toContainEqual({ type: 'localImage', path: image.path })
  expect(first.turnStart.context.attachments).toEqual([
    expect.objectContaining({ path: image.path, isImageAttachment: true }),
  ])
  expect(first.turnStart.context.inheritThreadSettings).toBe(true)
  db.exec("UPDATE thread_turns SET status='inProgress'")
  const doc = {
    id: 'document',
    name: 'report.pdf',
    size: 30,
    kind: 'file' as const,
    path: 'C:/staged/report.pdf',
  }
  expect(await service.send(key, 'Read this', [doc])).toEqual({ ok: true })
  const last = vi.mocked(connection.request).mock.calls.at(-1)!
  expect(last[0]).toBe('thread-follower-steer-turn')
  expect(last[1].input).toEqual([
    expect.objectContaining({ type: 'text', text: expect.stringContaining(doc.path) }),
  ])
  expect(last[1].restoreMessage).toMatchObject({
    text: 'Read this',
    context: { fileAttachments: [expect.objectContaining({ path: doc.path })] },
  })
})
it('does not deduplicate a new attachment against an acknowledged uncertain message with the same text', async () => {
  const { service, connection } = fixture(async () => {
    throw Error('lost')
  })
  const file = {
    id: 'first',
    name: 'photo.png',
    path: 'C:/staged/photo.png',
    size: 10,
    kind: 'image' as const,
  }
  expect((await service.send(key, 'Look', [file])).ok).toBe(false)
  const receipt = JSON.parse(readFileSync(join(journal, `${id}.json`), 'utf8'))
  db.prepare('INSERT INTO thread_items VALUES (?,?,?,?,1)').run(
    id,
    newTurn,
    'userMessage',
    JSON.stringify({ clientId: receipt.clientId }),
  )
  expect((await service.send(key, 'Look', [{ ...file, id: 'second' }])).ok).toBe(false)
  expect(connection.request).toHaveBeenCalledTimes(4)
})
