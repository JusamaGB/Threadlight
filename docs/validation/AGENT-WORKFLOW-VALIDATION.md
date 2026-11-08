# Agent-operated workflow validation

Primary checkout, 29–30 October 2026. Same ongoing Brainstorm test; no push/PR,
worktree, installed-plugin refresh, regular-app restart or live workflow activation.

## Implemented boundaries

- One strict schemaVersion 1 graph drives communication tools, hosted Brainstorm
  integration and the visual editor. New custom, parallel and check/review drafts
  never execute on open/save. Revision conflicts preserve the draft.
- Immutable graph/routine versions, explicit grants per version, existing project
  authority and supported provider dispatch. Older authorized revisions remain
  unchanged; newer revisions need independent authorization.
- Context, shell-free local scripts, normal AI assignments, attributed evidence,
  conditions, joins, waits, exact-revision review, bounded routines and finish.
  Inputs/outputs have validated JSON contracts; unknown behavior fails closed.
- Durable operation/node/run state, concurrency and operation limits, cancellation,
  pause, no automatic replay after restart, and human evidence reconciliation.
  Interrupted script output is retained within bounds without marking completion.
- Manual/agent, exact assignment milestones and explicit-timezone restricted cron.
  Skipped missed/overlapping slots, DST minute deduplication and no startup burst.
- Run nodes share objective groups with assignments in Handoffs. Nested attempts,
  outputs and uncertainty remain inspectable. Existing canvas/header/window sizing
  primitives are reused; no competing expansion implementation.
- Legacy policies/assignments remain intact. New tables are additive. SQLite backup
  retains definitions and run evidence; restore revokes grants and holds unfinished
  work. No inferred migration makes legacy records executable.

## Evidence

- A combined focused pass ran 75 tests across workflowGraph, workflowIntegration,
  communication, communicationIntegration, handoffs and spaceContext. After later
  output/error-contract changes, the affected four-file integration pass ran 66
  tests successfully. These are overlapping preflights, not additive test counts.
- Final workflowGraph suite: 15 tests. Covers schema rejection, cycles, same-project
  scope, human authority, idempotency conflicts, version isolation, mixed check/
  correction/evidence branches, exhaustion at three attempts, actual parallel
  adapter concurrency/join, review waits, cancellation, restart uncertainty,
  explicit reconciliation, nested routine parameters/depth and controlled clocks.
- Real harmless Node commands run in temporary directories with explicit environment
  and cwd. A durable routine records actual exit codes 1 then 0 in two bounded
  attempts. Cwd escape and interrupted/timeout behavior are checked. These scripts
  do not operate on the live repository or launch Electron/provider jobs.
- workflowIntegration uses authenticated real MCP transport, disposable MemoryStore,
  actual result persistence/provenance, item acceptance, backup/restore and operation
  receipts. A communication test runs the AI step through real assignment proposal
  and supported delivery handling with a synthetic destination, waits for explicit
  submission, and retains separate acceptance.
- Both actual packaged Claude/Codex stdio bridges pass the focused workflow test:
  project-bound enrollment, saved versions, exact retry identity, invocation refusal
  before human authorization, successful authorized receipt, scope rejection and
  no exposed human authorization/reconciliation tools. No real enrollment occurs.
- The existing memory backup regression passes. Hosted Brainstorm's actual scoped
  proxy/configuration caller tests are included in spaceContext; the coordinating
  chat owns its provider wiring and operating guide.
- Final Handoffs projection coverage includes nested review attention and unique
  evidence counts (seven tests). The communication pump has a focused regression
  preserving exclusive scheduling while workflow adapters await.
- `THREADLIGHT_UI_FOCUS=workflow-graph` passes against the built renderer with
  isolated IPC/stores: draft/save, selection through navigation, real saved edge
  reconnection, keyboard removal, failed invocation before authorization, explicit
  isolated invocation, malformed-field refusal, retained drafts across external
  revision conflicts, explicit reload, and retained failed run details. No provider messages.
- Inspected compact and expanded screenshots plus Needs-you details in
  `outputs/workflow-proof/`. Initial review caught fixed edge-offset and cramped Fit
  behavior; edges now measure content-sized buttons and defaults fit the narrow
  canvas. Expanded screenshot uses the shared display-bounded sizing path.

## Local checks and remaining gates

Focused lint, renderer TypeScript, plugin consistency, production build and
`git diff --check` pass. The full Node project check currently reports only the
concurrently added `test/audioEnergy.test.ts` importing DOM-only renderer types
(`AnalyserNode`, `AudioNode`, `AudioContext`, TS6307). This was reported to the
coordinating chat; workflow work does not modify that unrelated test. An interim
concurrent SettingsView tooltip type error was corrected by its owning work.
Do not describe this as an entirely green repository-wide typecheck until that
separate Node issue is resolved.

Provider delivery in these tests is isolated/synthetic. Native continuation,
installed model/tool behavior, real script authorization and real schedules are
not claimed. See [workflow guide](../WORKFLOWS.md) for runtime limits, cron grammar,
local-user script access, policy-change holds and exact activation sequence.

Updated Unreleased, README, shared-memory/Codex guides, both packaged skills and
generated schemas, implementation/integration specs and this validation record.
The outcome is appended to the original ongoing working record, not a new product
exercise. User-led live acceptance remains the next checkpoint.
