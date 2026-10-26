import type { Destination } from '../../shared/communication'
import type { Session } from '../../shared/types'
import type { ThreadAdapter, CatalogEntry } from '../threadRead/types'

/** Uses provider catalogues, never the visible rows as the discovery boundary. */
export class CommunicationCatalog {
  private cache = new Map<string, Pick<Session, 'id' | 'cwd' | 'model' | 'live'>>()
  cached(id: string) {
    return this.cache.get(id)
  }
  constructor(
    private adapters: ThreadAdapter[],
    private enabled: () => string[],
    private session: (id: string) => Session | undefined,
    private admitted: (id: string) => Promise<boolean> = async () => false,
    private held: (id: string) => Promise<boolean> = async () => true,
  ) {}
  async find(target?: string, query = ''): Promise<Destination[]> {
    const rows: CatalogEntry[] = []
    for (const adapter of this.adapters.filter((a) => this.enabled().includes(a.provider))) {
      if (target) {
        if ((target.startsWith('codex:') ? 'codex' : 'claude') !== adapter.provider) continue
        const row = await adapter.locate(target.replace(/^codex:/, ''))
        if (row) rows.push(row)
      } else {
        let cursor: string | undefined
        for (let page = 0; page < 10; page++) {
          const result = await adapter.catalog(cursor)
          rows.push(
            ...result.entries.filter(
              (e) => !e.archived && e.title.toLowerCase().includes(query.toLowerCase()),
            ),
          )
          if (!result.next) break
          cursor = result.next
        }
      }
    }
    return Promise.all(
      rows.slice(0, 100).map(async (row): Promise<Destination> => {
        const id = row.provider === 'codex' ? `codex:${row.nativeId}` : row.nativeId
        const observed = this.session(id)
        const admitted = !!target && !row.archived && !!row.workspace && (await this.admitted(id))
        const send = admitted && !observed?.live && !(await this.held(id))
        this.cache.set(id, {
          id,
          cwd: row.workspace ?? '',
          model: observed?.model ?? null,
          live: observed?.live ?? false,
        })
        return {
          id,
          title: row.title,
          provider: row.provider,
          hostId: 'local',
          workspace: row.workspace ?? '',
          model: observed?.model ?? undefined,
          state: send ? 'idle' : (observed?.state ?? 'unknown'),
          generation: `local:${row.provider}:${row.nativeId}`,
          send,
          queue: admitted,
          reason: send
            ? ''
            : admitted
              ? 'Chat currently has a native writer. Delivery is queued until the verified resume boundary is available.'
              : row.archived
                ? 'Archived chat. Restore it before requesting delivery.'
                : observed?.live
                  ? 'Native desktop ownership prevents ordinary sends. The inbox remains available to an enrolled participant.'
                  : 'Native wakeup has not passed the ownership gate. The message is available in the participant inbox.',
          observedAt: Date.now(),
        }
      }),
    )
  }
}
