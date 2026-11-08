# Hosted Brainstorm integration contract

29 October 2026. Workflow implementation has NOT edited spaceContext.ts,
spaces/context.ts, contextServer.ts, agent/spaceContextTools.ts or brainstormPrompt.
The coordinating chat owns that wiring.

Backend is `memory.communicationService` (`CommunicationService`). Use its
`execute(action, arguments, actor)` with a server-created actor:
`{ id: 'brainstorm:<discussion-id>', kind: 'agent', spaceId: boundProjectId }`.
Never accept actor or authority from model arguments. Call your scope check before
each operation. Comparison spaces remain read-only; mutations must match the first
bound project. The communication service checks project policy independently.

Schemas are `processSchemas` in `src/shared/workflowGraph.ts`:

- `save_process`: `{operationId, expectedRevision, definition}`. Graph schemaVersion
  1, UUID id/spaceId, revision = expectedRevision + 1. This creates a draft or new
  immutable version; never executes. Each new version requires separate authorization;
  previously authorized pinned versions remain unchanged until expiry or revocation.
- `invoke_process`: `{operationId, spaceId, definitionId, revision, objective}`.
  Requires human authorization of this exact revision, automatic mode for agents,
  live unpaused project policy and authorized nested routines. Returns durable run.
- `control_process`: `{operationId, spaceId, runId, action: pause|resume|cancel}`.
  Root runs only. Resume revalidates authority; never retries uncertain operations.
- DO NOT expose `authorize_process` or `reconcile_process` to hosted Brainstorm;
  these reject non-human actors and belong to human UI.

Read through `service.snapshot(actor, boundProjectId)` (`get_workflow` via execute)
with optional `processDefinitions` and `processRuns`. Definitions contains latest
versions. Runs include immutable `definition`, pinned `routines`, objective,
status/reason, nodes, outputs, assignment IDs, timestamps and parent/root IDs.
Read historical definitions with `service.processes.definition(id, revision)` ONLY
after checking its spaceId is in the server-bound readable scope.

Validation is pure `validateGraph(raw)` and returns the normalized definition or
throws a useful error. Saving also resolves pinned routines, rejects recursive
calls and enforces same-project references. `stepContracts` lists output fields
and side-effect classification. No execution occurs during validation.

Readiness: `service.processes.readiness(definitionId, revision, actor)` returns
`{ready, reason}` under current policy/grants; does not execute. The method is being
implemented alongside runtime. An authorized revision is not a new permission to
run unrelated work. Runtime failures and unverified provider delivery remain real
states, not successful completion.

Workflow graph mutation schemas are separate from read-only tool arrays. Preserve
provider approval boundaries; do not blanket auto-approve new effectful tools.
