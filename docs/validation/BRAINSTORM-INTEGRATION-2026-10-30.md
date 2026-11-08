# Hosted Brainstorm integration — 30 October 2026

Implemented in the primary checkout, coordinated with the workflow implementation
chat through `docs/specs/WORKFLOW-BRAINSTORM-INTEGRATION.md`. No live app restart,
installed-plugin refresh, provider inference or live workflow dispatch was used.

## Behavior and boundaries

- Both providers receive the same 16-tool scoped inventory and operating skills.
  Read tools, user-note writes, workflow drafts and authorized-runtime actions have
  explicit policy entries and accurate MCP read/effect annotations. Codex enables
  only these reviewed tools; Claude refuses shell, outside tools and worker calls.
- Hosted save/revise writes to Notes, attributes the actual hosted provider/chat,
  retains full text, preserves original IDs/history and publishes immutable files.
  Plugin notes are revised in their memory item. Work context/results stay separate.
- Durable note-operation receipts handle identical retry and reject changed reuse.
  Revisions prevent overwriting concurrent edits. Host-created identity is outside
  model arguments; strict schemas reject forged attribution.
- Workflow tools share the real communication/process runtime. Draft creation and
  validation cannot execute. Invocation requires the human grant for that revision
  and current automatic policy. Self-authorization/reconciliation are unavailable.
  Source catalogues expose real definitions, objectives, runs, assignments and
  results, preserving submitted versus accepted and uncertain execution states.
- Comparisons are read-only; closed scopes reject calls. After tool timeout the
  response does not falsely claim that no side effect occurred.

## Local evidence

After refreshing repository protocol assets, the package consistency check and
all 26 `memoryPlugins.test.ts` tests also passed (122 focused tests across the five
suites in total). Installed plugin caches were not changed.

Focused Vitest suites passed: `spaceContext.test.ts` (11), `spaces.test.ts` (31),
`memory.test.ts` (23), and `agentCodex.test.ts` (31): 96 tests total. These include
actual local stdio MCP proxy calls from both provider configurations, forged fields,
cross-project rejection, version conflicts, duplicate writes, the real workflow
runtime's draft/authorization/invoke path, run evidence, real filesystem note
exports and durable replay after reopening the note database. Native provider
processes are simulated; this is not live model acceptance evidence.

Node and web TypeScript checks, focused ESLint, diff whitespace checking and the
Electron Vite main/preload/renderer build passed. Generated plugin assets are
refreshed from canonical repository schemas; installed plugin caches are separate.

The first validation pass found an old discussion-only instruction in the actual
send path; it was updated and its existing real-caller test adjusted to verify
the new policy. Workflow test fixture schema errors were corrected locally.

## Live acceptance still needed

Follow-up contract alignment: workflow grants are keyed by definition ID and
revision. The hosted integration test now checks that saving v2 preserves v1
readiness while v2 remains unauthorized and cannot be invoked. The hosted tool
description and operating guide use this same rule.

Continue the existing Brainstorm test, one step at a time after a deliberate
restart: ask hosted Brainstorm to save a note, inspect Notes and its saved file,
then request an amendment. Repeat with the other provider. Request a small workflow
draft, inspect it in Workflow, and verify authorization/invocation/run visibility
before testing real AI handoffs, results and recovery. Do not infer readiness of
those live paths from synthetic provider tests.

Documentation updated: README, Unreleased changelog, Shared Memory guide,
`docs/BRAINSTORM-OPERATING-GUIDE.md`, this evidence, and the existing test working
record. Model/platform capability research and routing evaluation remain explicitly
future work; this integration supplies no invented capability verification.
