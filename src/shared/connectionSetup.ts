import { workflowSchema, type Workflow } from './communication'

/** Add only the reviewed chat's communication permission; preserve existing authority. */
export function connectionWorkflow(
  previous: Workflow | undefined,
  spaceId: string,
  target: string,
  model: string,
  ids: { workflow: string; participant: string },
  now: number,
): Workflow {
  const existing = previous?.participants.find((p) => p.target === target)
  const participant = existing
    ? { ...existing, communicate: true }
    : {
        id: ids.participant,
        target,
        model,
        role: 'Connected chat',
        communicate: true,
        requestWork: false,
      }
  return {
    ...(previous
      ? workflowSchema.strip().parse(previous)
      : {
          id: ids.workflow,
          spaceId,
          mode: 'manual',
          paused: true,
          maxConcurrent: 1,
          maxDispatches: 20,
          expiresAt: now + 4 * 3600000,
          recover: false,
          acceptBy: 'human',
        }),
    revision: (previous?.revision ?? 0) + 1,
    participants: existing
      ? previous!.participants.map((p) => (p.target === target ? participant : p))
      : [...(previous?.participants ?? []), participant],
  }
}
