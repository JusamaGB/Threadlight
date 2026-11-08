# Agent-operated workflows

Implementation contract, 29 October 2026. Part of the ongoing Brainstorm test.

## Architecture and compatibility

The existing `Workflow` is project authority, not a process definition. Preserve
its records, roles, revisions, modes, pinned assignment inputs and acceptance
semantics. Add separately versioned graph definitions and durable runs. No legacy
record is inferred into an executable process. Missing new records means no new
automation. Definition edits use optimistic revision checks; runs pin a complete
definition and all routine revisions before execution.

One strict schema serves communication tools and the Workflow editor. Supported
node types have explicit configuration, JSON inputs/outputs and failure behavior.
Control edges form a DAG; repetition is an explicit bounded routine invocation,
never an arbitrary back edge. Branches select success/failure routes; joins wait
for all predecessors, including skipped routes. Routines pin versions, reject
recursive references and cap depth. Runtime work and output sizes are bounded.

## Authority and execution

Saving or opening a graph never executes it. Agents may edit within project scope;
only the human can grant execution of a particular graph revision. New revisions
need separate grants; existing version grants remain valid until expiry. Invocation checks current project policy as well as the
grant. Script grants bind executable, literal arguments, absolute working directory
and explicit environment; graph data cannot become shell syntax or permissions.
Scripts use no shell. This is local execution, not an OS security sandbox.

AI steps propose normal assignments through existing communication service and
supported delivery adapters. Saved output, returned text, submission and acceptance
remain distinct. AI steps wait for their configured completion milestone. Runtime
inputs are labelled untrusted data, not instructions. Every side effect receives
a stable operation ID and is journalled before the adapter is called. Restarted
in-progress operations become uncertain/Needs you; never blindly replay them.
Pausing prevents new work. Cancellation does not claim to undo external effects.

Runs retain objective, node state, output, error and operation identity for Handoffs.
Manual recovery must reconcile uncertain effects explicitly. All runtime checks
revalidate policy; editing processes does not add communication authority.

## Triggers and UI

Manual/agent invocation, exact assignment milestones and explicit-timezone cron
are supported triggers. New schedules are disabled until human authorization.
Missed schedule slots are skipped; overlapping runs are skipped. Polling uses
controlled clocks in tests and persisted slot identity; no startup catch-up burst.

Compact connected graph uses shared canvas math and existing header expansion.
Selected-node configuration, accessible contextual removal, add/connect/edit/save,
validation feedback and preserved drafts are required. Edges display persisted
control and data relations. A small number of editable defaults may seed drafts.

## Validation

Check strict schemas, cycles, data references, authorization, version pinning,
operation collisions, restart uncertainty, pause/cancel, bounded repair attempts,
parallel joins, nested routines and schedule/DST behavior with isolated stores.
Execute harmless script fixtures in temporary directories; isolate provider
delivery. Exercise actual tool callers and renderer at compact/expanded sizes.
Run focused checks, typechecks, build and diff checks. Never activate live jobs,
restart the user's app, refresh installed plugins or equate synthetic delivery
with native continuation. Record implemented limits and remaining live gates.
