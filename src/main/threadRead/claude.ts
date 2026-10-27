import { readdir, readFile, stat, open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ClaudePaths } from '../sessions/paths'
import { parseAppRecord } from '../sessions/appRecords'
import { isObject } from '../sessions/json'
import { contained, jsonlPage } from './files'
import { normalize, associateTurns } from './normalize'
import {
  unknownStatus,
  type AdapterRead,
  type CatalogEntry,
  type HistoryCursor,
  type ThreadAdapter,
} from './types'
import type { ThreadStatus, ThreadVisibleItem } from '../../shared/threadRead'

export class ClaudeReadAdapter implements ThreadAdapter {
  readonly provider = 'claude' as const
  private entries = new Map<string, { entry: CatalogEntry; record?: string }>()
  private files: { path: string; kind: 'record' | 'index' | 'transcript' }[] = []
  private listingErrors: string[] = []
  private listingGeneration = 0
  private cliMetadata = new Map<
    string,
    {
      stamp: string
      title: string
      titleSource: CatalogEntry['titleSource']
      workspace: string | null
      at: number
      titleCoverage: boolean
    }
  >()
  constructor(
    private paths: ClaudePaths,
    private hook: (
      id: string,
    ) => { status: ThreadStatus; attention?: ThreadVisibleItem } | null = () => null,
  ) {}
  private async list() {
    this.listingGeneration++
    this.files = []
    this.listingErrors = []
    const roots = await Promise.all(
      [this.paths.projectsDir, this.paths.appSessionsDir].map((path) =>
        stat(path).then(
          () => true,
          () => false,
        ),
      ),
    )
    if (!roots.some(Boolean))
      this.listingErrors.push('Claude local metadata is unavailable or not installed.')
    const dirs = async (path: string) => {
      try {
        return (await readdir(path, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => join(path, e.name))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
          this.listingErrors.push('A provider metadata directory could not be listed.')
        return []
      }
    }
    for (const account of await dirs(this.paths.appSessionsDir))
      for (const org of await dirs(account)) {
        try {
          for (const file of await readdir(org))
            if (/^local_.*\.json$/.test(file))
              this.files.push({ path: join(org, file), kind: 'record' })
        } catch {
          this.listingErrors.push('An app metadata directory became unavailable.')
        }
      }
    for (const project of await dirs(this.paths.projectsDir)) {
      try {
        const files = await readdir(project)
        if (files.includes('sessions-index.json'))
          this.files.push({ path: join(project, 'sessions-index.json'), kind: 'index' })
        for (const file of files)
          if (/^[\da-f-]{36}\.jsonl$/i.test(file))
            this.files.push({ path: join(project, file), kind: 'transcript' })
      } catch {
        this.listingErrors.push('A transcript index directory became unavailable.')
      }
    }
    this.files.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
  }
  private async json(path: string, root: string) {
    const file = await contained(path, [root])
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error('Metadata file exceeds byte budget.')
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  }
  private async cliTitle(path: string) {
    const file = await open(await contained(path, [this.paths.projectsDir]), 'r')
    try {
      const info = await file.stat(),
        stamp = `${info.ino}:${info.size}:${info.mtimeMs}`
      const cached = this.cliMetadata.get(path)
      if (cached?.stamp === stamp) return cached
      const records: Record<string, unknown>[] = []
      for (const offset of info.size > 32768 ? [0, Math.max(0, info.size - 32768)] : [0]) {
        const buffer = Buffer.alloc(Math.min(32768, info.size - offset))
        await file.read(buffer, 0, buffer.length, offset)
        const lines = buffer.toString('utf8').split('\n')
        if (offset) lines.shift()
        for (const line of lines)
          try {
            const raw: unknown = JSON.parse(line)
            if (isObject(raw)) records.push(raw)
          } catch {
            /* bounded header/tail may split records */
          }
      }
      const named = records.findLast(
        (r) => r.type === 'custom-title' && typeof r.customTitle === 'string',
      )
      const user = records.find((r) => r.type === 'user' && isObject(r.message))
      const visible = user
        ? normalize('claude', user, 'claude_metadata', 'header').find((i) => i.role === 'user')
        : undefined
      const cwd = records.find((r) => typeof r.cwd === 'string')?.cwd
      const value = {
        stamp,
        title: String(named?.customTitle ?? visible?.text ?? basename(path, '.jsonl')).slice(
          0,
          500,
        ),
        titleSource: (named
          ? 'explicit'
          : visible
            ? 'first_message'
            : 'fallback') as CatalogEntry['titleSource'],
        workspace: typeof cwd === 'string' ? cwd : null,
        at: info.mtimeMs,
        titleCoverage: info.size <= 65536 || !!named,
      }
      this.cliMetadata.set(path, value)
      return value
    } finally {
      await file.close()
    }
  }
  async catalog(cursor?: string) {
    if (!cursor) await this.list()
    const page = cursor ? (JSON.parse(cursor) as { generation: number; offset: number }) : undefined
    if (page && page.generation !== this.listingGeneration)
      throw new Error('Catalogue listing changed; search again.')
    const offset = page?.offset ?? 0,
      entries: CatalogEntry[] = [],
      errors = [...this.listingErrors]
    const readMetadata = async (file: (typeof this.files)[number]) => {
      try {
        if (file.kind === 'record') {
          const raw = await this.json(file.path, this.paths.appSessionsDir)
          const record = parseAppRecord(raw)
          // App-only records without a CLI session are not locally readable code chats.
          if (!record && isObject(raw) && !raw.cliSessionId) return
          if (!record) throw new Error('Unsupported app record.')
          const transcript = this.files.find(
            (f) => f.kind === 'transcript' && basename(f.path) === `${record.cliSessionId}.jsonl`,
          )?.path
          const entry: CatalogEntry = {
            nativeId: record.cliSessionId,
            provider: 'claude',
            title: record.title ?? record.cliSessionId,
            titleSource: record.title ? 'explicit' : 'fallback',
            workspace: record.workspace ?? record.cwd,
            archived:
              isObject(raw) && typeof raw.isArchived === 'boolean' ? raw.isArchived : 'unknown',
            lastActiveAt: record.lastActivityAt || null,
            locator: transcript,
          }
          const previous = this.entries.get(entry.nativeId)
          if (!previous?.record || (entry.lastActiveAt ?? 0) >= (previous.entry.lastActiveAt ?? 0))
            this.entries.set(entry.nativeId, { entry, record: file.path })
          entries.push(this.entries.get(entry.nativeId)!.entry)
        } else if (file.kind === 'index') {
          const raw = await this.json(file.path, this.paths.projectsDir)
          if (!isObject(raw) || !Array.isArray(raw.entries))
            throw new Error('Unsupported CLI index.')
          for (const item of raw.entries.filter(isObject)) {
            if (typeof item.sessionId !== 'string' || !/^[\da-f-]{36}$/i.test(item.sessionId))
              continue
            const entry: CatalogEntry = {
              nativeId: item.sessionId,
              provider: 'claude',
              title: String(
                item.customTitle || item.summary || item.firstPrompt || item.sessionId,
              ).slice(0, 500),
              titleSource:
                item.customTitle || item.summary
                  ? 'explicit'
                  : item.firstPrompt
                    ? 'first_message'
                    : 'fallback',
              workspace: typeof item.projectPath === 'string' ? item.projectPath : null,
              archived: 'unknown',
              lastActiveAt:
                typeof item.modified === 'string' ? Date.parse(item.modified) || null : null,
              locator: join(dirname(file.path), `${item.sessionId}.jsonl`),
            }
            if (!this.entries.get(entry.nativeId)?.record)
              this.entries.set(entry.nativeId, { entry })
            entries.push(this.entries.get(entry.nativeId)!.entry)
          }
        } else {
          const id = basename(file.path, '.jsonl'),
            existing = this.entries.get(id)
          const metadata = existing?.record ? null : await this.cliTitle(file.path)
          const entry = existing?.entry ?? {
            nativeId: id,
            provider: 'claude' as const,
            title: metadata?.title ?? id,
            titleSource: metadata?.titleSource ?? ('fallback' as const),
            workspace: metadata?.workspace ?? null,
            archived: 'unknown' as const,
            lastActiveAt: metadata?.at ?? null,
            locator: file.path,
          }
          entry.locator = file.path
          if (metadata && !existing?.record)
            Object.assign(entry, {
              ...(metadata.titleSource === 'explicit' || entry.titleSource !== 'explicit'
                ? { title: metadata.title, titleSource: metadata.titleSource }
                : {}),
              workspace: metadata.workspace ?? entry.workspace,
              lastActiveAt: metadata.at,
            })
          if (metadata && !metadata.titleCoverage && entry.titleSource !== 'explicit')
            errors.push(
              'An unindexed CLI title could not be fully established from bounded metadata; name coverage is incomplete.',
            )
          this.entries.set(id, { ...existing, entry })
          entries.push(entry)
        }
      } catch (error) {
        const issue = (error as Error).message
        errors.push(
          issue.startsWith('Unsupported') || issue.startsWith('Metadata file')
            ? issue
            : `Metadata ${file.kind} could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).name}); coverage is incomplete.`,
        )
      }
    }
    // Keep file reads bounded and concurrent; a catalogue must not serialize thousands of stats.
    const selected = this.files.slice(offset, offset + 200)
    for (const kind of ['index', 'record', 'transcript'] as const) {
      const group = selected.filter((file) => file.kind === kind)
      for (let start = 0; start < group.length; start += 16)
        await Promise.all(group.slice(start, start + 16).map(readMetadata))
    }
    const next =
      offset + 200 < this.files.length
        ? JSON.stringify({ generation: this.listingGeneration, offset: offset + 200 })
        : undefined
    return {
      entries,
      complete: !next && !errors.length,
      next,
      sources: [
        {
          source: 'claude_metadata',
          health: errors.length ? ('partial' as const) : ('ok' as const),
          checkedAt: Date.now(),
          reason: errors.length ? [...new Set(errors)].join(' ') : undefined,
          revision: String(offset),
        },
      ],
    }
  }
  async locate(id: string) {
    const known = this.entries.get(id)
    if (!known) return null
    if (known.record) {
      const raw = await this.json(known.record, this.paths.appSessionsDir),
        record = parseAppRecord(raw)
      if (!record || record.cliSessionId !== id)
        throw new Error('Thread metadata changed identity.')
      known.entry = {
        ...known.entry,
        title: record.title ?? id,
        archived: isObject(raw) && typeof raw.isArchived === 'boolean' ? raw.isArchived : 'unknown',
        workspace: record.workspace ?? record.cwd,
        lastActiveAt: record.lastActivityAt || null,
      }
    } else if (known.entry.locator) {
      const metadata = await this.cliTitle(known.entry.locator)
      known.entry = {
        ...known.entry,
        ...(metadata.titleSource === 'explicit' || known.entry.titleSource !== 'explicit'
          ? { title: metadata.title, titleSource: metadata.titleSource }
          : {}),
        workspace: metadata.workspace ?? known.entry.workspace,
        lastActiveAt: metadata.at,
      }
    }
    return known.entry
  }
  async read(
    entry: CatalogEntry,
    cursor?: HistoryCursor,
    statusOnly = false,
  ): Promise<AdapterRead> {
    if (!entry.locator) throw new Error('Transcript unavailable for this app record.')
    let page = await jsonlPage(
      entry.locator,
      [this.paths.projectsDir],
      cursor,
      statusOnly ? 256 * 1024 : undefined,
    )
    if (page.changedDuringRead && !cursor)
      page = await jsonlPage(entry.locator, [this.paths.projectsDir])
    const items = associateTurns(
      page.records.flatMap((r) =>
        normalize(
          'claude',
          r.value,
          'claude_transcript',
          `transcript:${entry.nativeId}:${r.offset}`,
        ),
      ),
    )
    let status = unknownStatus()
    const latest = items.findLast((i) => i.role === 'assistant' || i.role === 'user')
    if (latest?.role === 'assistant' && latest.complete)
      status = { state: 'completed', basis: 'inferred', at: latest.at, turnId: latest.turnId }
    const hook = this.hook(entry.nativeId)
    if (
      hook &&
      ((hook.attention?.expiresAt ?? 0) > Date.now() ||
        Date.now() - (hook.status.at ?? 0) < 60_000) &&
      (hook.status.at ?? 0) >= (status.at ?? 0)
    ) {
      status = hook.status
      if (hook.attention) items.push(hook.attention)
    }
    return {
      items,
      status,
      sources: [
        {
          source: 'claude_transcript',
          health: page.coverage.length ? 'partial' : 'ok',
          checkedAt: page.checkedAt,
          sourceUpdatedAt: page.sourceUpdatedAt,
          revision: page.revision,
          identity: page.identity,
          boundary: page.size,
        },
      ],
      coverage: page.coverage,
      cursor: page.cursor,
      changedDuringRead: page.changedDuringRead,
    }
  }
}
