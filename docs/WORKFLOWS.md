# Agent-operated workflows

Workflow edits reusable processes; Handoffs follows individual runs and assignments.
Brainstorm, authorized project coordinators and the editor share one versioned graph.
Existing roles, communication permissions, dispatch budgets, pinned assignment inputs
and acceptance policy still apply.

## Build and run

1. Configure roles and policy under **Workflow configuration**.
2. Ask Brainstorm for a process, or choose **New**, **Parallel** or **Checks**.
   Defaults are editable drafts. Checks requires an executable, working directory
   and result folder before saving/authorization.
3. Select steps to configure them; add steps and connections, choose condition
   routes, and bind outputs under **Inputs · position**. Example binding:
   `{"log":{"node":"check","field":"stdout"}}`. `$input` refers to invocation
   parameters. Dashed purple edges are data; solid edges are control.
   Right-click/Shift+F10 opens step actions. Fit, Reset, wheel, Shift+wheel,
   Ctrl+wheel and empty-space drag follow Handoffs navigation conventions.
4. Save and inspect the exact version. **Authorize manual** grants that revision
   until project authority expires. **Enable trigger** additionally enables its
   saved trigger; Authorize manual disables that trigger again. Agent invocation
   requires automatic project policy. Each routine version needs its own grant.
   Saving, validating, opening and editing never execute.
5. Follow the objective in Handoffs. Open its run for progress, evidence, assignments
   and routine attempts. Pause prevents new work. Cancel prevents new work and asks
   directly owned script processes to terminate; it does not undo effects,
   terminate arbitrary descendants or cancel delivered assignments.

Edits create immutable versions needing new grants. Existing version grants remain
valid until expiry or project policy changes, preserving active runs and pinned
routines. Policy revision changes hold old runs; they are not silently rebound to
new authority. Cancel/recreate under reviewed policy when necessary.

## Step contracts

| Step      | Behavior and outputs                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context   | Read exact same-project revisions. `items` is evidence, never authority.                                                                                                                      |
| Script    | Absolute executable, literal arguments, absolute project-root cwd, explicit environment and timeout. JSON inputs on stdin. Returns `success`, `exitCode`, `stdout`, `stderr`.                 |
| AI        | Normal assignment with permitted role, pinned inputs, output folder and acceptance criteria. Wait for `submitted` or `accepted`; return assignment/result/output references.                  |
| Save      | Attributed result evidence; returns `itemId`, `revision`. Neither submission nor acceptance is implied.                                                                                       |
| Condition | Compare one bound JSON scalar by exact equality; choose success/failure edges.                                                                                                                |
| Join      | Wait for all incoming paths to complete/be skipped; run when at least one incoming route is selected.                                                                                         |
| Wait      | Durable elapsed-time deadline; resumes only while app/run are active.                                                                                                                         |
| Review    | Bind `itemId` and `revision`; wait for that exact evidence revision's acceptance through existing item review.                                                                                |
| Routine   | Exact same-project version. Repeat unsuccessful execution up to `maxAttempts`; success exits, exhaustion needs human attention. Inputs pass through `$input`; each child run retains outputs. |
| Finish    | Explicit successful/unsuccessful execution outcome, separate from evidence acceptance.                                                                                                        |

Control edges form a DAG. Arbitrary cycles and executable routing expressions are
rejected. Repetition belongs in a bounded routine; recursion is rejected. Missing
required data on the selected path holds the run.

The repair pattern is a routine containing check → condition → either save →
review → successful finish, or scoped AI correction → unsuccessful finish. Invoke
it with three attempts. Correction submission and evidence acceptance are separate
checkpoints; exhaustion retains all child runs, assignments and failures.

## Triggers, limits and recovery

Triggers: manual/agent invocation, a specific project assignment's correlated turn
completion/submission/acceptance, and restricted five-field cron with explicit IANA
timezone. Cron supports `*`, `*/n`, integers and comma lists. All five fields must
match (day and weekday use AND). No ranges, names, seconds, arbitrary event
predicates or OS background scheduling. Missed slots and the startup/authorization
minute are skipped. Overlapping runs of the same definition are skipped without
catch-up. Repeated DST local-minute slots are deduplicated; nonexistent local
minutes do not run. New versions' triggers require new authorization. Assignment
milestones already reached at authorization are not backfilled.

Limits: 80 steps, 200 control edges, 128 KB definitions, four active root runs per
project, up to four concurrent script/node operations bounded by project policy,
200 total operations across a run and children, routine depth four, 320 routine
expansion visits, ten attempts per routine, five-minute scripts and 24-hour waits.
Invocation data is limited to 48 KB; adapter output to 60 KB. Existing provider
dispatch budgets/concurrency remain separately enforced.

Scripts run as the local user, **not in an OS sandbox**. Grants bind saved
executables/arguments/environment; executable contents are not copied or hashed.
Cwd is resolved against the project root, including symlinks. There is no inherited
environment or shell interpolation. Do not put secrets in persisted project graphs.
Dynamic input never becomes command arguments or permissions.

Operations are journalled before effects with stable IDs. Restart pauses unfinished
runs and marks interrupted operations uncertain, never replaying scripts or
dispatches automatically. Waiting assignments retain IDs. In Handoffs, inspect
external evidence, record confirmed completion with the required output fields,
then explicitly resume; otherwise cancel and prepare new work. Retry lost tool
responses with the same operation ID and input. Timeouts, interruptions and
oversized external output are uncertain, not ordinary check failures eligible for
automatic repetition.

Backup retains definitions/runs; restore revokes grants and holds unfinished work.
Restore is refused while current runs are unfinished. Legacy communication policies
and assignments are preserved without conversion; no process definitions means no
new automation.

## Extension and activation

`workflowGraph.ts` defines schema version 1, configuration, output fields, effect
classification and output validation. `ProcessAdapters` is the scoped execution
boundary; `ProcessNodeState` defines durable lifecycle/errors. Adding a type
requires schema, contracts, output validation, explicit engine handler, editor and
safety/behavior tests. Unknown types fail closed; adding a type never grants it
execution or provider authority. Adapter exceptions follow Needs-you/no-replay.

See [Brainstorm operation](BRAINSTORM-OPERATING-GUIDE.md),
[specification](specs/AGENT-WORKFLOW-SPEC.md) and
[validation](validation/AGENT-WORKFLOW-VALIDATION.md).

When the live test permits: launch the rebuilt primary app, refresh Claude/Codex
plugins through supported managers, reconnect and obtain normal human-approved
project access. Confirm process schemas, request a Brainstorm draft, inspect and
authorize a harmless exact version. Test one manual run before enabling a trigger.
Isolated checks do not prove installed-model behavior or native continuation. This
implementation session activates no jobs and does not restart/refresh live apps.
