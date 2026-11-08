import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { chatSource } from '../../shared/accountChats'

const receipt = z.object({
  source: chatSource,
  id: z.string().uuid(),
  operationId: z.string().uuid(),
  digest: z.string().length(64).optional(),
  state: z.enum(['pending', 'accepted', 'checked']),
})
type Receipt = z.infer<typeof receipt>
/** Persist intent before sending. No prompt text, provider tokens or automatic retry. */
export class ChatDelivery {
  private receipts: Receipt[] = []
  private loaded = false
  private loading?: Promise<void>
  private queue: Promise<void> = Promise.resolve()
  constructor(private file?: string) {}
  async load() {
    if (this.loaded) return
    return (this.loading ??= this.read())
  }
  private async read() {
    if (this.file) {
      try {
        this.receipts = z
          .array(receipt)
          .max(10000)
          .parse(JSON.parse(await readFile(this.file, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('Chat delivery record unavailable. Sending is paused.', { cause: error })
      }
    }
    this.loaded = true
  }
  uncertain(source: Receipt['source'], id: string) {
    return this.receipts.some((r) => r.source === source && r.id === id && r.state === 'pending')
  }
  find(operationId: string) {
    return this.receipts.find((r) => r.operationId === operationId)
  }
  async record(value: Receipt) {
    return this.mutate(() => {
      const next = this.receipts.filter((r) => r.operationId !== value.operationId)
      if (next.length >= 10000) throw new Error('Chat delivery record is full. Sending is paused.')
      next.push(value)
      return next
    })
  }
  async confirm(source: Receipt['source'], id: string) {
    await this.mutate(() =>
      this.receipts.map((r) =>
        r.source === source && r.id === id && r.state === 'pending'
          ? { ...r, state: 'checked' }
          : r,
      ),
    )
  }
  private mutate(next: () => Receipt[]) {
    const result = this.queue.then(() => this.save(next()))
    this.queue = result.catch(() => {})
    return result
  }
  private async save(next: Receipt[]) {
    // Update memory first so a failed disk write still blocks an unsafe retry.
    this.receipts = next
    if (!this.file) return
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(next), { flag: 'wx' })
    await rename(temporary, this.file)
  }
}
