import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NewCodexThreads } from '../src/main/codex/newThread'

const operationId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const input = { operationId, provider: 'codex' as const, cwd: null }
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'threadlight-new-chat-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const client = {
    initialize: vi.fn(async () => {}),
    request: vi.fn(async () => ({ thread: { id } })),
    respond: vi.fn(),
    onEvent: vi.fn(),
    onFailure: vi.fn(),
    close: vi.fn(),
  }
  const deps = {
    bootstrap: vi.fn(async () => client),
    handoff: vi.fn(async () => {
      expect(client.close).toHaveBeenCalledOnce()
      return true
    }),
  }
  const restart = () => new NewCodexThreads(join(root, 'receipts'), join(root, 'chats'), deps)
  return { client, deps, restart, service: restart() }
}
it('creates a persistent empty native chat, releases its writer, then opens the desktop owner', async () => {
  const { service, client, deps } = fixture()
  expect(await service.create(input)).toEqual({ ok: true, sessionId: `codex:${id}` })
  const cwd = join(root, 'chats', operationId)
  expect(existsSync(cwd)).toBe(true)
  expect(deps.bootstrap).toHaveBeenCalledWith(cwd)
  expect(client.request.mock.calls).toEqual([
    ['thread/start', { cwd, ephemeral: false }],
    ['thread/name/set', { threadId: id, name: 'New Codex chat' }],
    ['thread/read', { threadId: id }],
  ])
  expect(deps.handoff).toHaveBeenCalledWith(id)
})
it('uses the selected workspace without adding a first message or overriding provider settings', async () => {
  const { service, client } = fixture()
  expect((await service.create({ ...input, cwd: root })).ok).toBe(true)
  expect(client.request).toHaveBeenNthCalledWith(1, 'thread/start', { cwd: root, ephemeral: false })
})
it('shares concurrent identical requests and refuses another operation while creation is pending', async () => {
  const { service, client } = fixture()
  let finish!: () => void
  client.initialize.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const first = service.create(input)
  expect(service.create(input)).toBe(first)
  expect((await service.create({ ...input, operationId: id })).ok).toBe(false)
  await vi.waitFor(() => expect(finish).toBeDefined())
  finish()
  expect((await first).ok).toBe(true)
  expect(client.request).toHaveBeenCalledTimes(3)
})
it('reopens the confirmed chat after a failed handoff and service restart without creating another', async () => {
  const { service, restart, client, deps } = fixture()
  deps.handoff.mockResolvedValueOnce(false)
  expect(await service.create(input)).toMatchObject({ ok: false, sessionId: `codex:${id}` })
  expect(await restart().create(input)).toEqual({ ok: true, sessionId: `codex:${id}` })
  expect(client.request).toHaveBeenCalledTimes(3)
  expect(deps.handoff).toHaveBeenCalledTimes(2)
})
it('never repeats an uncertain creation after a lost response or restart', async () => {
  const { service, restart, client, deps } = fixture()
  client.request.mockRejectedValueOnce(Error('Lost response'))
  expect((await service.create(input)).ok).toBe(false)
  expect((await restart().create(input)).ok).toBe(false)
  expect(client.close).toHaveBeenCalledOnce()
  expect(client.request).toHaveBeenCalledOnce()
  expect(deps.handoff).not.toHaveBeenCalled()
})
it('retains the known identity if materializing the empty native history fails', async () => {
  const { service, restart, client, deps } = fixture()
  client.request
    .mockResolvedValueOnce({ thread: { id } })
    .mockRejectedValueOnce(Error('Name failed'))
  expect(await service.create(input)).toMatchObject({ ok: false, sessionId: `codex:${id}` })
  expect(client.close).toHaveBeenCalledOnce()
  expect(deps.handoff).not.toHaveBeenCalled()
  // Recovery can ask the desktop to load the known ID but must not create a replacement.
  deps.handoff.mockResolvedValueOnce(false)
  expect(await restart().create(input)).toMatchObject({ ok: false, sessionId: `codex:${id}` })
  expect(client.request).toHaveBeenCalledTimes(2)
})
it('allows retry when initialization failed before thread/start', async () => {
  const { service, restart, client } = fixture()
  client.initialize.mockRejectedValueOnce(Error('Unavailable'))
  expect((await service.create(input)).ok).toBe(false)
  expect(client.close).toHaveBeenCalledOnce()
  expect(client.request).not.toHaveBeenCalled()
  // Both attempts close their own bootstrap writer.
  client.close.mockClear()
  expect((await restart().create(input)).ok).toBe(true)
  expect(client.request).toHaveBeenCalledTimes(3)
})
it('rejects unsupported providers, invalid operations and missing workspaces before dispatch', async () => {
  const { service, deps } = fixture()
  for (const request of [
    { ...input, provider: 'claude' as const },
    { ...input, operationId: '../bad' },
    { ...input, cwd: 'relative' },
    { ...input, cwd: join(root, 'missing') },
  ])
    expect((await service.create(request)).ok).toBe(false)
  expect(deps.bootstrap).not.toHaveBeenCalled()
})
it('does not reuse a receipt for a different selected workspace', async () => {
  const { service, restart, client } = fixture()
  expect((await service.create(input)).ok).toBe(true)
  expect((await restart().create({ ...input, cwd: root })).ok).toBe(false)
  expect(client.request).toHaveBeenCalledTimes(3)
})
