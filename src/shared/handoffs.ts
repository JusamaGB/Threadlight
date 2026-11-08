import type { MemorySnapshot } from './memory'
import type { CommunicationSnapshot } from './communication'
import type { SpaceIdea } from './spaces'
import type { Session } from './types'

export interface WorkNode {
  id: string
  kind: 'task' | 'assignment' | 'process'
  title: string
  group: string
  groupTitle: string
  assignee: string
  status: string
  attention: boolean
  reason: string
  outputs: number
  destination: string
  sourceId?: string
}
export interface WorkEdge {
  from: string
  to: string
  kind: 'dependency' | 'delegation'
}
export function handoffGraph(
  spaceId: string,
  memory: MemorySnapshot,
  communication: CommunicationSnapshot | null,
  discussions: SpaceIdea[],
  sessions: Session[],
) {
  const nodes: WorkNode[] = [],
    edges: WorkEdge[] = []
  const who = (id: string) => {
    const session = sessions.find((s) => s.id === id)
    return session ? `${session.title} · ${session.provider ?? 'claude'}` : id || 'Chat unavailable'
  }
  const destination = (id: string) =>
    memory.folders.find((f) => f.spaceId === spaceId && f.id === id)?.title ??
    'Destination unavailable'
  for (const run of communication?.processRuns?.filter(
    (r) => r.spaceId === spaceId && !r.parentId,
  ) ?? []) {
    const states = Object.values(run.nodes)
    const reviewing = communication?.processRuns?.some(
      (r) =>
        r.spaceId === spaceId &&
        r.rootId === run.id &&
        r.definition.nodes.some((n) => n.type === 'review' && r.nodes[n.id]?.status === 'waiting'),
    )
    nodes.push({
      id: run.id,
      kind: 'process',
      title: run.definition.name,
      group: `objective:${run.id}`,
      groupTitle: run.objective,
      assignee: 'Workflow',
      status:
        reviewing && run.status === 'running'
          ? 'Awaiting review'
          : run.status === 'needs_you'
            ? 'Needs you'
            : run.status === 'completed'
              ? 'Run complete'
              : run.status,
      attention: !!reviewing || ['needs_you', 'paused'].includes(run.status),
      reason: run.reason,
      outputs: new Set(
        communication?.processRuns
          ?.filter((r) => r.spaceId === spaceId && r.rootId === run.id)
          .flatMap((r) => Object.values(r.nodes))
          .map((n) => n.output?.itemId)
          .filter((id) => typeof id === 'string'),
      ).size,
      destination: `${states.filter((n) => n.status === 'completed').length}/${states.length} steps · v${run.definition.revision}`,
    })
  }
  for (const t of memory.tasks.filter((t) => t.spaceId === spaceId)) {
    const sources = discussions.filter(
      (d) =>
        (d.sharedSpaceId === spaceId ||
          d.workflowSpaceId === spaceId ||
          memory.folders.some((f) => f.id === d.prepared?.folderId && f.spaceId === spaceId)) &&
        d.prepared?.taskIds.includes(t.id),
    )
    const source = sources.length === 1 ? sources[0] : undefined
    const status =
      t.deliveryState === 'unknown' || t.state === 'unknown'
        ? 'Delivery unknown'
        : ({
            accepted: 'Delivery accepted',
            completed: 'Turn finished',
            resolved: 'Result accepted',
            submitted: 'Submitted · review',
            draft: 'Awaiting authorization',
            queued: 'Queued',
            dispatching: 'Dispatching',
            blocked: 'Blocked',
            paused: 'Paused',
            cancelled: 'Cancelled',
          }[t.state] ?? t.state)
    nodes.push({
      id: t.id,
      kind: 'task',
      title: t.title,
      group: source?.id ?? 'ungrouped',
      groupTitle: source?.title ?? 'Ungrouped',
      sourceId: source?.id,
      assignee: who(t.assignee),
      status,
      attention:
        ['draft', 'blocked', 'unknown', 'submitted', 'paused'].includes(t.state) ||
        t.deliveryState === 'unknown',
      reason: t.reason,
      outputs: t.outputs.length,
      destination: destination(t.folderId),
    })
    if (t.originTaskId) edges.push({ from: t.originTaskId, to: t.id, kind: 'delegation' })
  }
  for (const a of communication?.assignments.filter((a) => a.spaceId === spaceId) ?? []) {
    const w = communication?.workflows.find((w) => w.spaceId === spaceId)
    const target = w?.participants.find((p) => p.id === a.roleId)?.target ?? ''
    const message = communication?.messages.find(
      (m) => m.id === a.messageId && m.spaceId === spaceId,
    )
    const unknown =
      communication?.assignmentDeliveryPhases?.[a.id]?.includes('unknown') ||
      message?.deliveries.some((d) => d.phase === 'unknown')
    const waiting = communication?.questions.some(
      (q) =>
        q.spaceId === spaceId &&
        q.state === 'pending' &&
        q.audience === 'human' &&
        (q.taskId === a.id || (!!a.messageId && q.originMessageId === a.messageId)),
    )
    const status = unknown
      ? 'Delivery unknown'
      : waiting
        ? 'Needs your input'
        : a.state === 'accepted'
          ? 'Result accepted'
          : a.state === 'submitted'
            ? 'Submitted · review'
            : a.state === 'planned'
              ? 'Awaiting authorization'
              : a.state
    nodes.push({
      id: a.id,
      kind: 'assignment',
      title: a.title,
      group: a.objective ? `objective:${a.objective.id}` : 'ungrouped',
      groupTitle: a.objective?.title ?? 'Ungrouped',
      assignee: who(target),
      status,
      attention: !!unknown || !!waiting || ['planned', 'blocked', 'submitted'].includes(a.state),
      reason: a.reason,
      outputs: a.outputs?.length ?? 0,
      destination: destination(a.folderId),
    })
    a.dependsOn.forEach((from) => edges.push({ from, to: a.id, kind: 'dependency' }))
  }
  return {
    nodes,
    edges: edges.filter(
      (e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to),
    ),
  }
}
