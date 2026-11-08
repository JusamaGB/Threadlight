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
    private runtime?: (
      id: string,
    ) => Promise<
      Pick<Destination, 'send' | 'queue' | 'generation' | 'reason' | 'transport'> | undefined
    >,
  ) {}
  async find(target?: string, query = ''): Promise<Destination[]> {
    const rows: CatalogEntry[] = []
    for (const adapter of this.adapters.filter((a) => this.enabled().includes(a.provider))) {
      if (target) {
        if ((target.startsWith('codex:') ? 'codex' : 'claude') !== adapter.provider) continue
        const nativeId = target.replace(/^codex:/, '')
        let row = await adapter.locate(nativeId)
        if (!row && adapter.provider === 'claude') {
          // Claude indexes exact targets during catalog discovery.
          let cursor: string | undefined
          for (let page = 0; page < 10; page++) {
            const result = await adapter.catalog(cursor)
            if (result.entries.some((entry) => entry.nativeId === nativeId)) {
              row = await adapter.locate(nativeId)
              break
            }
            if (!result.next) break
            cursor = result.next
          }
        }
        if (row) rows.push(row)
      } else {
        const matches: CatalogEntry[] = []
        let cursor: string | undefined
        for (let page = 0; page < 10; page++) {
          const result = await adapter.catalog(cursor)
          matches.push(
            ...result.entries.filter(
              (e) => e.archived !== true && e.title.toLowerCase().includes(query.toLowerCase()),
            ),
          )
          if (!result.next || matches.length >= 100) break
          cursor = result.next
        }
        // Bound each provider independently so a large earlier catalogue cannot
        // hide every chat belonging to another enabled provider.
        rows.push(...matches.slice(0, 100))
      }
    }
    return Promise.all(
      rows.map(async (row): Promise<Destination> => {
        const id = row.provider === 'codex' ? `codex:${row.nativeId}` : row.nativeId
        const observed = this.session(id)
        const runtime =
          target && row.provider === 'claude' && row.archived !== true
            ? await this.runtime?.(id)
            : undefined
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
              : row.archived === true
                ? 'Archived chat. Restore it before requesting delivery.'
                : observed?.live
                  ? 'Native desktop ownership prevents ordinary sends. The inbox remains available to an enrolled participant.'
                  : 'Native wakeup has not passed the ownership gate. The message is available in the participant inbox.',
          observedAt: Date.now(),
          ...runtime,
        }
      }),
    )
  }
}
