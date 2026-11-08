# Local change tracking implementation record

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

Date: 29 October 2026. Checkout: `C:/dev/threadlight`.

The reviewed specification is `../specs/LOCAL-CHANGE-TRACKING-SPEC.md`.
Its seven review amendments are incorporated in section 24. This record covers
the implementation in the working checkout, not a published release or completed
A01–A44 certification. Existing unrelated working-tree changes were preserved.

## Implemented behaviour

- A common local Git reader supplies current, staged and unstaged comparisons.
  Current means HEAD to working files; it does not union staged and unstaged edits.
  A current reversal can be zero while staged activity remains visible. Git does
  not need a remote account connection.
- One captured revision binds counts, files and patches. Opening an expired or
  forgotten revision returns unavailable rather than substituting later content.
  Shared reads coalesce per physical checkout and mode; invalidation during a
  running read schedules a new read. Linked worktrees remain independent.
- Git output supplies its own counts and patch. Capture validates mutable reads
  with bounded retries. External diff, textconv, fsmonitor and lazy fetching are
  disabled. Configured content filters and working-tree encoding conversions
  produce an unsupported result instead of running a conversion helper.
- Ordinary folders support explicit local recording, a saved baseline, pause,
  baseline reset and two-step Forget. Strict UTF-8 snapshots and evidence are
  persisted in SQLite plus content-addressed files outside the recorded root.
  Recording excludes secret, dependency, build, VCS and symlink paths by default.
  Paused history can still be inspected without persisting new source bytes.
- Baselines and retained evidence remain referenced during collection. A full
  storage budget pauses recording and keeps the baseline. Forget removes root
  history, invalidates retained comparisons and introduces a replay boundary.
- Provider event identities deduplicate replay. Failed or incomplete edits do not
  become applied changes. Conflicting unordered revisions stay partial. Available
  successful native changes supply correspondence evidence, not exclusive authorship.
- Contextual matching preserves a uniquely supported edit after lines are inserted
  above it. Repeated context and overwritten replacement pairs are withheld.
  Full captured evidence supplies counts independently of the 1,500-line preview
  limit. Fully read clean comparisons can establish exact zero; nonempty thread
  results remain partial under the available-recorded-operations scope.
- Successful native edit paths can identify multiple roots for one chat. Groups
  retain independent file identities even when filenames are identical. Unavailable
  groups are explicit. Different comparison baselines are shown per group without
  inventing a combined numeric total.
- The Changes viewer selects a source folder for Git modes and local history.
  Open resolves the captured file against its authorised root. The renderer and
  Agent can select published root IDs, not arbitrary filesystem paths.
- Badges, headings, empty states and details retain Partial, Stale, unavailable and
  limitation reasons. Per-metric coverage distinguishes unknown line counts from
  known file inventory. A partial zero no longer looks like a clean folder.
- Agent queries/navigation accept explicit worktree mode and root ID. Navigation
  acknowledges the actual loaded mode/root. Reading or navigation never enables
  recording. Checklist and card behaviour retain their distinct evidence scopes.

## Validation completed

The final focused backend run passed **49 tests across eight suites**:

`localChanges`, `threadDiff`, `threadUncommitted`, `gitCache`, `gitChanges`,
`gitDiff`, `changePresentation`, and `threadFileChanges`.

These include real repositories and linked worktrees; two repositories with the
same relative filename; partial/full commits; current/staged/unstaged reversal;
unborn repositories; blocked filter execution; immutable old-revision reads;
baseline restart and paused inspection; storage exhaustion; evidence replay and
Forget; shifted/repeated context; and counts beyond preview limits.

The coordinated Agent implementation passed **15 app-control tests**. Its isolated
Electron smoke exercised the real preload and panel, selected each of the four
comparison modes on a secondary root, and checked route state plus backend call
arguments. Existing card, draft, sender, revocation and pending-restart checks
passed in that smoke.

The focused `thread-diff` browser smoke passed for both providers. It covers root
groups, identical filenames, scoped Open, root selection in Git requests, explicit
mode headings, delayed responses from a previous mode, revision-bound Open, clean
and partial-zero badges, non-Git entry/controls, checklist links and a 240px panel.
Its IPC fixtures are synthetic; the Electron app-control smoke supplies the
additional real-preload/caller coverage.

Full TypeScript checking, focused ESLint, changed-source formatting, production
build and scoped `git diff --check` passed. Final renderer build:
`index-B-72AJVp.js`. No broad full-suite/CI result is claimed.

## Diff refresh follow-up in `codex/guided-change-review`

Refreshing the same comparison retains its file list and open patch while the
replacement is pending. A revision change no longer remounts the patch viewer.
The isolated `thread-diff` smoke delayed both the file-list and patch responses,
verified that the old patch stayed visible without a loading placeholder, and
checked that the same rendered diff node and wrap setting survived the update.
It also completed overlapping refreshes out of order, verified that the newer
result won, and checked that switching comparisons cleared the previous list.
Existing empty, unavailable, multi-root and provider-isolation checks passed.

The 20 focused comparison, stacked-diff and thread-diff tests passed, along with
typecheck, focused lint, formatting and the production build. The Settings
informational Git/file-changes section was removed in the same follow-up. README
and changelog reflect both changes. These results apply to this testing worktree;
they do not claim a restart or live-user acceptance of the updated application.

## Remaining full-release work

The implementation is useful locally, but it does **not** complete every planned
phase or all 44 acceptance scenarios. These remain explicit review/release items:

1. A durable file-version/span graph and richer structured root-binding registry.
   The present mapper validates limited endpoint correspondence; it does not prove
   continuous authorship across arbitrary formatters, missing observations or an
   unseen revert/reapply. Root discovery depends on available native edit evidence.
2. Configurable exclusion/include overrides and their newly-included-file policy
   boundaries. Current controls provide the fixed default policy plus recording,
   pause, baseline reset and Forget.
3. Complete Git conflict-stage, submodule, symlink and conversion diagnostics.
   Unsupported reads stay unavailable/partial, but the complete distinct-reason and
   metadata-only presentation matrix is not certified.
4. Full crash/fault-injection and retention acceptance: startup collection of orphan
   temporary/CAS files, finer unreferenced evidence aging, and storage-pressure
   eviction beyond the existing bounded capture/recording stop. Active dependencies
   are retained conservatively rather than discarded to satisfy an age target.
5. The captured screenshot reproduction as a permanent regression fixture, plus
   the remaining hostile path/race, source-epoch, unavailable-drive and migration
   combinations from A01–A44. Existing focused tests do not substitute for them.
6. Small/large/multi-worktree/slow-drive benchmarks, production diagnostics and the
   planned staged rollout/rollback controls. No performance percentile is claimed.

The full-release gate in specification section 21 therefore remains open. These
limits must stay visible in review; do not describe this build as complete authorship
tracking or as certification of the entire specification.

## Running application

The build is ready in the primary checkout. This chat did not restart the live
application. The coordinated reload chat confirmed the live test observer was
stopped, but the running overlay could not receive automated UI input and there
was no authorised external credential for its guarded restart endpoint. The user
must use Threadlight's existing Restart control when its active work is idle; no
process was force-killed and no authentication bypass was added.
