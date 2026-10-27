import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentItem } from '../../shared/agent'
import { isObject } from '../sessions/json'
import { z } from 'zod'

const excerpt = z
  .object({ text: z.string().max(6000), role: z.string(), truncated: z.boolean().optional() })
  .passthrough()
  .nullable()
const candidate = z
  .object({
    threadRef: z.string(),
    title: z.string(),
    provider: z.enum(['claude', 'codex']),
    workspace: z.string().nullable(),
  })
  .passthrough()
const result = z
  .object({
    outcome: z.string(),
    coverage: z.array(z.string()),
    sources: z.array(
      z
        .object({
          source: z.string(),
          health: z.string(),
          checkedAt: z.number().nullable(),
          reason: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough()
const savedItem = z.object({
  id: z.string().optional(),
  kind: z.literal('step'),
  text: z.string().max(1000),
  source: z.object({
    callId: z.string(),
    tool: z.string(),
    at: z.number(),
    correlation: z.literal('local_runtime_call'),
    result: z.union([
      result.extend({
        thread: candidate,
        status: z.object({ state: z.string(), basis: z.string() }).passthrough(),
        currentRequest: excerpt,
        latestProgress: excerpt,
        latestCompletedReply: excerpt,
        plan: excerpt.optional(),
        attention: excerpt.optional(),
        backgroundTasks: z.array(excerpt).optional(),
      }),
      result.extend({ candidates: z.array(candidate) }),
    ]),
  }),
})

/** Separate bounded journal avoids racing native pending-send and archive metadata writes. */
export class ThreadEvidenceStore {
  private loaded: Promise<void> | undefined
  private writes: Promise<void> = Promise.resolve()
  private entries: Record<string, AgentItem[]> = {}
  constructor(private path: string) {}
  private load() {
    return (this.loaded ??= (async () => {
      try {
        const text = await readFile(this.path, 'utf8')
        if (text.length > 12 * 1024 * 1024) throw new Error('Evidence journal too large.')
        const data: unknown = JSON.parse(text)
        if (!isObject(data)) throw new Error('Invalid evidence journal.')
        for (const [key, items] of Object.entries(data)) {
          if (!Array.isArray(items)) continue
          // Validate every rendered field. Remaining provenance is retained as inert JSON;
          // restored references never authorize a read in a new runtime scope.
          this.entries[key] = items.slice(-100).flatMap((i) => {
            const parsed = savedItem.safeParse(i)
            return parsed.success ? [parsed.data as unknown as AgentItem] : []
          })
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })())
  }
  async read(id: string) {
    await this.load()
    await this.writes
    return structuredClone(this.entries[id] ?? [])
  }
  save(id: string, items: AgentItem[]) {
    const sources = items.filter((i) => i.source).slice(-100)
    const save = this.writes
      .catch(() => {})
      .then(async () => {
        await this.load()
        const next = { ...this.entries, [id]: sources }
        const keys = Object.keys(next)
        while (keys.length > 100) delete next[keys.shift()!]
        let text = JSON.stringify(next)
        const oldest = Object.keys(next)
          .filter((key) => key !== id)
          .sort((a, b) => (next[a]?.at(-1)?.source?.at ?? 0) - (next[b]?.at(-1)?.source?.at ?? 0))
        while (text.length > 12 * 1024 * 1024 && oldest.length) {
          delete next[oldest.shift()!]
          text = JSON.stringify(next)
        }
        if (text.length > 12 * 1024 * 1024) throw new Error('Evidence journal full.')
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(`${this.path}.tmp`, text, { mode: 0o600 })
        await rename(`${this.path}.tmp`, this.path)
        this.entries = next
      })
    this.writes = save
    return save
  }
}
