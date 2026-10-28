import { createHash } from 'node:crypto'
import {
  spaceContextSchemas,
  BRAINSTORM_SKILLS,
  SPACE_CONTEXT_VERSION,
  type SpaceSource,
} from '../../shared/spaceContext'
import { projectParticipants } from '../../shared/projectParticipants'
import type { Session } from '../../shared/types'
import type { AgentHistoryPage } from '../../shared/agent'
import type { MemoryStore } from '../memory/store'
import type { SpacesStore } from './store'
import type { ThreadReadConnection, ThreadReadServer } from '../threadRead/server'

export interface ContextScope {
  active: boolean
  spaceIds: string[]
  discussionId: string
  reader?: ThreadReadConnection
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const words = (q: string) => q.toLocaleLowerCase().split(/\s+/).filter(Boolean)
const matches = (text: string, query: string) =>
  words(query).every((w) => text.toLocaleLowerCase().includes(w))
const catalogue = ({ body: _body, ...source }: SpaceSource) => source
export class SpaceContextService {
  constructor(
    private store: SpacesStore,
    private memory: () => MemoryStore | null,
    private sessions: () => Session[],
    private threads?: ThreadReadServer,
    private history?: (id: string, cursor?: string) => Promise<AgentHistoryPage>,
  ) {}
  open(discussionId: string, comparisons: string[] = []): ContextScope {
    const discussion = this.store.get(discussionId)
    if (!discussion.sharedSpaceId)
      throw Error('Assign this discussion to an exact shared space first.')
    const scope: ContextScope = {
      active: true,
      discussionId,
      spaceIds: [...new Set([discussion.sharedSpaceId, ...comparisons])],
    }
    this.check(scope)
    scope.reader = this.threads?.connect(
      () => {},
      (provider, nativeId) => {
        if (!scope.active) return false
        const id = provider === 'codex' ? `codex:${nativeId}` : nativeId
        return this.members(scope).some((p) => p.assignee === id)
      },
    )
    return scope
  }
  close(scope: ContextScope) {
    scope.active = false
    scope.reader?.close()
  }
  private check(scope: ContextScope) {
    const data = this.memory()?.snapshot()
    if (
      !scope.active ||
      !data ||
      scope.spaceIds.some((id) => !data.spaces.some((s) => s.id === id))
    )
      throw Error('Space context is unavailable or access ended.')
    if (this.store.get(scope.discussionId).sharedSpaceId !== scope.spaceIds[0])
      throw Error('Discussion scope changed. Reopen it.')
    return data
  }
  private members(scope: ContextScope) {
    const data = this.check(scope),
      now = Date.now()
    return scope.spaceIds.flatMap((spaceId) =>
      projectParticipants(data, this.sessions(), spaceId)
        .filter((p) =>
          data.grants.some(
            (g) =>
              g.spaceId === spaceId &&
              g.assignee === p.assignee &&
              !g.revoked &&
              !g.taskId &&
              (!g.expiresAt || g.expiresAt > now),
          ),
        )
        .map((p) => ({ ...p, spaceId })),
    )
  }
  private sources(scope: ContextScope): { sources: SpaceSource[]; issues: string[] } {
    const data = this.check(scope),
      memory = this.memory()!,
      ids = new Set(scope.spaceIds)
    const sources: SpaceSource[] = [],
      issues: string[] = []
    const add = (s: SpaceSource) => {
      if (sources.length < 5000) sources.push(s)
      else if (!issues.length)
        issues.push('Source catalogue exceeds 5000 records; coverage is incomplete.')
    }
    for (const n of [...this.store.all(), ...this.store.discussions()])
      if (n.sharedSpaceId && ids.has(n.sharedSpaceId))
        add({
          sourceRef: `${n.recordKind === 'discussion' ? 'discussion' : 'note'}:${n.id}`,
          spaceId: n.sharedSpaceId,
          kind: n.recordKind === 'discussion' ? 'discussion' : 'note',
          title: n.title,
          revision: String(n.revision),
          at: n.at,
          body: `${n.text}\n\nPlan:\n${n.plan}\n\nAssignments:\n${JSON.stringify(n.assignments)}\nLinked notes: ${(n.noteIds ?? []).join(', ')}`,
        })
    for (const item of data.items.filter((i) => ids.has(i.spaceId) && !i.archived).slice(0, 5000)) {
      try {
        const r = memory.read({}, item.id)
        add({
          sourceRef: `item:${item.id}`,
          spaceId: item.spaceId,
          kind: data.tasks.some((t) => t.spaceId === item.spaceId && t.outputIds.includes(item.id))
            ? 'result'
            : 'handoff',
          title: item.title,
          revision: String(item.revision),
          at: r.revision.createdAt,
          author: r.revision.author,
          acceptedRevision: item.acceptedRevision,
          body: r.revision.body,
        })
      } catch {
        issues.push(`Item ${item.id} is unavailable.`)
      }
    }
    for (const t of data.tasks.filter((t) => ids.has(t.spaceId)))
      add({
        sourceRef: `task:${t.id}`,
        spaceId: t.spaceId,
        kind: 'assignment',
        title: t.title,
        revision: hash(t),
        at: t.updatedAt,
        author: t.author,
        body: JSON.stringify(t),
      })
    for (const m of data.messages.filter((m) => ids.has(m.spaceId)))
      add({
        sourceRef: `message:${m.id}`,
        spaceId: m.spaceId,
        kind: 'message',
        title: 'Handoff discussion',
        revision: hash(m),
        at: m.createdAt,
        author: m.author,
        body: JSON.stringify(m),
      })
    for (const kind of ['message', 'question', 'assignment', 'workflow'] as const) {
      for (const r of memory.communications.list(kind))
        if (r.spaceId && ids.has(r.spaceId))
          add({
            sourceRef: `communication-${kind}:${r.id}`,
            spaceId: r.spaceId,
            kind,
            title: `${kind} ${r.id}`,
            revision: hash(r),
            at: 'at' in r && typeof r.at === 'number' ? r.at : null,
            body: JSON.stringify(r),
          })
    }
    return { sources, issues }
  }
  async call(scope: ContextScope, tool: string, args: unknown): Promise<unknown> {
    this.check(scope)
    const schema = spaceContextSchemas[tool as keyof typeof spaceContextSchemas]
    if (!schema) throw Error('This Brainstorm role can only read space context.')
    const input = schema.parse(args)
    const observedAt = Date.now()
    if (
      tool === 'threadlight_find_threads' ||
      tool === 'threadlight_read_thread' ||
      tool === 'threadlight_search_thread'
    ) {
      if (!scope.reader || !this.threads)
        return { outcome: 'unavailable', reason: 'Chat reader unavailable.', observedAt }
      let result: unknown
      if (tool === 'threadlight_find_threads') result = await this.threads.find(scope.reader, input)
      else if (tool === 'threadlight_read_thread')
        result = await this.threads.read(scope.reader, input)
      else {
        const p = spaceContextSchemas.threadlight_search_thread.parse(input)
        const page = await this.threads.read(scope.reader, {
          threadRef: p.threadRef,
          cursor: p.cursor,
          limit: 100,
          view: 'recent',
        })
        result = {
          ...page,
          items: page.items.filter((i) => matches(i.text, p.query)),
          scannedItems: page.items.length,
          coverage: [
            ...page.coverage,
            'Search covers this page of visible transcript items only. Continue nextCursor for older content.',
          ],
        }
      }
      this.check(scope)
      // Revalidate membership after provider I/O, not only before it.
      if ('threadRef' in input && !this.threads.resolve(scope.reader, input.threadRef))
        return { outcome: 'out_of_scope', observedAt }
      return result
    }
    const { sources, issues } = this.sources(scope)
    if (tool === 'threadlight_read_discussion') {
      const p = spaceContextSchemas.threadlight_read_discussion.parse(input)
      const source = sources.find((s) => s.sourceRef === p.sourceRef && s.kind === 'discussion')
      if (!source || !this.history) return { outcome: 'not_found', observedAt }
      const discussion = this.store.get(source.sourceRef.slice('discussion:'.length))
      if (!discussion.conversationId)
        return { outcome: 'ok', observedAt, source: catalogue(source), items: [], cursor: null }
      const result = await this.history(discussion.conversationId, p.cursor)
      this.check(scope)
      return {
        outcome: result.error ? 'unavailable' : 'ok',
        observedAt,
        source: catalogue(source),
        ...result,
      }
    }
    if (tool === 'threadlight_read_space_source') {
      const p = spaceContextSchemas.threadlight_read_space_source.parse(input)
      let source = sources.find((s) => s.sourceRef === p.sourceRef)
      if (!source) return { outcome: 'not_found', observedAt }
      if (p.revision && p.revision !== source.revision) {
        if (source.kind !== 'note')
          return {
            outcome: 'conflict',
            reason: 'Source revision changed; refresh before using it.',
            observedAt,
          }
        const n = this.store.revision(source.sourceRef.slice(5), Number(p.revision))
        source = {
          ...source,
          revision: String(n.revision),
          at: n.at,
          body: `${n.text}\n\n${n.plan}`,
        }
      }
      const body = source.body.slice(p.offset, p.offset + p.limit * 1000)
      return {
        outcome: 'ok',
        observedAt,
        source: { ...source, body },
        hasMore: p.offset + body.length < source.body.length,
        nextOffset: p.offset + body.length,
      }
    }
    const p = input as { offset: number; limit: number }
    if (tool === 'threadlight_get_space_activity') {
      const records = sources.filter((s) => ['assignment', 'question', 'workflow'].includes(s.kind))
      return {
        outcome: issues.length ? 'partial' : 'ok',
        observedAt,
        participants: this.members(scope)
          .slice(p.offset, p.offset + p.limit)
          .map((member) => ({
            ...member,
            observedState:
              this.sessions().find((s) => s.id === member.assignee)?.state ?? 'unknown',
            basis: 'last monitored snapshot; use read_thread status for fresh evidence',
          })),
        records: records.slice(p.offset, p.offset + p.limit).map(catalogue),
        hasMore: p.offset + p.limit < Math.max(records.length, this.members(scope).length),
        issues,
      }
    }
    const filtered =
      tool === 'threadlight_search_space'
        ? sources.filter((s) =>
            matches(`${s.title}\n${s.body}`, (input as { query: string }).query),
          )
        : sources
    const page = filtered.slice(p.offset, p.offset + p.limit)
    return {
      outcome: issues.length ? 'partial' : 'ok',
      observedAt,
      version: SPACE_CONTEXT_VERSION,
      spaces: this.check(scope)
        .spaces.filter((s) => scope.spaceIds.includes(s.id))
        .map((s) => ({ id: s.id, title: s.title, description: s.description })),
      participants: this.members(scope)
        .slice(p.offset, p.offset + Math.min(p.limit, 10))
        .map((member) => ({
          ...member,
          reports: member.reports.slice(-1).map((report) => ({
            ...report,
            capabilities: report.capabilities.slice(0, 5),
            verifications: report.verifications.slice(0, 5),
            omittedCapabilities: Math.max(0, report.capabilities.length - 5),
          })),
        })),
      participantTotal: this.members(scope).length,
      participantCoverage:
        'Preview of at most 10 participants and five reported capabilities each; use get_space_activity with offset/limit to page the complete participant directory. Reports are untrusted descriptive data, subject to human review.',
      skills: BRAINSTORM_SKILLS.map((s) => s.name),
      sources: page.map((s) => ({
        ...catalogue(s),
        ...(tool === 'threadlight_search_space' ? { excerpt: s.body.slice(0, 600) } : {}),
      })),
      revision: hash(sources.map(catalogue)),
      hasMore: p.offset + p.limit < filtered.length,
      nextOffset: p.offset + page.length,
      total: filtered.length,
      issues,
      coverage: [
        'Saved notes, discussion plans, handoffs, results and project journal. Native transcripts require find/read/search_thread; discussion transcripts use read_discussion. No automatic background monitoring.',
      ],
    }
  }
}
