import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CodexQueue } from '../src/main/codex/queue'
import type { CodexTransport } from '../src/main/agent/codexClient'
import { CodexRpcError } from '../src/main/agent/codexClient'

const id = '11111111-1111-4111-8111-111111111111',
  key = `codex:${id}`
let root: string, db: DatabaseSync
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'queue-test-'))
  db = new DatabaseSync(join(root, 'history'))
  db.exec('CREATE TABLE thread_items(thread_id TEXT,item_type TEXT,item_json TEXT)')
  db.exec(
    'CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,rollout_ordinal INTEGER)',
  )
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})
function fixture() {
  let entries: { id: string; clientUserMessageId: string; input: unknown[] }[] = []
  let loseReply = false
  const desktopRequest = vi.fn(async (method: string) => ({
    resultType: 'success',
    handledByClientId: 'owner',
    ...(method === 'thread-follower-steer-turn'
      ? { result: { result: { turnId: 'active-turn' } } }
      : {}),
  }))
  const request = vi.fn(async (method: string, p: Record<string, unknown> = {}) => {
    if (method === 'thread/queue/list') return { data: entries, nextCursor: null }
    if (method === 'thread/queue/add') {
      const entry = {
        id: crypto.randomUUID(),
        clientUserMessageId: String(p.clientUserMessageId),
        input: p.input as unknown[],
      }
      entries.push(entry)
      if (loseReply) throw Error('Lost response')
      return { queuedSubmission: entry }
    }
    const entry = entries.find((e) => e.id === p.queuedSubmissionId)
    if (!entry) throw Error('Already consumed')
    if (method === 'thread/queue/update') {
      entry.input = p.input as unknown[]
      return { queuedSubmission: entry }
    }
    if (method === 'thread/queue/delete') {
      entries = entries.filter((e) => e !== entry)
      return { deleted: true }
    }
    throw Error('Unexpected method')
  })
  const connect = async () => ({ request, close: vi.fn() }) as unknown as CodexTransport
  const create = () =>
    new CodexQueue(connect, join(root, 'receipts'), join(root, 'history'), async () => ({
      request: desktopRequest,
      close: vi.fn(),
    }))
  return {
    service: create(),
    create,
    request,
    desktopRequest,
    entries: () => entries,
    lose: () => {
      loseReply = true
    },
  }
}
it('queues multiple messages without resuming or starting a writer', async () => {
  const f = fixture()
  expect(await f.service.add(key, 'first')).toEqual({ ok: true })
  expect(await f.service.add(key, 'second')).toEqual({ ok: true })
  const result = await f.service.command(key, { action: 'list' })
  expect(result).toMatchObject({ ok: true, items: [{ text: 'first' }, { text: 'second' }] })
  expect(f.request.mock.calls.every(([method]) => method.startsWith('thread/queue/'))).toBe(true)
})
it('edits text without losing image inputs and removes only the selected message', async () => {
  const f = fixture()
  await f.service.add(key, 'look', [
    { id: 'image', name: 'photo.png', path: 'C:/photo.png', kind: 'image', size: 10 },
  ])
  await f.service.add(key, 'keep')
  const entry = f.entries()[0]!
  expect(
    await f.service.command(key, { action: 'edit', id: entry.id, text: 'edited' }),
  ).toMatchObject({ ok: true, items: [{ text: 'edited', images: 1 }, { text: 'keep' }] })
  expect(entry.input).toContainEqual({ type: 'localImage', path: 'C:/photo.png' })
  expect(entry.input[0]).toMatchObject({
    text: expect.stringContaining('## photo.png: C:/photo.png'),
  })
  expect(await f.service.command(key, { action: 'remove', id: entry.id })).toMatchObject({
    ok: true,
    items: [{ text: 'keep' }],
  })
})
it('reconciles lost acknowledgements after restart without adding twice', async () => {
  const f = fixture()
  f.lose()
  expect(await f.service.add(key, 'hello')).toMatchObject({ ok: false })
  expect(await f.create().add(key, 'hello')).toEqual({ ok: true })
  expect(f.request.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1)
})
it('removing an entry already consumed or removed elsewhere reconciles the stale card', async () => {
  const f = fixture()
  await f.service.add(key, 'already gone')
  const entry = f.entries().pop()!
  await f.service.add(key, 'keep')
  expect(await f.service.command(key, { action: 'remove', id: entry.id })).toMatchObject({
    ok: true,
    items: [{ text: 'keep' }],
  })
  expect(f.request.mock.calls.some(([method]) => method === 'thread/queue/delete')).toBe(false)
})
it('removal succeeds when Codex consumes the entry between listing and deleting it', async () => {
  const f = fixture()
  await f.service.add(key, 'consumed during removal')
  const entry = f.entries()[0]!
  const original = f.request.getMockImplementation()!
  f.request.mockImplementationOnce(original).mockImplementationOnce(async () => {
    f.entries().pop()
    return { deleted: false }
  })
  expect(await f.service.command(key, { action: 'remove', id: entry.id })).toEqual({
    ok: true,
    items: [],
  })
})
it('confirmed deletion clears the card without waiting for another queue read', async () => {
  const f = fixture()
  await f.service.add(key, 'remove')
  await f.service.add(key, 'keep')
  const entry = f.entries()[0]!
  const original = f.request.getMockImplementation()!
  f.request.mockClear()
  f.request
    .mockImplementationOnce(original)
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(Error('Refresh disconnected'))
  expect(await f.service.command(key, { action: 'remove', id: entry.id })).toMatchObject({
    ok: true,
    items: [{ text: 'keep' }],
  })
  expect(f.entries()).toHaveLength(1)
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    'thread/queue/list',
    'thread/queue/delete',
  ])
})
it('does not report success if deletion is unconfirmed and the entry still exists', async () => {
  const f = fixture()
  await f.service.add(key, 'keep until confirmed')
  const entry = f.entries()[0]!
  f.request
    .mockImplementationOnce(f.request.getMockImplementation()!)
    .mockResolvedValueOnce({ deleted: false })
  expect(await f.service.command(key, { action: 'remove', id: entry.id })).toMatchObject({
    ok: false,
    reason: expect.stringContaining('did not confirm removal'),
  })
  expect(f.entries()).toHaveLength(1)
})
it('reconciles consumed queue entries against exact native client IDs', async () => {
  const f = fixture()
  f.lose()
  await f.service.add(key, 'hello')
  const entry = f.entries().pop()!
  db.prepare('INSERT INTO thread_items VALUES (?,?,?)').run(
    id,
    'userMessage',
    JSON.stringify({ clientId: entry.clientUserMessageId }),
  )
  expect(await f.create().add(key, 'hello')).toEqual({ ok: true })
  expect(f.request.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1)
})
it('retains uncertain submissions instead of replaying after restart', async () => {
  const f = fixture()
  f.lose()
  await f.service.add(key, 'hello')
  f.entries().pop()
  expect(await f.create().add(key, 'hello')).toMatchObject({
    ok: false,
    reason: expect.stringContaining('unconfirmed'),
  })
  expect(f.request.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1)
})
it('does not recreate a message consumed before editing', async () => {
  const f = fixture()
  await f.service.add(key, 'hello')
  const entry = f.entries().pop()!
  expect(
    await f.service.command(key, { action: 'edit', id: entry.id, text: 'edited' }),
  ).toMatchObject({ ok: false })
  expect(f.entries()).toHaveLength(0)
})
it('steers the existing queue identity and preserves its full input', async () => {
  const f = fixture()
  db.prepare('INSERT INTO thread_turns VALUES (?,?,?,1)').run(id, 'active-turn', 'inProgress')
  await f.service.add(key, 'look', [
    { id: 'image', name: 'photo.png', path: 'C:/photo.png', kind: 'image', size: 10 },
  ])
  await f.service.add(key, 'later')
  const entry = f.entries()[0]!
  expect(await f.service.command(key, { action: 'steer', id: entry.id })).toMatchObject({
    ok: true,
    items: [{ text: 'later' }],
  })
  expect(f.desktopRequest).toHaveBeenLastCalledWith(
    'thread-follower-steer-turn',
    expect.objectContaining({
      input: entry.input,
      clientUserMessageId: entry.clientUserMessageId,
      restoreMessage: expect.objectContaining({ serverQueuedMessageId: entry.id }),
    }),
    1,
    'owner',
  )
})
it('retains uncertain steer operations across restart and reconciles without steering twice', async () => {
  const f = fixture()
  db.prepare('INSERT INTO thread_turns VALUES (?,?,?,1)').run(id, 'active-turn', 'inProgress')
  await f.service.add(key, 'look')
  const entry = f.entries()[0]!
  f.desktopRequest
    .mockResolvedValueOnce({ resultType: 'success', handledByClientId: 'owner' })
    .mockRejectedValueOnce(Error('Lost acknowledgement'))
  expect(await f.service.command(key, { action: 'steer', id: entry.id })).toMatchObject({
    ok: false,
  })
  expect(await f.create().command(key, { action: 'steer', id: entry.id })).toMatchObject({
    ok: false,
  })
  expect(f.entries()).toHaveLength(1)
  db.prepare('INSERT INTO thread_items VALUES (?,?,?)').run(
    id,
    'userMessage',
    JSON.stringify({ clientId: entry.clientUserMessageId }),
  )
  expect(await f.create().command(key, { action: 'steer', id: entry.id })).toMatchObject({
    ok: true,
    items: [],
  })
  expect(f.desktopRequest).toHaveBeenCalledTimes(2)
})
it('retains the queued message if the active turn has finished', async () => {
  const f = fixture()
  await f.service.add(key, 'later')
  expect(await f.service.command(key, { action: 'steer', id: f.entries()[0]!.id })).toMatchObject({
    ok: false,
  })
  expect(f.entries()).toHaveLength(1)
  expect(f.desktopRequest).not.toHaveBeenCalled()
})
it('rejects invalid chats and overlong messages before sending', async () => {
  const f = fixture()
  expect(await f.service.add('bad', 'hello')).toMatchObject({ ok: false })
  expect(await f.service.add(key, 'x'.repeat(16001))).toMatchObject({ ok: false })
  expect(f.request).not.toHaveBeenCalled()
})
it('allows correction after an explicit invalid-input rejection', async () => {
  const f = fixture()
  f.request.mockRejectedValueOnce(new CodexRpcError('Invalid attachment', -32600))
  expect(await f.service.add(key, 'bad attachment')).toMatchObject({ ok: false })
  expect(await f.create().add(key, 'corrected')).toEqual({ ok: true })
  expect(f.entries()).toHaveLength(1)
})
