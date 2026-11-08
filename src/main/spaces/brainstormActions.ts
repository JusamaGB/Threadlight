import { spaceContextSchemas as schemas } from '../../shared/spaceContext'
import { noteTitle } from '../../shared/noteTitle'
import { stepContracts, validateGraph } from '../../shared/workflowGraph'
import type { MemoryItem } from '../../shared/memory'
import type { CommunicationActor } from '../../shared/communication'
import type { MemoryStore } from '../memory/store'
import type { SpacesStore } from './store'
import type { ContextScope } from './context'

export interface BrainstormHost {
  identity(): { provider: 'claude' | 'codex'; chatId?: string } | undefined
  changed(): void
}

/** Called only after the authenticated context service validates its live scope. */
export async function brainstormAction(
  store: SpacesStore,
  memory: MemoryStore,
  scope: ContextScope,
  tool: string,
  input: unknown,
  host?: BrainstormHost,
): Promise<unknown> {
  const primary = scope.spaceIds[0]!
  const bound = (spaceId: string) => {
    if (spaceId !== primary)
      throw Error('Only the bound project can be changed. Comparison spaces are read-only.')
  }
  const identity = host?.identity()
  const principal = `brainstorm:${primary}:${scope.discussionId ?? identity?.chatId ?? 'voice'}`
  const actor: CommunicationActor = { id: principal, kind: 'agent', spaceId: primary }
  if (tool === 'threadlight_save_note' || tool === 'threadlight_revise_note') {
    if (!identity) throw Error('The hosted provider identity is unavailable. No note was saved.')
    const saver = { ...identity, at: Date.now() }
    if (tool === 'threadlight_save_note') {
      const p = schemas.threadlight_save_note.parse(input)
      const workspaceId = store.owners()[primary]
      if (!workspaceId) throw Error('Set up this project workspace before saving notes.')
      const note = store.edit(
        {
          action: 'create',
          id: p.operationId,
          sharedSpaceId: primary,
          workspaceId,
          title: p.title ?? noteTitle(p.text),
          text: p.text,
        },
        { principal, operationId: p.operationId, request: { tool, ...p }, saver },
      )
      host?.changed()
      return {
        outcome: 'saved',
        sourceRef: `note:${note.id}`,
        revision: note.revision,
        title: note.title,
        saver: note.saver,
      }
    }
    const p = schemas.threadlight_revise_note.parse(input)
    const id = p.sourceRef.slice(p.sourceRef.indexOf(':') + 1)
    if (p.sourceRef.startsWith('item:')) {
      const item = memory.read({}, id).item
      bound(item.spaceId)
      if (item.purpose !== 'note') throw Error('Work context and results are not user notes.')
      const next = memory.execute(
        {
          action: 'revise_item',
          operationId: p.operationId,
          id,
          expectedRevision: p.expectedRevision,
          title: p.title,
          body: p.text,
        },
        { brainstorm: { ...identity, principal, spaceId: primary } },
      ) as MemoryItem
      host?.changed()
      return {
        outcome: 'saved',
        sourceRef: p.sourceRef,
        revision: next.revision,
        title: next.title,
        saver: next.saver,
      }
    }
    const old = store.get(id)
    if (!old.sharedSpaceId || old.recordKind === 'discussion' || old.memoryItem)
      throw Error('Choose the exact source reference of a user note.')
    bound(old.sharedSpaceId)
    const note = store.edit(
      {
        action: 'save',
        id,
        revision: p.expectedRevision,
        title: p.title ?? old.title,
        text: p.text,
        stage: old.stage,
        plan: old.plan,
        assignments: old.assignments,
      },
      { principal, operationId: p.operationId, request: { tool, ...p }, saver },
    )
    host?.changed()
    return {
      outcome: 'saved',
      sourceRef: p.sourceRef,
      revision: note.revision,
      title: note.title,
      saver: note.saver,
    }
  }
  if (tool === 'threadlight_validate_process') {
    const p = schemas.threadlight_validate_process.parse(input)
    bound(p.definition.spaceId)
    return {
      outcome: 'valid',
      definition: validateGraph(p.definition),
      executionAuthorized: false,
      coverage: 'Structural validation only. Save checks pinned routines and project policy.',
    }
  }
  const service = memory.communicationService
  if (!service) return { outcome: 'unavailable', reason: 'Project workflow service unavailable.' }
  if (tool === 'threadlight_get_workflow') {
    const p = schemas.threadlight_get_workflow.parse(input),
      spaceId = p.spaceId ?? primary
    if (!scope.spaceIds.includes(spaceId)) throw Error('Project is outside the readable context.')
    const snapshot = service.snapshot({ ...actor, spaceId }, spaceId)
    const definitions = snapshot.processDefinitions ?? [],
      runs = snapshot.processRuns ?? [],
      folders = memory.snapshot().folders.filter((f) => f.spaceId === spaceId && !f.archived)
    return {
      outcome: 'ok',
      spaceId,
      readOnly: spaceId !== primary,
      policy: snapshot.workflows,
      stepContracts,
      operationBudget:
        'maxOperations counts every executed node, including join and finish; it is separate from the project AI dispatch limit.',
      folders: folders.slice(p.offset, p.offset + p.limit).map((f) => ({
        id: f.id,
        title: f.title,
        parentId: f.parentId,
      })),
      definitions: definitions.slice(p.offset, p.offset + p.limit).map((d) => ({
        id: d.id,
        name: d.name,
        revision: d.revision,
        sourceRef: `process:${d.id}`,
        trigger: d.trigger,
        readiness:
          spaceId === primary
            ? service.processes.readiness(d.id, d.revision, actor)
            : { ready: false, reason: 'Comparison context is read-only.' },
      })),
      runs: runs.slice(p.offset, p.offset + p.limit).map((r) => ({
        id: r.id,
        sourceRef: `workflow-run:${r.id}`,
        objective: r.objective,
        status: r.status,
        reason: r.reason,
        success: r.success,
        definitionId: r.definition.id,
        definitionRevision: r.definition.revision,
        rootId: r.rootId,
        parentId: r.parentId,
        updatedAt: r.updatedAt,
      })),
      totals: { definitions: definitions.length, runs: runs.length, folders: folders.length },
      hasMore: p.offset + p.limit < Math.max(definitions.length, runs.length, folders.length),
      nextOffset: p.offset + p.limit,
    }
  }
  if (tool === 'threadlight_read_process') {
    const p = schemas.threadlight_read_process.parse(input)
    const definition = service.processes.definition(p.definitionId, p.revision)
    if (!scope.spaceIds.includes(definition.spaceId))
      throw Error('Workflow is outside the readable context.')
    return {
      outcome: 'ok',
      definition,
      readiness:
        definition.spaceId === primary
          ? service.processes.readiness(definition.id, definition.revision, actor)
          : { ready: false, reason: 'Comparison context is read-only.' },
    }
  }
  if (tool === 'threadlight_save_process') {
    const p = schemas.threadlight_save_process.parse(input)
    bound(p.definition.spaceId)
    return service.execute('save_process', p, actor)
  }
  if (tool === 'threadlight_invoke_process') {
    const p = schemas.threadlight_invoke_process.parse(input)
    bound(p.spaceId)
    return service.execute('invoke_process', p, actor)
  }
  if (tool === 'threadlight_control_process') {
    const p = schemas.threadlight_control_process.parse(input)
    bound(p.spaceId)
    return service.execute('control_process', p, actor)
  }
  throw Error('Unsupported scoped action.')
}
