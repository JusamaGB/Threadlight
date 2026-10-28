import { agentBusy, type AgentResponse } from '../../shared/agent'
import {
  brainstormPrompt,
  spacesInput,
  type SpacesReply,
  type SpacesSnapshot,
} from '../../shared/spaces'
import type { Session } from '../../shared/types'
import { AgentService } from '../agent/agentService'
import type { MemoryStore } from '../memory/store'
import { SpacesStore } from './store'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  canonicalRoot,
  checkFolders,
  checkSpace,
  documentsRoot,
  spaceFolderName,
  digest,
  ideaDocuments,
  memoryDocuments,
  pathKey,
  SpaceDocuments,
  type DocumentDraft,
} from './documents'
import type { MigrationPreview, SpaceWorkspace } from '../../shared/spaces'
import type { MemorySpace } from '../../shared/memory'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SpaceContextService } from './context'
import { SpaceContextServer } from './contextServer'

export class SpacesService {
  readonly context: SpaceContextService
  readonly contextServer: SpaceContextServer
  private comparisons: string[] = []
  readonly agent: AgentService
  private activeId: string | null = null
  private switching = false
  private issue = ''
  readonly documents: SpaceDocuments
  constructor(
    readonly store: SpacesStore,
    private memory: () => MemoryStore | null,
    private sessions: () => Session[],
    options: ConstructorParameters<typeof AgentService>[0],
    private changed: (snapshot: SpacesSnapshot) => void,
    private knownRoots: () => string[] = () => sessions().map((s) => s.cwd),
  ) {
    this.context = new SpaceContextService(
      store,
      memory,
      sessions,
      options.threadReads,
      (id, cursor) => this.agent.read(id, cursor),
    )
    this.contextServer = new SpaceContextServer(this.context)
    this.documents = new SpaceDocuments(store)
    store.beforeSave = (idea) => {
      if (idea.workspaceId)
        this.documents.publish(
          idea.sharedSpaceId
            ? this.requireSpace(idea.sharedSpaceId)
            : this.requireWorkspace(idea.workspaceId),
          ideaDocuments(idea),
        )
    }
    const shared = memory()
    if (shared) {
      shared.executionContext = (spaceId, assignee) => {
        const workspace = this.requireSpace(spaceId)
        if (assignee) {
          const session = this.sessions().find((s) => s.id === assignee)
          if (
            !session ||
            !session.cwd ||
            pathKey(canonicalRoot(session.cwd)) !== pathKey(workspace.root)
          )
            throw new Error('The destination chat belongs to a different or unavailable workspace.')
        }
        const conflicts = this.documents.conflicts(workspace, memoryDocuments(shared, [spaceId]))
        if (conflicts.length) throw new Error(conflicts.join('\n'))
        return {
          workspaceId: workspace.id,
          root: workspace.root,
          documentsRoot: documentsRoot(workspace),
        }
      }
      shared.beforeCommit = () => this.syncMemory()
    }
    this.agent = new AgentService({
      ...options,
      appControl: undefined,
      communication: undefined,
      threadReads: undefined,
      spaceContext: () => {
        if (!this.activeId) throw Error('Open a space discussion first.')
        return this.contextServer.connect(this.activeId, this.comparisons)
      },
      communicationProject: () => (this.activeId ? this.projectFor(this.activeId) : undefined),
      onChange: (state) => {
        if (this.activeId && state.conversationId) {
          try {
            store.bind(this.activeId, state.conversationId)
          } catch {
            this.issue =
              'Could not link the brainstorm history. Keep this conversation open and copy important text.'
          }
        }
        options.onChange(state)
        this.publish()
      },
    })
  }
  private projectFor(id: string) {
    const idea = this.store.get(id)
    return (
      idea.workflowSpaceId ??
      (idea.prepared
        ? this.memory()
            ?.snapshot()
            .folders.find((f) => f.id === idea.prepared!.folderId)?.spaceId
        : undefined)
    )
  }
  start() {
    return this.contextServer.start()
  }
  snapshot(): SpacesSnapshot {
    const agent = this.agent.current
    return {
      locations: this.store.locations().map((location) => {
        try {
          checkSpace(this.store.workspace(location.workspaceId), location)
          return { ...location, ready: true, issue: null }
        } catch (error) {
          return { ...location, ready: false, issue: (error as Error).message }
        }
      }),
      workspaces: this.store.workspaces().map((w) => {
        const aliases = (w.aliases ?? []).filter((root) => {
          try {
            return pathKey(canonicalRoot(root)) === pathKey(w.root)
          } catch {
            return false
          }
        })
        try {
          checkFolders(w)
          return { ...w, aliases }
        } catch (error) {
          return { ...w, aliases, ready: false, issue: (error as Error).message }
        }
      }),
      spaceOwners: this.store.owners(),
      documents: this.store.documents(),
      ideas: this.store.all(),
      discussions: this.store.discussions(),
      activeId: this.activeId,
      agent: this.issue ? { ...agent, error: this.issue } : agent,
    }
  }
  private publish() {
    this.changed(this.snapshot())
  }
  requireWorkspace(id: string | null | undefined): SpaceWorkspace {
    if (!id)
      throw new Error(
        'Set up Shared Spaces and assign this material to a workspace before starting Agent work.',
      )
    const workspace = this.store.workspace(id)
    if (!workspace.ready) throw new Error('Complete Shared Spaces setup for this workspace first.')
    checkFolders(workspace)
    return workspace
  }
  private syncMemory() {
    const memory = this.memory()
    if (!memory) return
    const owners = this.store.owners()
    for (const [spaceId, workspaceId] of Object.entries(owners)) {
      const workspace = this.store.workspace(workspaceId)
      const docs = memoryDocuments(memory, [spaceId])
      // Only changed source documents need publishing; an offline unrelated workspace must not block work elsewhere.
      const heads = this.store.documents().filter((d) => d.workspaceId === workspace.id)
      const changed = docs.filter(
        (d) => !heads.some((h) => h.id === d.id && h.sourceHash === digest(d.body)),
      )
      if (changed.length) this.documents.publish(this.requireSpace(spaceId), changed)
    }
  }
  private requireSpace(spaceId: string) {
    const location = this.store.locations().find((l) => l.spaceId === spaceId)
    return location
      ? checkSpace(this.store.workspace(location.workspaceId), location)
      : this.requireWorkspace(this.store.owners()[spaceId])
  }
  private createSpace(
    input: Extract<import('../../shared/spaces').SpacesInput, { action: 'create_space' }>,
  ) {
    if (
      !this.knownRoots().some(
        (r) => pathKey(r.replace(/^(claude|codex):/, '')) === pathKey(input.root),
      ) &&
      !this.store
        .workspaces()
        .some((w) => [w.root, ...(w.aliases ?? [])].some((r) => pathKey(r) === pathKey(input.root)))
    )
      throw new Error('Choose a workspace known to Threadlight.')
    const root = canonicalRoot(input.root)
    const directory = spaceFolderName(input.title)
    const existing = this.store.locations().find((l) => l.requestId === input.id)
    let workspace = this.store.workspaces().find((w) => pathKey(w.root) === pathKey(root))
    if (
      !existing &&
      this.store
        .locations()
        .some((l) => l.workspaceId === workspace?.id && l.directory === directory)
    )
      throw new Error(
        'A shared space with that folder name is already registered in this workspace.',
      )
    if (
      existing &&
      (existing.workspaceId !== workspace?.id ||
        existing.title !== input.title ||
        existing.directory !== directory)
    )
      throw new Error('This creation request was already used for another space.')
    if (!existing && existsSync(join(root, 'shared-spaces', directory)))
      throw new Error(
        'A folder with that space name already exists. Choose another name; existing files will be kept.',
      )
    const memory = this.memory()
    if (!memory) throw new Error('Shared context storage is unavailable.')
    workspace ??= {
      id: randomUUID(),
      root,
      name: basename(root),
      ready: true,
      issue: null,
      layout: 'named',
    }
    checkFolders({ ...workspace, layout: 'named' }, true)
    workspace.aliases = [...new Set([...(workspace.aliases ?? []), input.root, root])]
    this.store.putWorkspace(workspace)
    const space = memory.execute({
      action: 'create_space',
      operationId: input.id,
      title: input.title,
      description: 'Shared context, notes, plans, handoffs and results.',
    }) as MemorySpace
    const location = existing ?? {
      spaceId: space.id,
      workspaceId: workspace.id,
      requestId: input.id,
      title: input.title,
      directory,
    }
    this.store.putLocation(location)
    checkSpace(workspace, location, true)
    this.store.assign(workspace.id, [], [space.id])
    for (const title of ['Plans', 'Handoffs', 'Results'])
      memory.execute({
        action: 'ensure_folder',
        operationId: `${input.id.slice(0, 24)}${digest(input.id + title).slice(0, 12)}`,
        spaceId: space.id,
        title,
        description: `${title} for ${input.title}.`,
        reason: 'Shared space creation.',
      })
    return space.id
  }
  private setup(root: string) {
    if (
      !this.knownRoots().some(
        (r) => pathKey(r.replace(/^(claude|codex):/, '')) === pathKey(root),
      ) &&
      !this.store.workspaces().some((w) => pathKey(w.root) === pathKey(root))
    )
      throw new Error('Choose a workspace from the thread view.')
    const canonical = canonicalRoot(root)
    const workspace = this.store
      .workspaces()
      .find((w) => pathKey(w.root) === pathKey(canonical)) ?? {
      id: randomUUID(),
      root: canonical,
      name: basename(canonical),
      ready: false,
      issue: null,
    }
    checkFolders(workspace, true)
    workspace.aliases = [...new Set([...(workspace.aliases ?? []), root, canonical])]
    this.store.putWorkspace(workspace)
    const memory = this.memory()
    if (!memory)
      throw new Error('Shared context storage is unavailable. Setup can be retried safely.')
    const operation = (name: string) => {
      const hash = digest(workspace.id + ':' + name)
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
    }
    const space = memory.execute({
      action: 'create_space',
      operationId: workspace.id,
      title: workspace.name.slice(0, 80),
      description: 'Workspace collaboration, plans, handoffs and results.',
    }) as MemorySpace
    for (const title of ['Plans', 'Handoffs', 'Results'])
      memory.execute({
        action: 'ensure_folder',
        operationId: operation(title),
        spaceId: space.id,
        title,
        description: `${title} for this workspace.`,
        reason: 'Shared Spaces setup.',
      })
    this.store.putWorkspace({ ...workspace, ready: true })
    this.store.assign(workspace.id, [], [space.id])
  }
  private migration(input: { workspaceId: string; ideaIds: string[]; spaceIds: string[] }): {
    preview: MigrationPreview
    workspace: SpaceWorkspace
    docs: DocumentDraft[]
  } {
    const workspace = this.requireWorkspace(input.workspaceId),
      memory = this.memory()
    if (!memory) throw new Error('Shared context is unavailable.')
    const owners = this.store.owners(),
      snapshot = memory.snapshot()
    const ideas = [...new Set(input.ideaIds)].map((id) => this.store.get(id))
    const conflicts: string[] = []
    if (!ideas.length && !input.spaceIds.length)
      conflicts.push('Choose existing material to assign.')
    for (const idea of ideas) {
      if (idea.workspaceId && idea.workspaceId !== workspace.id)
        conflicts.push(`${idea.title} already belongs to another workspace.`)
      if (idea.id === this.activeId && agentBusy(this.agent.current))
        conflicts.push(`Finish or stop the brainstorm for ${idea.title} before moving it.`)
      if (idea.prepared) {
        const source = snapshot.folders.find((f) => f.id === idea.prepared!.folderId)?.spaceId
        if (!source || (owners[source] !== workspace.id && !input.spaceIds.includes(source)))
          conflicts.push(
            `Include the shared space containing ${idea.title}'s prepared assignments.`,
          )
      }
    }
    for (const id of input.spaceIds) {
      if (!snapshot.spaces.some((s) => s.id === id))
        conflicts.push('A selected shared space is unavailable.')
      if (owners[id] && owners[id] !== workspace.id)
        conflicts.push('A selected shared space belongs to another workspace.')
      if (
        snapshot.tasks.some(
          (t) =>
            t.spaceId === id &&
            (['queued', 'dispatching', 'accepted', 'unknown'].includes(t.state) ||
              ['dispatching', 'unknown'].includes(t.deliveryState ?? '')),
        )
      )
        conflicts.push(
          'Pause queued assignments and resolve running or uncertain deliveries before migration.',
        )
    }
    const docs = [
      ...ideas.flatMap((i) =>
        ideaDocuments({
          ...i,
          workspaceId: workspace.id,
          revision: i.revision + (i.workspaceId ? 0 : 1),
        }),
      ),
      ...memoryDocuments(memory, input.spaceIds),
    ]
    conflicts.push(...this.documents.conflicts(workspace, docs))
    const files = docs.map((d) => this.documents.target(workspace, d))
    const token = digest(
      JSON.stringify({
        workspace,
        ideas,
        spaceIds: input.spaceIds,
        docs,
        conflicts,
        owners,
        active:
          this.activeId === null
            ? null
            : { id: this.activeId, busy: agentBusy(this.agent.current) },
      }),
    )
    return { preview: { token, files, conflicts }, workspace, docs }
  }
  async request(value: unknown): Promise<SpacesReply> {
    try {
      const input = spacesInput.parse(value)
      if (input.action === 'attach_material') {
        if (input.id === this.activeId)
          throw Error('Close the active discussion before assigning it.')
        const record = this.store.get(input.id),
          workspace = this.requireSpace(input.spaceId)
        if (
          record.prepared &&
          !this.memory()
            ?.snapshot()
            .folders.some((f) => f.id === record.prepared!.folderId && f.spaceId === input.spaceId)
        )
          throw Error('Choose the space containing this material’s prepared handoffs.')
        this.store.attach(input.id, input.spaceId, workspace.id, input.revision)
        this.publish()
        return { ok: true, snapshot: this.snapshot() }
      }
      if (input.action === 'create_discussion') {
        const workspace = this.requireSpace(input.spaceId)
        const discussion = this.store.discussion(input, workspace.id)
        this.publish()
        return { ok: true, snapshot: this.snapshot(), discussionId: discussion.id }
      }
      if (input.action === 'context' || input.action === 'source') {
        if (input.action === 'source')
          return {
            ok: true,
            snapshot: this.snapshot(),
            context: await this.contextServer.inspect(
              input.id,
              input.sourceRef,
              input.revision,
              input.offset,
            ),
          }
        const scope = this.context.open(input.id)
        try {
          const context = await this.context.call(scope, 'threadlight_get_space_context', {
            limit: 50,
          })
          return { ok: true, snapshot: this.snapshot(), context }
        } finally {
          this.context.close(scope)
        }
      }
      if (input.action === 'create_space') {
        const spaceId = this.createSpace(input)
        this.publish()
        return { ok: true, snapshot: this.snapshot(), spaceId }
      }
      if (input.action === 'setup') this.setup(input.root)
      else if (input.action === 'migration_preview' || input.action === 'migrate') {
        const result = this.migration(input)
        if (input.action === 'migration_preview')
          return { ok: true, snapshot: this.snapshot(), migration: result.preview }
        if (result.preview.token !== input.token)
          throw new Error(
            'Migration changed since preview. Review a fresh preview before continuing.',
          )
        if (result.preview.conflicts.length) throw new Error(result.preview.conflicts.join('\n'))
        this.documents.publish(result.workspace, result.docs)
        this.store.assign(input.workspaceId, input.ideaIds, input.spaceIds)
      } else if (input.action === 'create' || input.action === 'save') {
        if (input.action === 'save' && input.noteIds) {
          const discussion = this.store.get(input.id)
          if (discussion.recordKind !== 'discussion')
            throw Error('Only discussions can link notes.')
          for (const id of input.noteIds) {
            const note = this.store.get(id)
            if (
              note.recordKind === 'discussion' ||
              !discussion.sharedSpaceId ||
              note.sharedSpaceId !== discussion.sharedSpaceId
            )
              throw Error('Choose notes belonging to this discussion’s space.')
          }
        }
        if (input.action === 'create' && input.sharedSpaceId) {
          const workspace = this.requireSpace(input.sharedSpaceId)
          if (workspace.id !== input.workspaceId)
            throw new Error('Choose a space in this workspace.')
        }
        if (input.action === 'create' && input.workspaceId && !input.sharedSpaceId)
          this.requireWorkspace(input.workspaceId)
        if (input.action === 'save' && input.workflowSpaceId) {
          const idea = this.store.get(input.id)
          if (
            this.store.owners()[input.workflowSpaceId] !== idea.workspaceId ||
            (idea.sharedSpaceId && idea.sharedSpaceId !== input.workflowSpaceId)
          )
            throw new Error('Choose a workflow in this note’s workspace.')
          if (!this.memory()?.communicationService?.workflow(input.workflowSpaceId))
            throw new Error('Configure this project workflow first.')
        }
        this.store.edit(input)
      } else if (input.action === 'prepare') {
        const idea = this.store.get(input.id),
          memory = this.memory()
        if (!memory) throw new Error('Handoffs are unavailable. Your plan is still saved.')
        const workspace = idea.sharedSpaceId
          ? this.requireSpace(idea.sharedSpaceId)
          : this.requireWorkspace(idea.workspaceId)
        if (idea.revision !== input.revision)
          throw new Error('The plan changed. Reopen it before preparing assignments.')
        if (!idea.plan.trim() || !idea.assignments.length)
          throw new Error('Save a plan and at least one assignment first.')
        if (idea.prepared && idea.prepared.folderId !== input.folderId)
          throw new Error('These assignments already have a shared destination.')
        if (idea.prepared?.taskIds.length === idea.assignments.length)
          return { ok: true, snapshot: this.snapshot() }
        const folder = memory
          .snapshot()
          .folders.find((f) => f.id === input.folderId && !f.archived && !f.redirectId)
        if (!folder) throw new Error('Choose an available shared folder in Handoffs.')
        if (
          this.store.owners()[folder.spaceId] !== workspace.id ||
          (idea.sharedSpaceId && idea.sharedSpaceId !== folder.spaceId)
        )
          throw new Error('Choose an output folder belonging to this note’s workspace.')
        this.documents.publish(workspace, ideaDocuments(idea))
        for (const assignment of idea.assignments) {
          if (
            !this.sessions().some(
              (s) =>
                s.id === assignment.assignee && (s.provider ?? 'claude') === assignment.provider,
            )
          )
            throw new Error(
              `Choose an available ${assignment.provider === 'codex' ? 'Codex' : 'Claude'} chat for ${assignment.title}.`,
            )
          memory.executionContext(folder.spaceId, assignment.assignee)
        }
        // Freeze the reviewed payload before the first write. Retrying uses identical operation IDs.
        this.store.prepared(idea.id, { folderId: input.folderId, taskIds: [] })
        let taskIds: string[]
        try {
          taskIds = memory.prepareHandoff(
            {
              action: 'create_item',
              operationId: idea.id,
              folderId: folder.id,
              title: idea.title,
              kind: 'note',
              body: `Note\n${idea.text}\n\nReviewed plan (revision ${idea.revision})\n${idea.plan}`,
            },
            idea.assignments.map((a) => ({
              action: 'create_task',
              operationId: a.id,
              folderId: folder.id,
              title: a.title,
              body: a.rationale
                ? `${a.brief}\n\nAssignment rationale (reviewed with the plan):\n${a.rationale}`
                : a.brief,
              assignee: a.assignee,
            })),
          )
        } catch (error) {
          if (!idea.prepared) this.store.prepared(idea.id, null)
          throw error
        }
        this.store.prepared(idea.id, { folderId: folder.id, taskIds })
      } else if (input.action === 'chat' || input.action === 'resume') {
        if (this.switching || agentBusy(this.agent.current))
          throw new Error('Finish or stop the current brainstorm turn first.')
        this.switching = true
        try {
          const idea = this.store.get(input.id)
          const workspace = idea.sharedSpaceId
            ? this.requireSpace(idea.sharedSpaceId)
            : this.requireWorkspace(idea.workspaceId)
          this.documents.publish(workspace, ideaDocuments(idea))
          if (idea.stage !== 'brainstorm')
            throw new Error('Start a discussion in Brainstorm first.')
          if (input.action === 'resume' && !idea.conversationId)
            throw new Error('This note has no saved discussion yet.')
          const comparisons = input.action === 'chat' ? input.compareSpaceIds : []
          for (const id of comparisons) this.requireSpace(id)
          if (
            this.activeId !== idea.id ||
            this.agent.current.ended ||
            input.action === 'resume' ||
            JSON.stringify(comparisons) !== JSON.stringify(this.comparisons)
          ) {
            this.activeId = null
            await this.agent.close()
            this.activeId = idea.id
            this.comparisons = comparisons
            if (idea.conversationId) {
              const resumed = await this.agent.resume(idea.conversationId)
              if (!resumed.ok) {
                this.activeId = null
                throw new Error(resumed.reason)
              }
            }
          }
          if (input.action === 'resume') return { ok: true, snapshot: this.snapshot() }
          const scope = this.context.open(idea.id, this.comparisons)
          let overview: unknown
          try {
            overview = await this.context.call(scope, 'threadlight_get_space_context', {
              limit: 20,
            })
          } finally {
            this.context.close(scope)
          }
          const encodedOverview = JSON.stringify(overview)
          const boundedOverview =
            encodedOverview.length <= 12000
              ? encodedOverview
              : JSON.stringify({
                  outcome: 'partial',
                  spaceIds: scope.spaceIds,
                  reason:
                    'Large space. Retrieve paginated context with threadlight_get_space_context.',
                })
          const prompt = `Bound discussion: ${idea.id}. This turn is read, track and propose only. Comparison spaces explicitly selected by the user for this request: ${JSON.stringify(this.comparisons)}.\n<space-context>${boundedOverview}</space-context>\n${brainstormPrompt(idea, input.text)}`
          const sent = await this.agent.send(prompt, input.text)
          if (!sent.ok) throw new Error(sent.reason)
        } finally {
          this.switching = false
        }
      } else if (input.action === 'read') {
        const idea = this.store.get(input.id)
        if (this.activeId === idea.id && !input.cursor)
          return { ok: true, snapshot: this.snapshot(), items: this.agent.current.items }
        if (!idea.conversationId) return { ok: true, snapshot: this.snapshot(), items: [] }
        const history = await this.agent.read(idea.conversationId, input.cursor)
        if (history.error) throw new Error(history.error)
        return {
          ok: true,
          snapshot: this.snapshot(),
          items: history.items,
          historyCursor: history.cursor,
        }
      } else if (input.action === 'stop') {
        if (input.id !== this.activeId) throw new Error('This brainstorm is not running.')
        const result = await this.agent.interrupt()
        if (!result.ok) throw new Error(result.reason)
      }
      this.publish()
      return { ok: true, snapshot: this.snapshot() }
    } catch (error) {
      try {
        this.publish()
      } catch {
        /* Keep a readable error if storage itself is unavailable. */
      }
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Shared Spaces is unavailable.',
      }
    }
  }
  respond(ideaId: string, requestId: string, response: AgentResponse) {
    if (ideaId !== this.activeId)
      return { ok: false as const, reason: 'This request belongs to another brainstorm.' }
    return this.agent.respond(requestId, response)
  }
  async close() {
    this.contextServer.close()
    await this.agent.close()
    await this.agent.store.flush()
    this.store.close()
  }
}
