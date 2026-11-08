# Guided change workflow validation

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

Integration update, 29 October 2026: this work is now reconciled into primary
main with the connection setup fix. The record below describes the earlier
feature-branch validation. See [final reconciliation](WORKSPACE-RECONCILIATION-2026-10-29.md)
for combined checks and preservation evidence.

29 October 2026. Local feature branch `codex/guided-change-review` in
`C:/dev/threadlight-guided-change-review`; not released or merged into primary main.

## Automated evidence

- `vitest run test/changeWorkflow.test.ts test/settings.test.ts test/ipcSecurity.test.ts`:
  38 passing tests. Real temporary Git repositories verify partial hunks, full
  files, staged/untracked changes, binary additions, deletion, stale input,
  cross-chat rejection, existing branches, custom hooks, no-check acknowledgement,
  failing checks, candidate-only validation and replay after service restart.
  Assertions compare original HEAD, branch, working files and index bytes.
- `vitest run test/changeWorkflowChecks.test.ts`: one passing test checks invalid
  command names and timeout termination of the npm process and its descendant.
- `THREADLIGHT_UI_FOCUS=change-workflow node test/ui/providers.smoke.mjs`: passed.
  The production renderer enters from a thread diff badge, switches between two
  real checkout choices, selects a file,
  prepares the exact patch, validates, reviews and saves a real commit. Assertions
  verify the source HEAD/index and another writer's staged file are preserved.
  Teach appears in the bottom footer, Off retains essential effects, and the
  setting persists across reload. Provider data and IPC transport are fixtures;
  the Git service and repository operations are real.
- UI focuses `help-modes` and `spaces-library`: passed. Existing help timing,
  native hints, setting reload and the reconciled Workflow-tab explorer remain valid.
- Scoped ESLint, TypeScript checks, production build and plugin-package validation
  passed. Final formatting and diff checks recorded at commit preparation.

## Limits and remaining acceptance

No remote write, PR, merge, deployment, rebase or scheduled run was tested or
implemented by this change. Optional npm scripts run local project code and may
reuse dependencies through a removable junction; this is not a sandbox. Passing a
lint/build script does not establish that application tests ran. Whitespace-only
validation requires explicit acknowledgement before saving.

Multi-root checkout choices derive from the session's recorded roots, with final
root resolution in the panel-only main-process handler. The automated browser
flow switches between two real repositories through its fixture transport;
live provider-to-main-process root discovery still needs manual acceptance.
No real signing-key interaction was exercised. Custom commit hooks are blocked.
There is no recovery UI for reopening a saved plan yet; receipts support service
retries, and committed branches remain ordinary Git branches.

The existing primary app was not restarted. Desktop automation could read its
accessibility text but screenshot capture repeatedly timed out and clicks reported
unavailable geometry. The live-test observer reported stopped. Active chats are
still editing primary main, so its branch, index and files were left in place.

## Preservation

Main `602e1d2` and the separate Workflow-tab head `4201578` are both ancestors of
the feature build. Primary unfinished files were captured in `6c1fff9`, then
reconciled with the Workflow branch in `bf719d9` without moving primary main.
Later primary edits remain there and must be reconciled before integration.
The subsequent documentation-only main commit `b04e45f` is merged into this branch,
retaining the updated README/changelog and these feature-specific additions.
No force push, reset, clean or deletion of a worktree was performed.
