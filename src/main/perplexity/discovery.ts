import { readdir } from 'node:fs/promises'
import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PerplexityChat } from '../../shared/perplexity'
import { openVerifiedPerplexityPipe } from './verifiedPipe'

const MAX_FRAME = 4 * 1024 * 1024
/** This transport deliberately has no send, approve, initialize or host-registration method. */
export class PerplexityDiscoveryRpc {
  private data = Buffer.alloc(0)
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  constructor(private readonly pipe: Duplex) {
    pipe.on('data', (chunk: Buffer) => {
      try {
        this.data = Buffer.concat([this.data, chunk])
        if (this.data.length > MAX_FRAME + 4096)
          throw new Error('Perplexity response is too large.')
        while (true) {
          const boundary = this.data.indexOf('\r\n\r\n')
          if (boundary < 0) {
            if (this.data.length > 4096) throw new Error('Invalid Perplexity frame.')
            break
          }
          const match = /^Content-Length: ([0-9]+)$/i.exec(
            this.data.subarray(0, boundary).toString('ascii'),
          )
          const size = match ? Number(match[1]) : NaN
          if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FRAME)
            throw new Error('Invalid Perplexity frame.')
          if (this.data.length < boundary + 4 + size) break
          const value = JSON.parse(this.data.subarray(boundary + 4, boundary + 4 + size).toString())
          this.data = this.data.subarray(boundary + 4 + size)
          if (value?.jsonrpc !== '2.0') throw new Error('Invalid Perplexity response.')
          const request = this.pending.get(value.id)
          if (!request) continue
          this.pending.delete(value.id)
          clearTimeout(request.timer)
          if (value.error || !Object.hasOwn(value, 'result'))
            request.reject(new Error('Perplexity rejected the discovery request.'))
          else request.resolve(value.result)
        }
      } catch {
        this.close(new Error('Perplexity sent an invalid discovery response.'))
      }
    })
    pipe.on('error', () => this.close(new Error('Perplexity desktop disconnected.')))
    pipe.on('close', () => this.close(new Error('Perplexity desktop disconnected.')))
  }
  request(method: 'server_status' | 'threads_snapshot'): Promise<unknown> {
    if (
      !['server_status', 'threads_snapshot'].includes(method) ||
      this.pipe.destroyed ||
      this.pending.size >= 2
    )
      return Promise.reject(new Error('Perplexity discovery request unavailable.'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('Perplexity discovery timed out.')), 6000)
      this.pending.set(id, { resolve, reject, timer })
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })
      this.pipe.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, (error) => {
        if (error) this.close(new Error('Perplexity discovery could not be sent.'))
      })
    })
  }
  close(error = new Error('Perplexity discovery closed.')) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
    this.pipe.destroy()
  }
}

const text = (max: number) => z.string().max(max)
const item = z.object({
  contextUuid: z.string().uuid(),
  title: text(16000),
  answerPreview: text(200000).nullish(),
  threadStatus: text(100).nullish(),
  lastQueryDatetime: text(100).nullish(),
  isArchived: z.boolean().optional(),
})
export function parseDesktopChats(value: unknown): { chats: PerplexityChat[]; hasMore: boolean } {
  const parsed = z
    .object({
      status: z.literal('ready'),
      hasListError: z.literal(false),
      hasNextPage: z.boolean(),
      items: z.array(z.unknown()).max(2000),
      pinnedItems: z.array(z.unknown()).max(2000),
    })
    .parse(value)
  const unique = new Map<string, PerplexityChat>()
  for (const raw of [...parsed.pinnedItems, ...parsed.items]) {
    const chat = item.safeParse(raw)
    if (!chat.success) throw new Error('Perplexity desktop chat format has changed.')
    const v = chat.data
    unique.set(v.contextUuid, {
      id: v.contextUuid,
      title: v.title.slice(0, 500),
      preview: (v.answerPreview ?? '').slice(0, 2000),
      status: v.threadStatus ?? 'unknown',
      updatedAt: v.lastQueryDatetime ?? null,
      archived: v.isArchived ?? false,
    })
  }
  return { chats: [...unique.values()], hasMore: parsed.hasNextPage }
}
export async function discoverPerplexity() {
  const names = (await readdir('\\\\.\\pipe\\')).filter((name) =>
    /^perplexity-rpc-[a-f0-9]{32}$/.test(name),
  )
  if (names.length !== 1)
    throw new Error(
      names.length
        ? 'Several Perplexity instances are running. Open only the intended account instance.'
        : 'Open the installed Perplexity Windows app, then refresh.',
    )
  const rpc = new PerplexityDiscoveryRpc(
    await openVerifiedPerplexityPipe(`\\\\.\\pipe\\${names[0]}`),
  )
  try {
    const status = z
      .object({ version: z.literal('26.10.3') })
      .safeParse(await rpc.request('server_status'))
    if (!status.success)
      throw new Error(
        'This Perplexity desktop version has not been validated. Computer can still be connected separately.',
      )
    return parseDesktopChats(await rpc.request('threads_snapshot'))
  } finally {
    rpc.close()
  }
}
