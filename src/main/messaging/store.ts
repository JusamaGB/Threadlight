import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { MESSAGE_LIMIT, type ComposerDraft, type MessageOperation } from '../../shared/messaging'

const draftSchema = z.object({
  text: z.string().max(MESSAGE_LIMIT),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().finite(),
})
const operationSchema = z.object({
  id: z.string().uuid(),
  target: z.string().min(1).max(512),
  text: z.string().max(MESSAGE_LIMIT),
  intent: z.enum(['send', 'queue']),
  phase: z.enum([
    'queued',
    'held',
    'submitting',
    'accepted',
    'completed',
    'rejected',
    'failed',
    'unknown',
    'cancelled',
  ]),
  epoch: z.string().max(256),
  turnId: z.string().max(256).optional(),
  reason: z.string().max(2000).optional(),
  updatedAt: z.number().finite(),
})
const schema = z.object({
  version: z.literal(1),
  drafts: z.record(z.string().min(1).max(512), draftSchema),
  operations: z.record(z.string().uuid(), operationSchema),
})
type Data = z.infer<typeof schema>
const empty = (): Data => ({ version: 1, drafts: {}, operations: {} })
const DAY = 86_400_000

/** One serialized atomic file owned by Threadlight. Unreadable files are never overwritten. */
export class MessageStore {
  private data = empty()
  private tail: Promise<unknown> = Promise.resolve()
  private ready = false

  constructor(
    private readonly file: string,
    private readonly now = Date.now,
  ) {}

  async load(): Promise<void> {
    let data = empty()
    try {
      if ((await stat(this.file)).size > 20 * 1024 * 1024)
        throw new Error('Message recovery data is too large to load safely.')
      data = schema.parse(JSON.parse(await readFile(this.file, 'utf8')))
      for (const [id, op] of Object.entries(data.operations)) {
        if (id !== op.id) throw new Error('Invalid message recovery identity.')
        if (op.phase === 'submitting') {
          op.phase = 'unknown'
          op.reason =
            'Threadlight restarted before delivery was confirmed. Check Codex before resending.'
        } else if (op.phase === 'queued') {
          op.phase = 'held'
          op.reason = 'Resume this queued message explicitly after reconnecting.'
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.data = data
    this.ready = true
  }

  draft(target: string): ComposerDraft {
    this.requireReady()
    return structuredClone(this.data.drafts[target] ?? { text: '', revision: 0, updatedAt: 0 })
  }

  list(): MessageOperation[] {
    this.requireReady()
    return structuredClone(Object.values(this.data.operations))
  }

  saveDraft(target: string, text: string, expectedRevision: number): Promise<ComposerDraft> {
    return this.change((data) => {
      if (!target || target.length > 512 || text.length > MESSAGE_LIMIT)
        throw new Error('Invalid draft.')
      const previous = data.drafts[target]
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw new Error('This draft changed elsewhere. Reopen the composer before saving.')
      const draft = { text, revision: expectedRevision + 1, updatedAt: this.now() }
      data.drafts[target] = draft
      return draft
    })
  }

  put(operation: MessageOperation): Promise<MessageOperation> {
    return this.change((data) => {
      const value = operationSchema.parse(operation)
      data.operations[value.id] = value
      return value
    })
  }

  flush(): Promise<unknown> {
    return this.tail
  }

  private requireReady() {
    if (!this.ready)
      throw new Error('Message recovery storage is unavailable. Your text has not been saved.')
  }

  private change<T>(mutate: (data: Data) => T): Promise<T> {
    const run = this.tail.then(async () => {
      this.requireReady()
      const next = structuredClone(this.data)
      // Recovery records are retained. Only successful/cancelled text is pruned automatically.
      for (const op of Object.values(next.operations))
        if (['completed', 'cancelled'].includes(op.phase) && this.now() - op.updatedAt > DAY)
          op.text = ''
      const result = mutate(next)
      if (Object.keys(next.drafts).length + Object.keys(next.operations).length > 2000)
        throw new Error('Message recovery storage is full. Existing drafts are retained.')
      const encoded = JSON.stringify(next)
      if (Buffer.byteLength(encoded) > 20 * 1024 * 1024)
        throw new Error('Message recovery storage is full. Existing drafts are retained.')
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, encoded, { mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
      this.data = next
      return structuredClone(result)
    })
    this.tail = run.catch(() => {})
    return run
  }
}
