# Attribution reconciliation and startup — 29 October 2026

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

This is an implementation iteration in the existing Spaces Brainstorm test.
Primary checkout: `C:/dev/threadlight`, local main based on `0897278`.
No commit, push, merge, worktree cleanup, model request or regular-app restart
was performed by this implementation chat. Concurrent Chats, header-tooltip and
composer work was preserved in place and included by the primary build.

## Evidence and implementation

The original chat's native, read-only Codex edit records identify three source
groups: the Threadlight repository, its test-record workspace, and the personal
finish-workspace skill folder. These are folders, not three chats. The retired
worktree explanation was not established for that screenshot.

`ThreadChanges` now retains source-specific recorded evidence even without a
folder baseline. `ThreadReconciliation` automatically searches bounded local Git
history for exact changed-line patch correspondence, distinguishes checkout
ancestry from separate branch history, and exposes commit/branch provenance.
Pending counts remain current comparisons; historical receipts are not added to
them. An exact after-text match can establish present non-Git content without
enabling local recording. Failed reads keep prior current files explicitly stale.

The read-only production-service probe of the original chat recovered all three
groups and matched four paths to `3e565610a72ca5e12b4e93b3588416c4fe40ff33` in main's
history. Other paths remained explicitly unmatched or pending, including concurrent
work added during this iteration. This probe did not mutate provider data, Git or
Threadlight's recording settings. It is evidence of local data recovery, not a
live-renderer acceptance result.

Removed checkout recovery uses a common Git directory previously observed during
this app session and a freshly verified surviving checkout. It does not infer
identity from path suffixes, repository names, or similar patches. Missing binding
evidence remains explicit. Current checkout availability is not fabricated from a
historical match. Search bounds are 32 edit folders, 24 files per root, and 64 local
commits per path; cache lifetime is 30 seconds with invalidation on Git changes.
Matching a patch does not prove commit authorship, all edits were committed, or
that the patch remains in current content after later edits.

Diagnostic stderr from the running primary build showed missing startup handlers
for settings, usage, Spaces, STT, Agent and app control. `WindowManager` previously
loaded the renderers in its constructor, before asynchronous service startup and
IPC registration in main completed. It now creates hidden windows first and loads
their renderers once registration and startup wiring finish. The Settings hook
also retries transient read failures, subscribes before requesting, and rejects
stale initial responses after a newer event. Settings displays a loading status
instead of a blank page. Claude usage reporting was left unchanged.

Spaces load errors are separate from operation errors. Any accepted newer snapshot
clears an obsolete loading error; an older failed initial request cannot restore
it. Unrelated failed operations remain visible.

## Verification

- Canonical plugin asset check passed.
- 71 focused tests passed across reconciliation, current attribution, thread diffs,
  refresh/coalescing, local comparisons, presentation and native window contracts.
  Real temporary Git cases cover separate branches, integration, later reversal,
  unrelated writers, unavailable folders, non-Git records, and removed worktrees.
- Production-renderer `spaces-recovery` passed: failed initial list, subsequent
  snapshot recovery, delayed old rejection, preserved action errors, and automatic
  Settings recovery with visible controls.
- Production-renderer `thread-diff` passed for existing badges, independent file
  ownership, grouped roots, scoped Open, refresh and unavailable/baseline behavior.
- Hidden native-window startup proof passed with wires off and on: deliberate
  service-initialization delay, first-load Codex usage within native bounds,
  populated Settings controls, and no missing-handler errors. It uses real
  WindowManager, preload and renderer with synthetic backend responses.
- TypeScript, focused lint and primary production build passed. Final whitespace
  and formatting checks are recorded with the working-record handoff.

Initial native-proof attempts were faulty: the Vite SSR entry name differed from
the requested output name, shared build output could disappear, and a temporary
copy lacked dependency resolution. Electron displayed error dialogs to Kris.
Those attempts were failures, not application failures. The proof now validates
its actual entry and dependency paths before launch, uses a private output copy,
resolves dependencies explicitly, routes fatal test errors to logs and process
exit, and keeps native windows hidden. Proof-process inspection found only the
regular app remaining. The regular application PID 24948 was preserved.

## Live acceptance remaining

Kris will relaunch the final primary build. Verify Codex usage appears without a
wires toggle, Settings has content, the existing Threadlight space opens without
a stale failure message, and the original chat shows its recovered source evidence.
Then resume the same connection/Brainstorm checkpoint. Builds and isolated tests
do not establish a live enrollment, successful provider turn, or release.

Final handoff: the removed-primary-checkout regression also passes (seven focused
reconciliation/refresh tests rerun after that correction). The grouped-history UI
check verifies both committed and separate-branch explanations; its screenshot was
visually inspected. Final changed-file formatting, scoped lint and diff whitespace
checks passed. The final primary production build completed successfully after the
last source correction. Existing regular PID 24948 was the only remaining root
Electron process at the final process inspection. Changes remain uncommitted.
