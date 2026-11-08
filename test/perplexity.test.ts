import { describe, it, expect, vi } from 'vitest'
import { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDesktopChats, PerplexityDiscoveryRpc } from '../src/main/perplexity/discovery'
import { checkPerplexityIdentity } from '../src/main/perplexity/verifiedPipe'
import { validCallback, trustedPerplexityUrl, COMPUTER_URL } from '../src/main/perplexity/computer'
import { computerResult, PerplexityService } from '../src/main/perplexity/service'
import { PerplexityVault } from '../src/main/perplexity/vault'
import type { ComputerConnection } from '../src/main/perplexity/computer'

const id = randomUUID()
describe('Perplexity encrypted persistence', () => {
  it('serializes revisions, recovers pending receipts, and clears only credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'threadlight-perplexity-vault-'))
    // Substitute the OS encryption boundary; live proof separately exercises DPAPI.
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')),
      decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString(),
    }
    try {
      const vault = new PerplexityVault(directory, encryption)
      await vault.load()
      vault.value.tokens = { access_token: 'synthetic-secret-token', token_type: 'Bearer' }
      vault.value.threads = [{ id, title: 'Task' }]
      const first = vault.save()
      vault.value.operations.push({ id: randomUUID(), state: 'pending' })
      await Promise.all([first, vault.save()])
      expect((await readFile(join(directory, 'connection.bin'))).toString()).not.toContain(
        'synthetic-secret-token',
      )
      const restored = new PerplexityVault(directory, encryption)
      await restored.load()
      expect(restored.value.operations[0]?.state).toBe('uncertain')
      await restored.clearCredentials()
      const disconnected = new PerplexityVault(directory, encryption)
      await disconnected.load()
      expect(disconnected.value.tokens).toBeUndefined()
      expect(disconnected.value.threads).toEqual([{ id, title: 'Task' }])
      expect(disconnected.value.operations).toHaveLength(1)
      const before = await readFile(join(directory, 'connection.bin'))
      encryption.isEncryptionAvailable = () => false
      await expect(disconnected.save()).rejects.toThrow('Encrypted storage')
      expect(await readFile(join(directory, 'connection.bin'))).toEqual(before)
      await expect(disconnected.load()).rejects.toThrow('encrypted credential storage')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
const desktop = () => ({
  status: 'ready',
  hasListError: false,
  hasNextPage: false,
  pinnedItems: [],
  items: [
    {
      contextUuid: id,
      title: 'Research',
      answerPreview: 'Preview',
      threadStatus: 'idle',
      readWriteToken: 'MUST NOT LEAK',
    },
  ],
})
describe('Perplexity desktop boundary', () => {
  it('projects only safe display fields and deduplicates pinned chats', () => {
    const value = desktop()
    const result = parseDesktopChats({ ...value, pinnedItems: value.items })
    expect(result.chats).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('MUST NOT LEAK')
    expect(Object.keys(result.chats[0]!)).toEqual([
      'id',
      'title',
      'preview',
      'status',
      'updatedAt',
      'archived',
    ])
  })
  it('does not describe failed or incompatible reads as an empty list', () => {
    expect(() => parseDesktopChats({ ...desktop(), hasListError: true })).toThrow()
    expect(() => parseDesktopChats({ ...desktop(), items: [{ title: 'Missing ID' }] })).toThrow()
  })
  it('checks package, executable and logon independently', () => {
    const identity = {
      family: 'PerplexityAI.PerplexityApp_3jh4kjrg4dzr2',
      root: 'C:\\Program Files\\WindowsApps\\package',
      executable:
        'C:\\Program Files\\WindowsApps\\package\\app\\resources\\native\\bin\\perplexity.exe',
      sameLogon: true,
    }
    expect(() => checkPerplexityIdentity(identity)).not.toThrow()
    for (const patch of [
      { sameLogon: false },
      { family: 'fake' },
      { executable: 'C:\\temp\\perplexity.exe' },
    ])
      expect(() => checkPerplexityIdentity({ ...identity, ...patch })).toThrow()
  })
  it('handles fragmented frames and never exposes write methods', async () => {
    let frame = ''
    const pipe = new Duplex({
      read() {},
      write(data, _encoding, done) {
        frame += data
        done()
      },
    })
    const rpc = new PerplexityDiscoveryRpc(pipe)
    const pending = rpc.request('threads_snapshot')
    const request = JSON.parse(frame.split('\r\n\r\n')[1]!)
    const body = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: desktop() })
    const reply = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    pipe.push(reply.subarray(0, 20))
    pipe.push(reply.subarray(20))
    expect(await pending).toEqual(desktop())
    await expect(rpc.request('session_ask' as 'server_status')).rejects.toThrow()
    rpc.close()
  })
  it('fails pending requests on oversized framing and disconnect', async () => {
    const pipe = new Duplex({
      read() {},
      write(_data, _encoding, done) {
        done()
      },
    })
    const rpc = new PerplexityDiscoveryRpc(pipe)
    const request = rpc.request('threads_snapshot')
    pipe.push(Buffer.from('Content-Length: 999999999\r\n\r\n'))
    await expect(request).rejects.toThrow('invalid discovery response')
    expect(pipe.destroyed).toBe(true)
  })
})
describe('Perplexity OAuth boundaries', () => {
  const state = 'a'.repeat(64),
    redirect = 'http://127.0.0.1:49123/oauth/callback'
  it('requires state, exact loopback Host and provider issuer', () => {
    const url = `/oauth/callback?code=private&state=${state}&iss=${encodeURIComponent(COMPUTER_URL)}`
    expect(validCallback(url, '127.0.0.1:49123', redirect, state)).toBe(true)
    expect(validCallback(url, 'evil.example', redirect, state)).toBe(false)
    expect(
      validCallback(url.replace(state, 'b'.repeat(64)), '127.0.0.1:49123', redirect, state),
    ).toBe(false)
    expect(
      validCallback(
        url.replace(encodeURIComponent(COMPUTER_URL), 'https://evil.example'),
        '127.0.0.1:49123',
        redirect,
        state,
      ),
    ).toBe(false)
    expect(
      validCallback('/oauth/callback?state=' + '💥'.repeat(32), '127.0.0.1:49123', redirect, state),
    ).toBe(false)
  })
  it('refuses redirected or credential-bearing endpoints', () => {
    expect(trustedPerplexityUrl(COMPUTER_URL).origin).toBe('https://www.perplexity.ai')
    for (const url of [
      'http://www.perplexity.ai/',
      'https://www.perplexity.ai.evil.test/',
      'https://user:secret@www.perplexity.ai/',
      'file:///secret',
    ])
      expect(() => trustedPerplexityUrl(url)).toThrow()
  })
})

const receipt = (data: Record<string, unknown> = {}) => ({
  structuredContent: {
    thread_id: id,
    text: 'Reply',
    event: 'complete',
    task_status: 'completed',
    ...data,
  },
})
function fixture(call = vi.fn<ComputerConnection['call']>().mockResolvedValue(receipt())) {
  const vault = {
    value: {
      threads: [] as { id: string; title: string }[],
      operations: [] as { id: string; state: 'pending' | 'done' | 'uncertain' }[],
    },
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    clearCredentials: vi.fn().mockResolvedValue(undefined),
  } as unknown as PerplexityVault
  const connection = {
    connect: vi.fn().mockResolvedValue(['read_thread', 'call_perplexity_computer', 'cancel_task']),
    call,
    close: vi.fn().mockResolvedValue(undefined),
  }
  const open = vi.fn().mockResolvedValue(undefined)
  const service = new PerplexityService({
    vault,
    connection: () => connection,
    discover: vi.fn().mockResolvedValue(parseDesktopChats(desktop())),
    open,
    changed: vi.fn(),
  })
  return { service, vault, connection, open }
}
async function connect(service: PerplexityService) {
  await service.request({ action: 'connect' })
  await vi.waitFor(() => expect(service.snapshot().computer.state).toBe('connected'))
}
describe('Perplexity Computer receipts and service', () => {
  const creditRejection = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          event: 'insufficient_credits',
          text: 'To use Computer, add credits to your account or upgrade your plan.',
          interactive: { type: 'insufficient_credits', reason: 'free_turns_exhausted' },
        }),
      },
    ],
    isError: false,
  }
  it('recognizes the live credit rejection without inventing a task or uncertain delivery', async () => {
    const { service, vault, connection } = fixture(
      vi.fn<ComputerConnection['call']>().mockResolvedValue(creditRejection),
    )
    await connect(service)
    const result = await service.request({
      action: 'send',
      message: 'Test',
      operationId: randomUUID(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('No message was sent')
    expect(result.snapshot.uncertainSend).toBe(false)
    expect(result.snapshot.computerThreads).toEqual([])
    expect(vault.value.operations[0]?.state).toBe('done')
    expect(connection.call).toHaveBeenCalledTimes(1)
    // An in-task credit event must keep its receipt and request attention instead.
    expect(
      computerResult(receipt({ event: 'insufficient_credits', task_status: 'input_required' }))
        .thread?.needsInput,
    ).toBe(true)
    expect(
      computerResult({ content: [{ type: 'text', text: '{"event":"error"}' }] }).rejection,
    ).toBeUndefined()
  })
  it('keeps a provider failure as a failed send even with a valid task receipt', async () => {
    const { service } = fixture(
      vi
        .fn<ComputerConnection['call']>()
        .mockResolvedValue(receipt({ event: 'error', task_status: 'failed' })),
    )
    await connect(service)
    const result = await service.request({
      action: 'send',
      message: 'Test',
      operationId: randomUUID(),
    })
    expect(result.ok).toBe(false)
    expect(result.snapshot.thread?.status).toBe('failed')
    expect(result.snapshot.uncertainSend).toBe(false)
  })
  it('does not disconnect a task in flight or treat an opaque MCP ID as a public URL', async () => {
    let finish!: (value: unknown) => void
    const { service, connection, open } = fixture(
      vi.fn<ComputerConnection['call']>().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
    )
    await connect(service)
    const sending = service.request({ action: 'send', message: 'Test', operationId: randomUUID() })
    await vi.waitFor(() => expect(connection.call).toHaveBeenCalledOnce())
    expect((await service.request({ action: 'disconnect' })).ok).toBe(false)
    finish(receipt())
    await sending
    await service.request({ action: 'open', threadId: id })
    expect(open).toHaveBeenCalledWith('https://www.perplexity.ai/computer')
  })
  it('distinguishes tool completion, unknown status, and task completion', () => {
    expect(computerResult(receipt({ task_status: undefined })).thread?.status).toBe('unknown')
    expect(
      computerResult(receipt({ task_status: 'working', event: 'timeout' })).thread?.status,
    ).toBe('working')
    expect(
      computerResult(receipt({ event: 'confirm_action', task_status: 'input_required' })).thread
        ?.needsInput,
    ).toBe(true)
    expect(computerResult({ content: [{ type: 'text', text: 'I finished!' }] }).thread).toBe(null)
  })
  it('does not connect or send while discovering desktop chats', async () => {
    const { service, connection } = fixture()
    const result = await service.request({ action: 'discover' })
    expect(result.snapshot.desktop.chats).toHaveLength(1)
    expect(connection.connect).not.toHaveBeenCalled()
    expect(connection.call).not.toHaveBeenCalled()
  })
  it('records a send before network I/O, deduplicates, and reads without sending', async () => {
    const { service, vault, connection } = fixture()
    await connect(service)
    const command = { action: 'send', message: 'Test', operationId: randomUUID() }
    expect((await service.request(command)).ok).toBe(true)
    expect(vault.save).toHaveBeenCalled()
    expect(vi.mocked(vault.save).mock.invocationCallOrder[0]).toBeLessThan(
      connection.call.mock.invocationCallOrder[0]!,
    )
    expect((await service.request(command)).ok).toBe(false)
    expect(connection.call).toHaveBeenCalledTimes(1)
    await service.request({ action: 'read', threadId: id })
    expect(connection.call.mock.calls[1]?.[0]).toBe('read_thread')
  })
  it('preserves uncertain sends and requires explicit reconciliation', async () => {
    const call = vi.fn<ComputerConnection['call']>().mockRejectedValue(new Error('socket lost'))
    const { service, vault } = fixture(call)
    await connect(service)
    const reply = await service.request({
      action: 'send',
      message: 'Test',
      operationId: randomUUID(),
    })
    expect(reply.ok).toBe(false)
    expect(service.snapshot().uncertainSend).toBe(true)
    expect(vault.value.operations[0]?.state).toBe('uncertain')
    await service.request({ action: 'send', message: 'Test again', operationId: randomUUID() })
    expect(call).toHaveBeenCalledTimes(1)
    await service.request({ action: 'reconcile' })
    expect(service.snapshot().uncertainSend).toBe(false)
  })
  it('refuses arbitrary tools, URLs and unknown thread IDs', async () => {
    const { service, connection, open } = fixture()
    await connect(service)
    expect((await service.request({ action: 'call', name: 'confirm_action_approve' })).ok).toBe(
      false,
    )
    expect((await service.request({ action: 'open', threadId: id })).ok).toBe(false)
    expect((await service.request({ action: 'read', threadId: id })).ok).toBe(false)
    expect(connection.call).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
  it('refuses a reply retargeted to another thread', async () => {
    const { service, connection } = fixture()
    await connect(service)
    await service.request({ action: 'send', message: 'Test', operationId: randomUUID() })
    connection.call.mockResolvedValue(receipt({ thread_id: randomUUID() }))
    expect((await service.request({ action: 'read', threadId: id })).ok).toBe(false)
    expect(service.snapshot().thread?.id).toBe(id)
  })
  it('does not send after a receipt persistence failure', async () => {
    const { service, vault, connection } = fixture()
    await connect(service)
    vi.mocked(vault.save).mockRejectedValueOnce(new Error('disk full'))
    expect(
      (await service.request({ action: 'send', message: 'Test', operationId: randomUUID() })).ok,
    ).toBe(false)
    expect(connection.call).not.toHaveBeenCalled()
  })
})
