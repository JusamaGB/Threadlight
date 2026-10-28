import { randomUUID } from 'node:crypto'
import { readCapturedCards } from '../codex/threadStream'
import {
  findThreadsSchema,
  readThreadSchema,
  type ThreadProvider,
  type ThreadCandidate,
  type ThreadDiscovery,
  type ThreadEvidence,
  type ThreadVisibleItem,
  type ReadOutcome,
} from '../../shared/threadRead'
import {
  sourceFailure,
  unknownStatus,
  type ThreadAdapter,
  type CatalogEntry,
  type HistoryCursor,
  type AdapterRead,
} from './types'

const key = (e: CatalogEntry) => `${e.provider}:${e.nativeId}`
const clean = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const near = (a: string, b: string) => {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false
  let i = 0,
    j = 0,
    edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length >= b.length) i++
    if (b.length >= a.length) j++
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
type Search = {
  signature: string
  entries: Map<string, CatalogEntry>
  pending: Map<ThreadProvider, string | undefined>
  sources: ThreadDiscovery['sources']
  failed: boolean
  offset: number
  at: number
}
type Page = {
  ref: string
  remaining: ThreadVisibleItem[]
  raw?: HistoryCursor
  sources: ThreadEvidence['sources']
  at: number
}
export interface ReadScope {
  permits?: (provider: ThreadProvider, nativeId: string) => boolean
  id: string
  active: boolean
  refs: Set<string>
  observations: Map<string, ThreadEvidence>
  searches: Map<string, Search>
  pages: Map<string, Page>
}

export class ThreadReadService {
  private entries = new Map<string, CatalogEntry>()
  private identities = new Map<string, string>()
  private workspaces = new Map<string, string>()
  private queues = new Map<string, Promise<unknown>>()
  constructor(
    private adapters: ThreadAdapter[],
    private enabled: () => ThreadProvider[],
    private excluded: (provider: ThreadProvider, id: string) => boolean = () => false,
    private now = Date.now,
    private limits: { sourceDeadlineMs?: number } = {},
  ) {}
  open(permits?: ReadScope['permits']): ReadScope {
    return {
      id: randomUUID(),
      active: true,
      permits,
      refs: new Set(),
      observations: new Map(),
      searches: new Map(),
      pages: new Map(),
    }
  }
  resolve(scope: ReadScope, ref: string) {
    const entry = scope.refs.has(ref) ? this.entries.get(ref) : undefined
    return entry && this.allowed(scope, entry.provider, entry.nativeId)
      ? { id: entry.provider === 'codex' ? `codex:${entry.nativeId}` : entry.nativeId, entry }
      : null
  }
  async cards(scope: ReadScope, ref: string) {
    const resolved = this.resolve(scope, ref)
    if (!resolved) return null
    if (resolved.entry.provider !== 'codex') return null
    const cards = await readCapturedCards(resolved.entry.nativeId)
    return this.resolve(scope, ref) ? cards : null
  }
  close(scope: ReadScope) {
    scope.active = false
    scope.refs.clear()
    scope.observations.clear()
    scope.pages.clear()
    scope.searches.clear()
  }
  private allowed(scope: ReadScope, p: ThreadProvider, id?: string) {
    return (
      scope.active &&
      this.enabled().includes(p) &&
      (!id || (!this.excluded(p, id) && (!scope.permits || scope.permits(p, id))))
    )
  }
  private candidate(
    entry: CatalogEntry,
    scope: ReadScope,
    matchReason = 'selected identity',
  ): ThreadCandidate {
    const id = key(entry)
    let ref = this.identities.get(id)
    if (!ref) {
      ref = randomUUID()
      this.identities.set(id, ref)
    }
    this.entries.set(ref, entry)
    scope.refs.add(ref)
    let workspaceRef: string | undefined
    if (entry.workspace) {
      const folder = entry.workspace.replaceAll('\\', '/').toLowerCase().replace(/\/$/, '')
      workspaceRef = this.workspaces.get(folder)
      if (!workspaceRef) {
        workspaceRef = randomUUID()
        this.workspaces.set(folder, workspaceRef)
      }
    }
    return {
      threadRef: ref,
      title: entry.title,
      titleSource: entry.titleSource,
      provider: entry.provider,
      host: 'local',
      workspace: entry.workspace,
      workspaceRef,
      archived: entry.archived,
      lastActiveAt: entry.lastActiveAt,
      matchReason,
    }
  }
  private async serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id)
    const next = (previous ?? Promise.resolve()).catch(() => {}).then(fn)
    this.queues.set(id, next)
    try {
      return await next
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id)
    }
  }
  private async boundedSerial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    // Keep the underlying queue occupied until I/O settles, even if its caller times out.
    try {
      return await Promise.race([
        this.serial(id, fn),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Source read deadline exceeded.')),
            this.limits.sourceDeadlineMs ?? 3000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  private expire(scope: ReadScope) {
    for (const map of [scope.searches, scope.pages])
      for (const [id, value] of map) if (this.now() - value.at > 120_000) map.delete(id)
    while (scope.observations.size > 50)
      scope.observations.delete(scope.observations.keys().next().value!)
    while (scope.searches.size > 20) scope.searches.delete(scope.searches.keys().next().value!)
    while (scope.pages.size > 100) scope.pages.delete(scope.pages.keys().next().value!)
  }
  async find(scope: ReadScope, input: unknown): Promise<ThreadDiscovery> {
    const requestedAt = this.now(),
      parsed = findThreadsSchema.safeParse(input)
    const empty = (outcome: ReadOutcome, reason: string): ThreadDiscovery => ({
      outcome,
      reason,
      queryId: randomUUID(),
      requestedAt,
      scope: [],
      sources: [],
      resolution: 'incomplete',
      candidates: [],
      hasMore: false,
      coverage: [reason],
    })
    if (!parsed.success) return empty('invalid_request', 'Invalid discovery arguments.')
    if (!scope.active) return empty('out_of_scope', 'This Agent runtime has closed.')
    this.expire(scope)
    const p = parsed.data,
      providers = p.provider ? [p.provider] : [...this.enabled()]
    if (p.provider && !this.enabled().includes(p.provider))
      return empty('provider_disabled', 'That provider is disabled.')
    if (!providers.length) return empty('provider_disabled', 'No monitored providers are enabled.')
    const signature = JSON.stringify([p.query, p.provider, p.workspaceRef, p.archived])
    const search = p.cursor
      ? scope.searches.get(p.cursor)
      : ({
          signature,
          entries: new Map(),
          pending: new Map(providers.map((provider) => [provider, undefined])),
          sources: [],
          failed: false,
          offset: 0,
          at: requestedAt,
        } as Search)
    if (!search || search.signature !== signature)
      return empty('cursor_expired', 'Search cursor expired or belongs to another query.')
    const queryId = p.cursor ?? randomUUID()
    const deadline = this.now() + 2500
    for (const provider of providers) {
      const adapter = this.adapters.find((a) => a.provider === provider)
      if (!adapter) {
        search.failed = true
        search.pending.delete(provider)
        search.sources.push(sourceFailure(`${provider}_metadata`, 'Provider adapter unavailable.'))
        continue
      }
      while (search.pending.has(provider) && this.now() < deadline) {
        try {
          const page = await this.boundedSerial(`catalog:${provider}`, () =>
            adapter.catalog(search.pending.get(provider)),
          )
          for (const entry of page.entries)
            if (!this.excluded(provider, entry.nativeId)) search.entries.set(key(entry), entry)
          const priorErrors = search.sources.filter((s) => s.health !== 'ok')
          search.sources = search.sources
            .filter((s) => !page.sources.some((n) => n.source === s.source))
            .concat(page.sources)
          for (const prior of priorErrors) {
            const latest = search.sources.find((s) => s.source === prior.source)
            if (latest) {
              latest.health = prior.health
              latest.reason = prior.reason
            }
          }
          if (page.sources.some((s) => s.health !== 'ok')) search.failed = true
          if (page.next) search.pending.set(provider, page.next)
          else {
            search.pending.delete(provider)
            if (!page.complete) search.failed = true
          }
        } catch {
          search.failed = true
          search.pending.delete(provider)
          search.sources.push(
            sourceFailure(`${provider}_metadata`, 'Provider metadata could not be refreshed.'),
          )
        }
      }
    }
    if (!scope.active || providers.some((provider) => !this.enabled().includes(provider)))
      return empty('provider_disabled', 'Read scope changed before results were delivered.')
    const query = clean(p.query),
      tokens = query.split(' ').filter(Boolean)
    const ranked = [...search.entries.values()]
      .filter((e) => this.allowed(scope, e.provider, e.nativeId))
      .map((e) => this.candidate(e, scope))
      .filter(
        (c) =>
          (!p.workspaceRef || c.workspaceRef === p.workspaceRef) &&
          (p.archived === 'include' ||
            (p.archived === 'only' ? c.archived === true : c.archived !== true)),
      )
      .map((c) => {
        const name = clean(c.title),
          exact = name === query,
          phrase = tokens.length > 0 && tokens.every((t) => name.split(' ').includes(t))
        const fuzzy =
          !phrase &&
          tokens.length > 0 &&
          tokens.every((t) =>
            name.split(' ').some((n) => near(t, n) || (t.length >= 3 && n.startsWith(t))),
          )
        return {
          ...c,
          matchReason: !query
            ? 'catalogue'
            : exact
              ? 'exact title'
              : phrase
                ? 'title phrase'
                : 'possible title',
          score: exact ? 3 : phrase ? 2 : fuzzy ? 1 : !query ? 0 : -1,
        }
      })
      .filter((c) => c.score >= 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) ||
          a.threadRef.localeCompare(b.threadRef),
      )
    const incomplete = search.pending.size > 0 || search.failed
    const plausible = ranked.filter((c) => c.score >= 2)
    const matches = plausible.length ? plausible : ranked
    const resolution = incomplete
      ? 'incomplete'
      : !query || ranked.length === 0
        ? 'none'
        : plausible.length === 1
          ? 'unique'
          : 'ambiguous'
    const candidates = matches
      .slice(search.offset, search.offset + p.limit)
      .map(({ score: _score, ...c }) => c)
    if (!search.pending.size) search.offset += p.limit
    const hasMore = search.pending.size > 0 || search.offset < matches.length
    search.at = this.now()
    scope.searches.set(queryId, search)
    return {
      outcome: incomplete ? 'partial' : 'ok',
      queryId,
      requestedAt,
      scope: providers,
      sources: search.sources,
      resolution,
      resolvedRef: resolution === 'unique' ? plausible[0]!.threadRef : undefined,
      candidates,
      hasMore,
      nextCursor: hasMore ? queryId : undefined,
      coverage: incomplete
        ? ['Discovery coverage incomplete; do not conclude unique or absent.']
        : [],
    }
  }
  async read(scope: ReadScope, input: unknown): Promise<ThreadEvidence> {
    const requestedAt = this.now(),
      parsed = readThreadSchema.safeParse(input)
    const fallback: ThreadCandidate = {
      threadRef: '',
      title: 'Unavailable chat',
      titleSource: 'fallback',
      provider: 'codex',
      host: 'local',
      workspace: null,
      archived: 'unknown',
      lastActiveAt: null,
      matchReason: '',
    }
    let thread = fallback
    const failure = (outcome: ReadOutcome, reason: string): ThreadEvidence => ({
      outcome,
      reason,
      observationId: randomUUID(),
      thread,
      requestedAt,
      checkedAt: null,
      sources: [],
      changedDuringRead: false,
      status: unknownStatus(),
      items: [],
      coverage: [reason],
      hasMore: false,
      currentRequest: null,
      latestProgress: null,
      latestCompletedReply: null,
      plan: null,
      attention: null,
      backgroundTasks: [],
      absenceReason: reason,
    })
    if (!parsed.success) return failure('invalid_request', 'Invalid thread read arguments.')
    this.expire(scope)
    const p = parsed.data,
      entry = this.entries.get(p.threadRef)
    if (!scope.active || !scope.refs.has(p.threadRef) || !entry)
      return failure('out_of_scope', 'Resolve this chat in the current Agent conversation first.')
    if (!this.enabled().includes(entry.provider))
      return failure('provider_disabled', 'That provider is disabled.')
    if (this.excluded(entry.provider, entry.nativeId))
      return failure('out_of_scope', 'Coordinator chats are outside the read scope.')
    thread = this.candidate(entry, scope)
    const page = p.cursor ? scope.pages.get(p.cursor) : undefined
    if (p.cursor && (!page || page.ref !== p.threadRef))
      return failure('cursor_expired', 'History cursor expired or belongs to another chat.')
    const adapter = this.adapters.find((a) => a.provider === entry.provider)!
    try {
      return await this.boundedSerial(key(entry), async () => {
        if (!this.allowed(scope, entry.provider, entry.nativeId))
          return failure('out_of_scope', 'Read scope changed.')
        const current = await adapter.locate(entry.nativeId)
        if (!current)
          return failure(
            'not_found',
            'The selected identity is no longer indexed; resolve it again.',
          )
        thread = this.candidate(current, scope)
        const latest = await adapter.read(current, undefined, p.view === 'status')
        if (
          page &&
          !latest.sources.some(
            (s) => s.health !== 'unavailable' && /history|rollout|transcript/.test(s.source),
          )
        )
          return failure(
            'unavailable',
            'Cannot revalidate the source for this historical page; retained evidence is historical.',
          )
        let history: AdapterRead = latest
        if (page?.remaining.length) {
          if (
            page.sources.some(
              (old) =>
                old.identity &&
                latest.sources.some(
                  (s) =>
                    s.source === old.source &&
                    s.identity &&
                    (s.identity !== old.identity || (s.boundary ?? Infinity) < (old.boundary ?? 0)),
                ),
            )
          )
            return failure('cursor_expired', 'Source identity changed.')
          history = { ...latest, items: page.remaining, cursor: page.raw }
        } else if (page?.raw) history = await adapter.read(current, page.raw)
        if (!this.allowed(scope, entry.provider, entry.nativeId))
          return failure('provider_disabled', 'Read scope changed before results were delivered.')
        const visible = history.items,
          recent = latest.items
        const chosen: ThreadVisibleItem[] = []
        let budget = 16_000,
          consumed = 0
        for (const item of visible.toReversed()) {
          if (chosen.length >= p.limit || budget <= 0) break
          const text = item.text.slice(0, Math.min(6000, budget))
          budget -= text.length
          chosen.unshift({
            ...item,
            text,
            truncated: text.length < item.text.length || item.truncated,
          })
          consumed++
        }
        const remaining = visible.slice(0, Math.max(0, visible.length - consumed))
        const nextCursor = remaining.length || history.cursor ? randomUUID() : undefined
        if (nextCursor)
          scope.pages.set(nextCursor, {
            ref: p.threadRef,
            remaining,
            raw: history.cursor,
            sources: history.sources,
            at: this.now(),
          })
        const brief = (item: ThreadVisibleItem | undefined): ThreadVisibleItem | null =>
          item
            ? {
                ...item,
                text: item.text.slice(0, 1000),
                truncated: item.text.length > 1000 || item.truncated,
              }
            : null
        const lastRequest = recent.findLastIndex((i) => i.role === 'user'),
          nativeTurn =
            latest.status.turnId && !latest.status.turnId.startsWith('request:')
              ? latest.status.turnId
              : null,
          request = recent[lastRequest],
          requestBelongs =
            !nativeTurn ||
            !request?.turnId ||
            request.turnId.startsWith('request:') ||
            request.turnId === nativeTurn,
          currentItems =
            nativeTurn && !requestBelongs
              ? recent.filter((i) => i.turnId === nativeTurn)
              : recent.slice(Math.max(0, lastRequest))
        const attentionIndex = currentItems.findLastIndex((i) => i.kind === 'attention')
        const attention = currentItems[attentionIndex]
        const resolved =
          attention?.callId &&
          currentItems.slice(attentionIndex + 1).some((i) => i.resolvedCallId === attention.callId)
        const status =
          attention?.blocking && !resolved && latest.status.state === 'working'
            ? {
                ...latest.status,
                state: 'waiting' as const,
                basis: 'inferred' as const,
                at: attention.at ?? latest.status.at,
              }
            : latest.status
        const sources = [...latest.sources, ...(page ? history.sources : [])],
          readable = sources.some(
            (s) => s.health !== 'unavailable' && /history|rollout|transcript/.test(s.source),
          )
        const coverage = [...new Set([...latest.coverage, ...history.coverage])]
        if (!requestBelongs)
          coverage.push(
            'Current native turn request has not appeared in the bounded local history; the older request is not current.',
          )
        if (chosen.some((i) => i.truncated))
          coverage.push('Some visible text was truncated to response bounds.')
        const result: ThreadEvidence = {
          outcome: !readable
            ? 'unavailable'
            : coverage.length || sources.some((s) => s.health !== 'ok')
              ? 'partial'
              : 'ok',
          observationId: randomUUID(),
          thread,
          requestedAt,
          checkedAt: readable ? Math.max(...sources.map((s) => s.checkedAt ?? 0)) : null,
          sources,
          changedDuringRead: latest.changedDuringRead || history.changedDuringRead,
          status,
          items: p.view === 'status' ? [] : chosen,
          coverage,
          hasMore: !!nextCursor,
          nextCursor,
          currentRequest: brief(requestBelongs ? request : undefined),
          latestProgress: brief(
            currentItems.findLast((i) => i.phase === 'progress' && i.role === 'assistant'),
          ),
          latestCompletedReply: brief(recent.findLast((i) => i.phase === 'final' && i.complete)),
          plan: brief(currentItems.findLast((i) => i.kind === 'plan')),
          attention: latest.status.state === 'completed' || resolved ? null : brief(attention),
          backgroundTasks: currentItems
            .filter((i) => i.kind === 'task')
            .slice(-3)
            .map((i) => brief(i)!),
          absenceReason:
            'Missing fields were not observed within this bounded read; absence is not proof of completion or no pending request.',
        }
        if (p.sinceObservationId) {
          const old = scope.observations.get(p.sinceObservationId),
            valid = old?.thread.threadRef === p.threadRef
          const prior = new Map(valid ? old.items.map((i) => [i.id, i]) : [])
          result.delta = {
            baselineUnavailable: !valid,
            newItems: result.items.filter((i) => !prior.has(i.id)).map((i) => i.id),
            updatedItems: result.items
              .filter(
                (i) => prior.has(i.id) && JSON.stringify(prior.get(i.id)) !== JSON.stringify(i),
              )
              .map((i) => i.id),
            changedFields: valid
              ? (
                  [
                    'status',
                    'thread',
                    'attention',
                    'currentRequest',
                    'latestProgress',
                    'latestCompletedReply',
                    'plan',
                    'backgroundTasks',
                  ] as const
                ).filter((k) => JSON.stringify(old[k]) !== JSON.stringify(result[k]))
              : [],
          }
        }
        if (readable) scope.observations.set(result.observationId, result)
        return result
      })
    } catch (error) {
      return failure(
        (error as Error).message === 'cursor_expired' ? 'cursor_expired' : 'unavailable',
        (error as Error).message === 'cursor_expired'
          ? 'Source changed; request a new page.'
          : 'The selected chat could not be refreshed. Previous observations remain historical.',
      )
    }
  }
}
