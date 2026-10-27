import { stat, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { CodexPaths } from '../sessions/paths'
import { sqliteSourceFiles } from '../sessions/paths'
import { queryDatabase } from './sqlite'
import { contained, jsonlPage } from './files'
import {
  normalize,
  normalizeRollout,
  applyTurnCompletion,
  rolloutStatus,
  timestamp,
} from './normalize'
import {
  sourceFailure,
  unknownStatus,
  type ThreadAdapter,
  type CatalogEntry,
  type HistoryCursor,
  type AdapterRead,
} from './types'
import type { ThreadStatus, ThreadVisibleItem } from '../../shared/threadRead'

export class CodexReadAdapter implements ThreadAdapter {
  readonly provider = 'codex' as const
  private catalogCache = new Map<string, { stamp: string; rows: Record<string, unknown>[] }>()
  private async metadataStamp() {
    return (
      await Promise.all(
        sqliteSourceFiles(this.paths.state).map(async (path, index) => {
          try {
            const info = await stat(path)
            return `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.size}:${info.mtimeMs}`
          } catch (error) {
            if (index === 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return 'no-wal'
            throw error
          }
        }),
      )
    ).join('|')
  }
  constructor(
    private paths: CodexPaths,
    private hook: (
      id: string,
    ) => { status: ThreadStatus; attention?: ThreadVisibleItem } | null = () => null,
  ) {}
  private async rows(after?: string, id?: string) {
    const fields = [
      'id',
      'title',
      'name',
      'cwd',
      'rollout_path',
      'archived',
      'updated_at',
      'updated_at_ms',
    ]
    return (
      (
        await queryDatabase(this.paths.state, [
          {
            sql: `SELECT $columns FROM threads ${id ? 'WHERE id=?' : after ? 'WHERE id>?' : ''} ORDER BY id LIMIT ${id ? 1 : 1000}`,
            columns: fields,
            params: id ? [id] : after ? [after] : [],
          },
        ])
      )[0] ?? []
    )
  }
  private entry(row: Record<string, unknown>): CatalogEntry {
    return {
      nativeId: String(row.id),
      provider: 'codex',
      title: String(row.name || row.title || row.id).slice(0, 500),
      titleSource: row.name || row.title ? 'explicit' : 'fallback',
      workspace: typeof row.cwd === 'string' ? row.cwd : null,
      archived: row.archived === undefined ? 'unknown' : !!row.archived,
      lastActiveAt: timestamp(row.updated_at_ms || row.updated_at),
      locator: typeof row.rollout_path === 'string' ? row.rollout_path : undefined,
    }
  }
  async catalog(cursor?: string) {
    const previous = cursor ? (JSON.parse(cursor) as { after: string; stamp: string }) : undefined
    const stamp = await this.metadataStamp(),
      cached = this.catalogCache.get(cursor ?? '')
    if (previous && previous.stamp !== stamp)
      throw new Error('Metadata changed between pages; search again.')
    const rows = cached?.stamp === stamp ? cached.rows : await this.rows(previous?.after)
    if (this.catalogCache.size >= 50)
      this.catalogCache.delete(this.catalogCache.keys().next().value!)
    this.catalogCache.set(cursor ?? '', { stamp, rows })
    if (rows.some((r) => r._budgetExceeded))
      throw new Error('Metadata page exceeded source budget.')
    return {
      entries: rows.map((r) => this.entry(r)),
      complete: rows.length < 1000,
      next:
        rows.length === 1000
          ? JSON.stringify({ after: String(rows.at(-1)!.id), stamp })
          : undefined,
      sources: [
        {
          source: 'codex_metadata',
          health: 'ok' as const,
          checkedAt: Date.now(),
          revision: String(rows.at(-1)?.id ?? 'empty'),
        },
      ],
    }
  }
  async locate(id: string) {
    const rows = await this.rows(undefined, id)
    return rows[0] ? this.entry(rows[0]) : null
  }
  private async rollout(entry: CatalogEntry) {
    if (!entry.locator) throw new Error('No registered transcript location.')
    try {
      return await contained(entry.locator, [
        this.paths.sessions,
        this.paths.archivedSessions ?? join(this.paths.home, 'archived_sessions'),
      ])
    } catch {
      // Archiving can move the file before the metadata projection catches up.
      const archived = this.paths.archivedSessions ?? join(this.paths.home, 'archived_sessions')
      const file = (await readdir(archived)).find((n) => n === basename(entry.locator!))
      if (!file) throw new Error('Registered transcript unavailable.')
      return contained(join(archived, file), [archived])
    }
  }
  async read(
    entry: CatalogEntry,
    cursor?: HistoryCursor,
    statusOnly = false,
  ): Promise<AdapterRead> {
    let items: ThreadVisibleItem[] = [],
      status = unknownStatus()
    const sources: AdapterRead['sources'] = [],
      coverage: string[] = []
    let next: HistoryCursor | undefined,
      changedDuringRead = false
    // Read the rollout boundary as well: it can be ahead of the native history projection.
    let rollout: Awaited<ReturnType<typeof jsonlPage>> | undefined
    try {
      const path = await this.rollout(entry)
      rollout = await jsonlPage(
        path,
        [
          this.paths.sessions,
          this.paths.archivedSessions ?? join(this.paths.home, 'archived_sessions'),
        ],
        cursor?.identity.startsWith('db:') ? undefined : cursor,
        statusOnly ? 256 * 1024 : undefined,
      )
      if (rollout.changedDuringRead && !cursor)
        rollout = await jsonlPage(path, [
          this.paths.sessions,
          this.paths.archivedSessions ?? join(this.paths.home, 'archived_sessions'),
        ])
      sources.push({
        source: 'codex_rollout',
        health: rollout.coverage.length ? 'partial' : 'ok',
        checkedAt: rollout.checkedAt,
        sourceUpdatedAt: rollout.sourceUpdatedAt,
        revision: rollout.revision,
        identity: rollout.identity,
        boundary: rollout.size,
      })
      coverage.push(...rollout.coverage)
      status = rolloutStatus(rollout.records.map((r) => r.value))
    } catch (error) {
      if ((error as Error).message === 'cursor_expired') throw error
      sources.push(sourceFailure('codex_rollout', 'Registered rollout could not be read.'))
    }
    try {
      const info = await stat(this.paths.history)
      const identity = `db:${info.dev}:${info.ino}:${info.birthtimeMs}`
      if (cursor?.identity.startsWith('db:') && cursor.identity !== identity)
        throw new Error('cursor_expired')
      const [rows = [], turns = []] = await queryDatabase(this.paths.history, [
        {
          sql: `SELECT $turnId AS turn_id,rollout_ordinal,CASE WHEN length(CAST(item_json AS BLOB))>2097152 THEN '' ELSE item_json END AS item_json,length(CAST(item_json AS BLOB))>2097152 AS _oversized FROM thread_items WHERE thread_id=? ${cursor?.identity.startsWith('db:') ? 'AND rollout_ordinal<?' : ''} ORDER BY rollout_ordinal DESC LIMIT ${statusOnly ? 50 : 200}`,
          turnColumn: true,
          params: cursor?.identity.startsWith('db:')
            ? [entry.nativeId, cursor.position]
            : [entry.nativeId],
        },
        {
          sql: 'SELECT * FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
          params: [entry.nativeId],
        },
      ])
      let bytes = 0
      const valid = rows.filter((r) => {
        if (r._budgetExceeded || r._oversized) return false
        bytes += typeof r.item_json === 'string' ? Buffer.byteLength(r.item_json) : 0
        return bytes <= 2 * 1024 * 1024
      })
      if (valid.length !== rows.length) coverage.push('History byte budget reached.')
      const projected = valid.toReversed().flatMap((r) => {
        try {
          return normalize(
            'codex',
            { ...JSON.parse(String(r.item_json)), ...(r.turn_id ? { turn_id: r.turn_id } : {}) },
            'codex_history',
            `history:${entry.nativeId}:${r.rollout_ordinal}`,
          )
        } catch {
          coverage.push('Malformed history item omitted.')
          return []
        }
      })
      const turn = turns[0] ?? {}
      const nativeState = (
        {
          inProgress: 'working',
          completed: 'completed',
          interrupted: 'interrupted',
          failed: 'failed',
        } as const
      )[String(turn?.status) as 'inProgress']
      const projectedStatus: ThreadStatus = nativeState
        ? {
            state: nativeState,
            basis: 'provider_turn',
            at: timestamp(turn.completed_at || turn.started_at),
            turnId: String(turn.turn_id ?? turn.id ?? '') || null,
          }
        : unknownStatus()
      const rolloutNewer =
        !!rollout &&
        (rollout.sourceUpdatedAt > info.mtimeMs || (status.at ?? 0) > (projectedStatus.at ?? 0))
      if ((!rolloutNewer && !cursor) || cursor?.identity.startsWith('db:') || !rollout) {
        items = projected
        status = projectedStatus
        next =
          rows.length === (statusOnly ? 50 : 200) || valid.length < rows.length
            ? {
                position: Number(valid.at(-1)?.rollout_ordinal ?? rows[0]?.rollout_ordinal),
                identity,
                boundary: Number(rows[0]?.rollout_ordinal ?? 0),
              }
            : undefined
      } else
        coverage.push(
          'Rollout used because history projection may lag or page is bound to rollout.',
        )
      sources.push({
        source: 'codex_history',
        health: 'ok',
        checkedAt: Date.now(),
        sourceUpdatedAt: info.mtimeMs,
        revision: String(rows[0]?.rollout_ordinal ?? 'empty'),
        identity,
        boundary: Number(rows[0]?.rollout_ordinal ?? 0),
      })
    } catch (error) {
      if ((error as Error).message === 'cursor_expired') throw error
      sources.push(
        sourceFailure(
          'codex_history',
          'History projection unavailable; checked registered rollout.',
        ),
      )
    }
    if (
      rollout &&
      (!items.length ||
        !sources.some((s) => s.source === 'codex_history' && s.health === 'ok') ||
        coverage.some((c) => c.startsWith('Rollout used')))
    ) {
      items = normalizeRollout(rollout.records, entry.nativeId)
      next = rollout.cursor
      changedDuringRead = rollout.changedDuringRead
      if (!cursor) status = rolloutStatus(rollout.records.map((r) => r.value))
    }
    const hook = this.hook(entry.nativeId)
    if (
      hook &&
      (hook.status.at ?? 0) >= (status.at ?? 0) &&
      Date.now() - (hook.status.at ?? 0) < 60_000
    ) {
      status = hook.status
      if (hook.attention) items.push(hook.attention)
      sources.push({
        source: 'codex_hook',
        health: 'ok',
        checkedAt: Date.now(),
        sourceUpdatedAt: hook.status.at ?? undefined,
      })
    }
    return {
      items: applyTurnCompletion(items, status),
      status,
      sources,
      coverage,
      cursor: next,
      changedDuringRead,
    }
  }
}
