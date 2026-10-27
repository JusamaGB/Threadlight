import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageStore } from '../src/main/messaging/store'
import {
  MessageCoordinator,
  type DeliveryCapability,
  type DesktopDelivery,
} from '../src/main/messaging/coordinator'
import { ComposerDraftController } from '../src/shared/composerDraft'
import type { MessageOperation } from '../src/shared/messaging'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'threadlight-message-test-'))
  directories.push(dir)
  const file = join(dir, 'recovery.json')
  const store = new MessageStore(file)
  await store.load()
  let capability: DeliveryCapability = { epoch: 'connection-a', state: 'idle', queue: true }
  const delivery: DesktopDelivery = {
    capability: vi.fn(async () => capability),
    submit: vi.fn(async () => ({ kind: 'accepted' as const, turnId: 'synthetic-turn' })),
  }
  const coordinator = new MessageCoordinator(store, delivery)
  const input = {
    id: randomUUID(),
    target: 'synthetic-install:codex:chat-a',
    text: 'Synthetic message',
    intent: 'send' as const,
  }
  return {
    file,
    store,
    delivery,
    coordinator,
    input,
    setCapability: (value: Partial<DeliveryCapability>) => {
      capability = { ...capability, ...value }
    },
  }
}

describe('durable message coordination', () => {
  it('persists intent before dispatch and deduplicates simultaneous calls', async () => {
    const f = await fixture()
    vi.mocked(f.delivery.submit).mockImplementation(async (op) => {
      const saved = JSON.parse(await readFile(f.file, 'utf8'))
      expect(saved.operations[op.id].phase).toBe('submitting')
      return { kind: 'accepted', turnId: 'synthetic-turn' }
    })
    const results = await Promise.all([
      f.coordinator.submit(f.input),
      f.coordinator.submit(f.input),
    ])
    expect(results.map((op) => op.phase)).toEqual(['accepted', 'accepted'])
    expect(f.delivery.submit).toHaveBeenCalledTimes(1)
    await expect(f.coordinator.submit({ ...f.input, text: 'Different input' })).rejects.toThrow(
      'another message',
    )
    await expect(f.coordinator.submit({ ...f.input, id: randomUUID() })).rejects.toThrow(
      'previous message',
    )
    await f.coordinator.complete(f.input.target, 'wrong-epoch', 'synthetic-turn')
    expect(f.store.list()[0]?.phase).toBe('accepted')
    await f.coordinator.complete(f.input.target, 'connection-a', 'synthetic-turn')
    expect(f.store.list()[0]?.phase).toBe('completed')
  })

  it('queues locally, allows editing, and submits once on a verified idle transition', async () => {
    const f = await fixture()
    f.setCapability({ state: 'working' })
    const op = await f.coordinator.submit({ ...f.input, intent: 'queue' })
    expect(op.phase).toBe('queued')
    expect(f.delivery.submit).not.toHaveBeenCalled()
    await f.coordinator.edit(op.id, 'Edited synthetic message')
    await f.coordinator.refresh()
    expect(f.delivery.submit).not.toHaveBeenCalled()
    f.setCapability({ state: 'idle' })
    await Promise.all([f.coordinator.refresh(), f.coordinator.refresh()])
    expect(f.delivery.submit).toHaveBeenCalledTimes(1)
    expect(f.store.list()[0]).toMatchObject({ phase: 'accepted', text: 'Edited synthetic message' })
    await expect(f.coordinator.cancel(op.id)).rejects.toThrow('already')
  })

  it('holds queues after restart or connection changes and never automatically resumes them', async () => {
    const f = await fixture()
    f.setCapability({ state: 'working' })
    await f.coordinator.submit({ ...f.input, intent: 'queue' })
    const recovered = new MessageStore(f.file)
    await recovered.load()
    const coordinator = new MessageCoordinator(recovered, f.delivery)
    f.setCapability({ state: 'idle', epoch: 'connection-b' })
    await coordinator.refresh()
    expect(recovered.list()[0]?.phase).toBe('held')
    expect(f.delivery.submit).not.toHaveBeenCalled()
    await coordinator.resume(f.input.id)
    expect(f.delivery.submit).toHaveBeenCalledTimes(1)
    expect(recovered.list()[0]?.epoch).toBe('connection-b')
  })

  it('cancelled queue never reaches the provider', async () => {
    const f = await fixture()
    f.setCapability({ state: 'working' })
    await f.coordinator.submit({ ...f.input, intent: 'queue' })
    await f.coordinator.cancel(f.input.id)
    f.setCapability({ state: 'idle' })
    await f.coordinator.refresh()
    expect(f.delivery.submit).not.toHaveBeenCalled()
  })

  it('holds a message when the pre-dispatch read disconnects without attempting a write', async () => {
    const f = await fixture()
    vi.mocked(f.delivery.capability)
      .mockResolvedValueOnce({ epoch: 'a', state: 'idle', queue: true })
      .mockRejectedValueOnce(new Error('Disconnected'))
    expect((await f.coordinator.submit(f.input)).phase).toBe('held')
    expect(f.delivery.submit).not.toHaveBeenCalled()
  })

  it('reconciles only authoritative identifier evidence without resending', async () => {
    const f = await fixture()
    vi.mocked(f.delivery.submit).mockRejectedValue(new Error('Acknowledgement lost'))
    await f.coordinator.submit(f.input)
    f.delivery.reconcile = vi.fn(async () => null)
    expect((await f.coordinator.reconcile(f.input.id)).phase).toBe('unknown')
    f.delivery.reconcile = vi.fn(async () => ({
      phase: 'completed' as const,
      turnId: 'recovered-turn',
      epoch: 'b',
    }))
    expect((await f.coordinator.reconcile(f.input.id)).phase).toBe('completed')
    expect(f.delivery.submit).toHaveBeenCalledTimes(1)
  })

  it('retains uncertain delivery across restart and refuses an identical new automatic attempt', async () => {
    const f = await fixture()
    vi.mocked(f.delivery.submit).mockRejectedValue(new Error('socket closed'))
    expect((await f.coordinator.submit(f.input)).phase).toBe('unknown')
    const recovered = new MessageStore(f.file)
    await recovered.load()
    expect(recovered.list()[0]).toMatchObject({ phase: 'unknown', text: f.input.text })
    await f.coordinator.refresh()
    await expect(f.coordinator.submit({ ...f.input, id: randomUUID() })).rejects.toThrow(
      'previous message',
    )
    expect(f.delivery.submit).toHaveBeenCalledTimes(1)
  })

  it('recovers a crash after possible dispatch as unknown; accepted work stays accepted', async () => {
    const f = await fixture()
    await f.store.put({
      ...f.input,
      epoch: 'connection-a',
      phase: 'submitting',
      updatedAt: Date.now(),
    })
    const accepted: MessageOperation = {
      ...f.input,
      id: randomUUID(),
      target: 'other-chat',
      epoch: 'connection-a',
      phase: 'accepted',
      turnId: 'turn-b',
      updatedAt: Date.now(),
    }
    await f.store.put(accepted)
    const recovered = new MessageStore(f.file)
    await recovered.load()
    expect(recovered.list().map((op) => op.phase)).toEqual(['unknown', 'accepted'])
  })

  it('keeps execution failure distinct from submission rejection', async () => {
    const f = await fixture()
    await f.coordinator.submit(f.input)
    await f.coordinator.complete(
      f.input.target,
      'connection-a',
      'synthetic-turn',
      'Synthetic execution failure',
    )
    expect(f.store.list()[0]?.phase).toBe('failed')
    vi.mocked(f.delivery.submit).mockResolvedValue({ kind: 'rejected', reason: 'Busy race' })
    const other = await f.coordinator.submit({ ...f.input, id: randomUUID() })
    expect(other.phase).toBe('rejected')
  })

  it('holds input if desktop state changes between validation and dispatch', async () => {
    const f = await fixture()
    vi.mocked(f.delivery.capability)
      .mockResolvedValueOnce({ epoch: 'a', state: 'idle', queue: true })
      .mockResolvedValueOnce({ epoch: 'a', state: 'working', queue: true })
    expect((await f.coordinator.submit(f.input)).phase).toBe('held')
    expect(f.delivery.submit).not.toHaveBeenCalled()
  })

  it('does not persist or send unsupported, waiting or unqueueable work', async () => {
    const f = await fixture()
    for (const state of ['unavailable', 'waiting', 'working'] as const) {
      f.setCapability({ state, queue: false })
      await expect(f.coordinator.submit({ ...f.input, intent: 'queue' })).rejects.toThrow()
    }
    expect(f.store.list()).toEqual([])
    expect(f.delivery.submit).not.toHaveBeenCalled()
  })
})

describe('draft storage and real renderer controller', () => {
  it('uses revision checks to prevent stale saves and isolates destinations', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([
      f.store.saveDraft('installation-a:chat', 'First', 0),
      f.store.saveDraft('installation-a:chat', 'Stale', 0),
      f.store.saveDraft('installation-b:chat', 'Other installation', 0),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    const recovered = new MessageStore(f.file)
    await recovered.load()
    expect(recovered.draft('installation-a:chat').text).toBe('First')
    expect(recovered.draft('installation-b:chat').text).toBe('Other installation')
  })

  it('refuses to overwrite unknown schemas or corrupt recovery data', async () => {
    const f = await fixture()
    const content = '{"version":99,"valuableDraft":"retain"}'
    await writeFile(f.file, content)
    const store = new MessageStore(f.file)
    await expect(store.load()).rejects.toThrow()
    await expect(store.saveDraft('chat', 'replacement', 0)).rejects.toThrow('unavailable')
    expect(await readFile(f.file, 'utf8')).toBe(content)
  })

  it('restores text, serializes rapid edits and does not duplicate initial dictation on remount', async () => {
    const f = await fixture()
    await f.store.saveDraft('chat', 'Saved text', 0)
    const api = {
      getComposerDraft: async (id: string) => ({ ok: true as const, draft: f.store.draft(id) }),
      saveComposerDraft: async (id: string, text: string, revision: number) => ({
        ok: true as const,
        draft: await f.store.saveDraft(id, text, revision),
      }),
    }
    const controller = new ComposerDraftController('chat', api)
    controller.start('Dictated text')
    await controller.flush()
    expect(controller.state.text).toBe('Saved text\nDictated text')
    expect(controller.state.reviewRequired).toBe(true)
    controller.set('Rapid edit one')
    controller.set('Rapid edit two')
    controller.start('Dictated text')
    await controller.flush()
    expect(f.store.draft('chat').text).toBe('Rapid edit two')
    const reopened = new ComposerDraftController('chat', api)
    reopened.start('')
    await reopened.flush()
    expect(reopened.state.text).toBe('Rapid edit two')
  })

  it('keeps unsaved text and prevents submission on a storage error', async () => {
    const controller = new ComposerDraftController('chat', {
      getComposerDraft: async () => ({ ok: true, draft: { text: '', revision: 0, updatedAt: 0 } }),
      saveComposerDraft: async () => {
        throw new Error('Disk full')
      },
    })
    controller.start('')
    await controller.flush()
    controller.set('Keep this text')
    await expect(controller.flush()).rejects.toThrow('not saved')
    expect(controller.state.text).toBe('Keep this text')
  })

  it('retains transcription arriving before the saved draft finishes loading', async () => {
    const f = await fixture()
    await f.store.saveDraft('chat', 'Prior draft', 0)
    const controller = new ComposerDraftController('chat', {
      getComposerDraft: async () => ({ ok: true, draft: f.store.draft('chat') }),
      saveComposerDraft: async (id, text, revision) => ({
        ok: true,
        draft: await f.store.saveDraft(id, text, revision),
      }),
    })
    controller.start('')
    controller.set((text) => `${text} plus dictation`)
    await controller.flush()
    expect(f.store.draft('chat').text).toBe('Prior draft plus dictation')
  })
})
