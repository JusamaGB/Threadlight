import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir, symlink } from 'node:fs/promises'
import { exportDestination } from '../src/main/memory/backup'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore, type MemoryActor } from '../src/main/memory/store'
import { MemoryServer } from '../src/main/memory/server'
import { MemoryDispatcher } from '../src/main/memory/dispatcher'
import type {
  MemoryFolder,
  MemoryInput,
  MemoryItem,
  MemorySpace,
  MemoryTask,
  MemoryDeliveryContext,
} from '../src/shared/memory'
import type { RelayStatus, Session } from '../src/shared/types'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox, store: MemoryStore, space: MemorySpace, folder: MemoryFolder
const execute = <T>(input: MemoryInput, actor: MemoryActor = {}) =>
  store.execute({ ...input, operationId: input.operationId ?? randomUUID() }, actor) as T
const createFolder = (title: string, parentId: string | null = null) =>
  execute<{ folder: MemoryFolder }>({
    action: 'ensure_folder',
    spaceId: space.id,
    parentId,
    title,
    description: 'Evidence and working notes',
    reason: 'Test scope',
  }).folder
const note = (title = 'Evidence', folderId = folder.id) =>
  execute<MemoryItem>({ action: 'create_item', folderId, title, body: 'Original evidence.' })
const grant = (options: Partial<MemoryInput> = {}) =>
  execute<{ id: string; token: string }>({
    action: 'create_grant',
    spaceId: space.id,
    title: 'Codex test',
    readOnly: false,
    createFolders: true,
    assignee: 'codex:test',
    ...options,
  })
const assignment = (assignee = 'codex:test', inputs: MemoryTask['inputs'] = []) =>
  execute<MemoryTask>({
    action: 'create_task',
    title: 'Review evidence',
    body: `Review for ${assignee}`,
    folderId: folder.id,
    assignee,
    inputs,
  })
beforeEach(async () => {
  box = await sandbox()
  store = new MemoryStore(join(box.root, 'memory.sqlite'))
  space = execute<MemorySpace>({ action: 'create_space', title: 'Product' })
  folder = createFolder('Research')
})
afterEach(async () => {
  store.close()
  await box.cleanup()
})

describe('shared memory authority', () => {
  it('revokes derived task credentials and allows reorganisation after the parent grant is revoked', () => {
    const destination = createFolder('Destination'),
      parent = grant({ folderId: folder.id }),
      task = assignment()
    const token = store.prepareDelivery(task.id)
    expect(store.authenticate(token).taskId).toBe(task.id)
    execute({ action: 'revoke_grant', id: parent.id })
    expect(() => store.authenticate(token)).toThrow('revoked')
    expect(
      execute<MemoryFolder>({
        action: 'update_folder',
        id: folder.id,
        parentId: destination.id,
        expectedRevision: 1,
      }).parentId,
    ).toBe(destination.id)
  })
  it('refuses exporting through a junction back into private application data', async () => {
    const privateDir = join(box.root, 'private'),
      alias = join(box.root, 'alias')
    await mkdir(privateDir)
    await symlink(privateDir, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(exportDestination(join(alias, 'memory.sqlite'), privateDir)).rejects.toThrow(
      'outside',
    )
    expect(await exportDestination(join(box.root, 'portable.sqlite'), privateDir)).toBe(
      join(box.root, 'portable.sqlite'),
    )
  })
  it('restores versioned material atomically, revokes capabilities and rejects corrupt archives', async () => {
    const item = note(),
      credentials = grant(),
      file = join(box.root, 'backup.sqlite')
    execute({ action: 'revise_item', id: item.id, expectedRevision: 1, body: 'Version two' })
    execute({ action: 'update_space', id: space.id, paused: false, durationMinutes: 30 })
    await backup(store.databaseForBackup(), file)
    execute({ action: 'purge_item', id: item.id })
    store.restoreFrom(file)
    expect(store.read({}, item.id, 1).revision.body).toBe('Original evidence.')
    expect(store.read({}, item.id, 2).revision.body).toBe('Version two')
    expect(store.space(space.id).paused).toBe(true)
    expect(() => store.authenticate(credentials.token)).toThrow('capability')
    const damaged = new DatabaseSync(file)
    damaged
      .prepare("UPDATE records SET data=json_set(data,'$.body','tampered') WHERE kind='revision'")
      .run()
    damaged.close()
    expect(() => store.restoreFrom(file)).toThrow('damaged')
    expect(store.read({}, item.id, 2).revision.body).toBe('Version two')
  })
  it('serialises independent database clients and keeps duplicate folder creation singular', () => {
    const second = new MemoryStore(store.file)
    try {
      const first = createFolder('Concurrent')
      const next = second.execute({
        action: 'ensure_folder',
        operationId: randomUUID(),
        spaceId: space.id,
        title: 'concurrent',
        description: 'Other writer',
        reason: 'Race',
      }) as { folder: MemoryFolder }
      expect(next.folder.id).toBe(first.id)
      const item = note()
      execute({ action: 'revise_item', id: item.id, expectedRevision: 1, body: 'First wins' })
      expect(() =>
        second.execute({
          action: 'revise_item',
          operationId: randomUUID(),
          id: item.id,
          expectedRevision: 1,
          body: 'Stale writer',
        }),
      ).toThrow('changed')
    } finally {
      second.close()
    }
  })
  it('reuses normalised siblings and keeps IDs through renames', () => {
    expect(createFolder('  RESEARCH  ').id).toBe(folder.id)
    const renamed = execute<MemoryFolder>({
      action: 'update_folder',
      id: folder.id,
      expectedRevision: 1,
      title: 'Discovery',
    })
    expect(renamed.id).toBe(folder.id)
    expect(() =>
      execute({ action: 'update_folder', id: folder.id, expectedRevision: 1, title: 'Stale' }),
    ).toThrow('changed')
    expect(() => createFolder('../escape')).toThrow('path')
  })
  it('preserves independent revisions and rejects a stale writer', () => {
    const item = note(),
      operationId = randomUUID()
    const input: MemoryInput = {
      action: 'revise_item',
      id: item.id,
      expectedRevision: 1,
      body: 'New evidence',
      operationId,
    }
    execute(input)
    expect(execute<MemoryItem>(input).revision).toBe(2)
    expect(() => execute({ ...input, operationId: randomUUID() })).toThrow('changed')
    expect(store.read({}, item.id, 1).revision.body).toBe('Original evidence.')
    expect(store.read({}, item.id, 2).revision.body).toBe('New evidence')
    execute({ action: 'accept_item', id: item.id, revision: 1 })
    expect(store.read({}, item.id).item.acceptedRevision).toBe(1)
  })
  it('enforces subtree capabilities on reads, search, writes and task messages', () => {
    const privateFolder = createFolder('Private'),
      secret = note('Secret', privateFolder.id),
      publicItem = note()
    const credentials = grant({ folderId: folder.id }),
      actor = store.authenticate(credentials.token)
    expect(store.snapshot(actor).items.map((i) => i.id)).toEqual([publicItem.id])
    expect(() => store.read(actor, secret.id)).toThrow('capability')
    expect(() =>
      execute(
        { action: 'create_item', folderId: privateFolder.id, title: 'Wrong', body: 'x' },
        actor,
      ),
    ).toThrow('capability')
    expect(() =>
      execute(
        {
          action: 'ensure_folder',
          spaceId: space.id,
          parentId: null,
          title: 'Escape',
          description: 'x',
          reason: 'x',
        },
        actor,
      ),
    ).toThrow('capability')
    expect(() => execute({ action: 'accept_item', id: publicItem.id, revision: 1 }, actor)).toThrow(
      'human',
    )
    const task = execute<MemoryTask>({
      action: 'create_task',
      folderId: privateFolder.id,
      title: 'Secret task',
      body: 'Private',
      assignee: 'other',
    })
    expect(() =>
      execute({ action: 'post_message', spaceId: space.id, targetId: task.id, body: 'x' }, actor),
    ).toThrow('capability')
    execute({ action: 'revoke_grant', id: credentials.id })
    expect(() => store.snapshot(actor)).toThrow('revoked')
  })
  it('does not leak grant secrets into snapshots or retry receipts', () => {
    const operationId = randomUUID(),
      input: MemoryInput = { action: 'create_grant', spaceId: space.id, title: 'Once', operationId }
    const result = execute<{ token: string }>(input)
    expect(JSON.stringify(store.snapshot())).not.toContain(result.token)
    expect(execute(input)).toMatchObject({ secretUnavailable: true })
  })
  it('keeps purge idempotency tombstones and visible broken task references', () => {
    const operationId = randomUUID(),
      input: MemoryInput = {
        action: 'create_item',
        folderId: folder.id,
        title: 'Sensitive',
        body: 'Private text',
        operationId,
      }
    const item = execute<MemoryItem>(input),
      task = assignment('codex:test', [{ itemId: item.id, revision: 1 }])
    execute({ action: 'purge_item', id: item.id })
    expect(execute(input)).toEqual({ purged: true })
    expect(store.snapshot().items).toHaveLength(0)
    expect(store.snapshot().tasks.find((t) => t.id === task.id)?.state).toBe('blocked')
  })
  it('protects nesting, cycles and scoped permissions when reorganising folders', () => {
    let deepest = folder
    for (let n = 0; n < 5; n++) deepest = createFolder(`Level ${n}`, deepest.id)
    expect(() => createFolder('Too deep', deepest.id)).toThrow('six')
    const other = createFolder('Other')
    expect(() =>
      execute({ action: 'update_folder', id: folder.id, parentId: other.id, expectedRevision: 1 }),
    ).toThrow('six')
    expect(() =>
      execute({
        action: 'update_folder',
        id: folder.id,
        parentId: deepest.id,
        expectedRevision: 1,
      }),
    ).toThrow('itself')
    grant({ folderId: other.id })
    expect(() => execute({ action: 'merge_folder', id: other.id, targetId: folder.id })).toThrow(
      'Revoke',
    )
  })
  it('commits despite a disconnected UI and preserves managed binary data', () => {
    store.onChange = () => {
      throw new Error('renderer disappeared')
    }
    const item = store.importAttachment(
      folder.id,
      'diagram.png',
      'image/png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
    expect(store.read({}, item.id).dataUrl).toContain(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
    )
    expect(store.snapshot().items).toHaveLength(1)
  })
  it('recovers interrupted work without replaying it', () => {
    const task = assignment()
    store.updateDelivery(task.id, { state: 'dispatching' })
    store.close()
    store = new MemoryStore(join(box.root, 'memory.sqlite'))
    expect(store.tasks()[0]?.state).toBe('unknown')
    expect(() => execute({ action: 'authorize_task', id: task.id })).toThrow('unsent')
    expect(() => execute({ action: 'pause_task', id: task.id })).toThrow('native chat')
  })
})

describe('authenticated MCP', () => {
  it('shares exact versions, rejects browser origins and applies revocation immediately', async () => {
    const server = new MemoryServer(store),
      url = await server.start(0),
      credentials = grant(),
      item = note()
    const rpc = (method: string, params: unknown = {}, headers: Record<string, string> = {}) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${credentials.token}`,
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    try {
      expect((await rpc('initialize')).status).toBe(200)
      expect((await rpc('initialize', {}, { Origin: 'https://evil.example' })).status).toBe(403)
      expect((await rpc('initialize', {}, { Authorization: credentials.token })).status).toBe(401)
      const read = (await (
        await rpc('tools/call', { name: 'memory_read', arguments: { id: item.id, revision: 1 } })
      ).json()) as { result: { content: { text: string }[] } }
      expect(JSON.parse(read.result.content[0]!.text).revision.body).toBe('Original evidence.')
      const result = (await (
        await rpc('tools/call', { name: 'memory_accept_item', arguments: { id: item.id } })
      ).json()) as { error: unknown }
      expect(result.error).toBeDefined()
      execute({ action: 'revoke_grant', id: credentials.id })
      expect((await rpc('tools/list')).status).toBe(401)
    } finally {
      server.close()
    }
  })
})

describe('durable coordination', () => {
  it('keeps delivery occupied after early submission and persists receipts before the next composer send', () => {
    const task = assignment(),
      output = note('Early result')
    store.updateDelivery(task.id, { state: 'dispatching' })
    execute({
      action: 'submit_result',
      id: task.id,
      outputIds: [output.id],
      body: 'Structured result',
    })
    expect(store.tasks()[0]?.deliveryState).toBe('dispatching')
    let receipt: ((status: RelayStatus) => void) | undefined
    const dispatcher = new MemoryDispatcher(
      store,
      {
        find: () => undefined,
        statuses: () => [],
        send: () => ({ ok: true }),
        watch: (listener) => {
          receipt = listener
          return () => {
            receipt = undefined
          }
        },
      },
      () => null,
    )
    receipt!({
      sessionId: task.assignee,
      attemptId: task.id,
      state: 'replied',
      detail: 'Native final reply',
      at: Date.now(),
    })
    expect(store.tasks()[0]).toMatchObject({
      state: 'submitted',
      deliveryState: 'completed',
      reply: 'Structured result',
      nativeReply: 'Native final reply',
    })
    dispatcher.tick()
    expect(store.tasks()[0]?.deliveryState).toBe('completed')
    dispatcher.close()
  })
  it('retains an unknown delivery slot when a crash follows early result submission', () => {
    const task = assignment(),
      output = note('Early result')
    store.updateDelivery(task.id, { state: 'dispatching' })
    execute({ action: 'submit_result', id: task.id, outputIds: [output.id] })
    store.close()
    store = new MemoryStore(join(box.root, 'memory.sqlite'))
    expect(store.tasks()[0]).toMatchObject({ state: 'submitted', deliveryState: 'unknown' })
    execute({
      action: 'reconcile_task',
      id: task.id,
      delivered: true,
      reason: 'The native turn finished.',
    })
    expect(store.tasks()[0]).toMatchObject({ state: 'submitted', deliveryState: 'completed' })
  })
  it('permits a deliberately pinned older revision while detecting later changes', () => {
    const item = note()
    execute({ action: 'revise_item', id: item.id, expectedRevision: 1, body: 'New proposal' })
    const task = assignment('codex:test', [{ itemId: item.id, revision: 1 }])
    execute({ action: 'update_space', id: space.id, paused: false, durationMinutes: 30 })
    execute({ action: 'authorize_task', id: task.id })
    expect(store.reserveDispatch(task.id)).toBe(true)
    expect(store.tasks()[0]?.inputs).toEqual([{ itemId: item.id, revision: 1 }])
    expect(store.tasks()[0]?.inputHeads).toEqual([{ itemId: item.id, revision: 2 }])
  })
  it('records change subscriptions without sending, bounds follow-ups, and honors pause', () => {
    execute({
      action: 'subscribe',
      folderId: folder.id,
      assignee: 'reviewer',
      title: 'Review evidence changes',
      body: 'Verify the exact source and save findings.',
    })
    note('First evidence')
    expect(store.tasks()[0]?.state).toBe('draft')
    execute({
      action: 'update_space',
      id: space.id,
      mode: 'automatic',
      paused: false,
      durationMinutes: 30,
      maxDispatches: 1,
    })
    const next = note('Second evidence')
    const queued = store.tasks().find((t) => t.inputs.some((i) => i.itemId === next.id))!
    expect(queued.state).toBe('queued')
    expect(store.reserveDispatch(queued.id)).toBe(true)
    const third = note('Third evidence'),
      limited = store.tasks().find((t) => t.inputs.some((i) => i.itemId === third.id))!
    expect(store.reserveDispatch(limited.id)).toBe(false)
    expect(store.tasks().find((t) => t.id === limited.id)?.state).toBe('paused')
    const sub = store.snapshot().subscriptions[0]!
    execute({ action: 'unsubscribe', id: sub.id })
    note('Ignored change')
    expect(store.tasks()).toHaveLength(3)
  })
  it('pins submitted output versions and does not accept purged output', () => {
    const task = assignment()
    store.updateDelivery(task.id, { state: 'completed' })
    const output = note('Result')
    execute({ action: 'submit_result', id: task.id, outputIds: [output.id], body: 'Saved' })
    execute({ action: 'revise_item', id: output.id, expectedRevision: 1, body: 'Later proposal' })
    expect(store.tasks()[0]?.outputs).toEqual([{ itemId: output.id, revision: 1 }])
    execute({ action: 'purge_item', id: output.id })
    expect(() => execute({ action: 'resolve_task', id: task.id })).toThrow('unavailable')
  })
  const enable = () =>
    execute({
      action: 'update_space',
      id: space.id,
      paused: false,
      durationMinutes: 30,
      maxDispatches: 10,
      mode: 'automatic',
    })
  it('waits for live chats, sends at most two, correlates receipts and prevents unknown retries', () => {
    const statuses: RelayStatus[] = [],
      sent: MemoryDeliveryContext[] = []
    let live = true
    const dispatcher = new MemoryDispatcher(
      store,
      {
        find: () => ({ live, state: 'idle' }) as Session,
        statuses: () => statuses,
        send: (id, _text, context) => {
          sent.push(context!)
          statuses.push({
            sessionId: id,
            state: 'sending',
            at: Date.now(),
            detail: '',
            attemptId: context!.attemptId,
          })
          return { ok: true }
        },
      },
      () => 'http://127.0.0.1:1234/mcp',
    )
    const tasks = ['a', 'b', 'c'].map((id) => {
      grant({ assignee: id })
      const task = assignment(id)
      execute({ action: 'authorize_task', id: task.id })
      return task
    })
    enable()
    dispatcher.tick()
    expect(sent).toHaveLength(0)
    live = false
    dispatcher.tick()
    expect(sent).toHaveLength(2)
    const first = statuses[0]!
    first.state = 'failed'
    first.detail = 'Outcome unknown'
    dispatcher.tick()
    expect(store.tasks().find((t) => t.id === tasks[0]!.id)?.state).toBe('unknown')
    expect(sent).toHaveLength(2)
    execute({
      action: 'reconcile_task',
      id: tasks[0]!.id,
      reason: 'Verified in the disposable native chat.',
      delivered: false,
    })
    dispatcher.tick()
    expect(sent).toHaveLength(3)
    dispatcher.tick()
    expect(sent).toHaveLength(3)
    const actor = store.authenticate(sent[0]!.token)
    expect(actor.taskId).toBe(tasks[0]!.id)
  })
  it('blocks missing enrollment and changed inputs, and prevents circular delegation', () => {
    const item = note(),
      task = assignment('a', [{ itemId: item.id, revision: 1 }])
    enable()
    execute({ action: 'authorize_task', id: task.id })
    execute({ action: 'revise_item', id: item.id, expectedRevision: 1, body: 'Changed' })
    expect(store.reserveDispatch(task.id)).toBe(false)
    expect(() =>
      execute({
        action: 'create_task',
        folderId: folder.id,
        title: 'Loop',
        body: 'Loop',
        assignee: 'a',
        originTaskId: task.id,
      }),
    ).toThrow('recipient')
    expect(() => store.prepareDelivery(task.id)).toThrow('Enroll')
  })
  it('accepts saved outputs only from the assigned enrollment and keeps human acceptance separate', () => {
    const task = assignment(),
      other = grant({ assignee: 'wrong' }),
      correct = grant()
    store.updateDelivery(task.id, { state: 'completed' })
    const result = note('Result')
    const submission: MemoryInput = {
      action: 'submit_result',
      id: task.id,
      outputIds: [result.id],
      body: 'Evidence saved',
    }
    expect(() => execute(submission, store.authenticate(other.token))).toThrow('assigned')
    execute(submission, store.authenticate(correct.token))
    expect(store.tasks()[0]?.state).toBe('submitted')
    execute({ action: 'resolve_task', id: task.id })
    expect(store.tasks()[0]?.state).toBe('resolved')
  })
})
