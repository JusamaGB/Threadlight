import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const recordSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(['claude', 'codex']),
  providerId: z.string().min(1),
  model: z.string().nullable(),
  reasoning: z.string().nullable(),
  worker: z.enum(['opus', 'sonnet']).optional(),
  appsOff: z.array(z.string()),
  title: z.string(),
  createdAt: z.number().optional(),
  at: z.number(),
  archiveState: z.enum(['pending', 'archived']).optional(),
  // The native history API currently omits realtime timeline items. Keep completed voice text.
  liveItems: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(['you', 'agent', 'step']),
        text: z.string().max(32_000),
      }),
    )
    .max(2000)
    .optional(),
  pending: z.object({ id: z.string(), text: z.string().max(32_000), at: z.number() }).nullable(),
})
export type AgentRecord = z.infer<typeof recordSchema>

/** Provider metadata plus completed voice text not exposed by the native history API. */
export class AgentStore {
  private records = new Map<string, AgentRecord>()
  private loaded: Promise<void> | null = null
  private writes: Promise<void> = Promise.resolve()
  constructor(private file: string) {}
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      let text: string
      try {
        text = await readFile(this.file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      if (text.length > 16 * 1024 * 1024) throw new Error('Agent history index is too large.')
      const data = z
        .object({ version: z.literal(1), conversations: z.array(recordSchema) })
        .parse(JSON.parse(text))
      this.records = new Map(data.conversations.map((r) => [r.id, r]))
    })())
  }
  all(): AgentRecord[] {
    return [...this.records.values()].map((r) => structuredClone(r)).sort((a, b) => b.at - a.at)
  }
  get(id: string): AgentRecord | undefined {
    const value = this.records.get(id)
    return value && structuredClone(value)
  }
  owns(provider: string, id: string): boolean {
    return this.all().some((r) => r.provider === provider && r.providerId === id)
  }
  async flush(): Promise<void> {
    await this.load()
    await this.writes
  }
  async put(record: AgentRecord): Promise<void> {
    await this.load()
    const checked = recordSchema.parse(record)
    const save = this.writes
      .catch(() => {})
      .then(async () => {
        const next = new Map(this.records)
        next.set(checked.id, checked)
        await mkdir(dirname(this.file), { recursive: true })
        const temporary = `${this.file}.${randomUUID()}.tmp`
        const encoded = JSON.stringify({ version: 1, conversations: [...next.values()] })
        if (encoded.length > 16 * 1024 * 1024) throw new Error('Agent history index is full.')
        await writeFile(temporary, encoded, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, this.file)
        this.records = next
      })
    this.writes = save
    return save
  }
}
