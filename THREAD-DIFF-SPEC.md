# Thread-specific changes

The row's diff badge, hover, heading, file list and opened patch all describe the
same provider-qualified chat. They show only current uncommitted Git changes that
match that thread's recorded edits. Committing those changes clears the badge on
the next refresh (within five seconds). Partial commits leave the matching pending
lines visible. Right-clicking a thread offers Worktree diff:
all staged, unstaged and untracked changes against HEAD in its detected Git root.
Different worktrees of the same repository remain separate. Wire-specific menus
remain a later feature.

## Evidence and ownership

Codex changes come from completed native `fileChange` projection items, in rollout
order. Failed/in-progress items, prose, command source and unrelated chat IDs are
not treated as changes. Claude changes come from successful Edit, MultiEdit, Write
and NotebookEdit tool/result pairs in that chat's transcript. Full original-file
preimages and structured patches are used where available. Pending/failed calls
and subagent sidechains do not count as the parent chat's edits.

The historical ledger supplies ownership evidence; Git supplies the pending diff.
Recorded line positions and text must match current added/removed lines. Two chats
can therefore present different changes to the same file in the same worktree.
Shell commands and formatters are included only when the provider records their
mutations as file-change evidence; filesystem activity alone is not attribution.

## Combining changes

Known original-line identities and recorded contexts combine successive patches
into a net ownership record. Both that net record and intermediate edits are
matched against HEAD-to-working-tree and HEAD-to-index patches, without counting
the same staged/working edit twice. Staged edits survive a later working-file
reversal. Untracked text files are read only for recorded paths. Another writer's
replacement does not inherit ownership merely by removing the same original line.

Attribution is conservative: missing line positions, moved lines, metadata-only
changes and ambiguous history can omit edits rather than assign another writer's
work to this chat. Matching text and positions is evidence, not proof of causality
when a later writer repeats the exact same edit. No repository-total fallback is
used. Missing history or failed Git reads return unavailable; a successfully read
clean checkout clears even an incomplete historical ledger. Zero-file summaries
never display a badge.

The cache is independent per chat and refreshes at most every five seconds. Git
snapshots are shared briefly between chats with the same worktree root.
Claude transcripts replay incrementally by byte, retaining incomplete UTF-8/JSON
tails and resetting on truncation/replacement. Codex projection reads are bounded
by record count and payload size. Large content/history limits are explicit in
the resulting coverage flag. Visible snapshot rows and expanded tree nodes share
the cached summary; voice/search-only catalogue entries do not schedule replays.

## UI and access

Reuse the existing ChangesView, FileRow and FileDiffView with their current styles
and interactions. This changes their data scope; it does not introduce another
diff list or page design.

Nonzero badges open Thread diff. The thread context menu offers Worktree diff,
disabled when its Git worktree is unknown. Both scopes reuse the existing file list
and file viewer with distinct headings and empty/unavailable messages. A worktree
diff remains available when the thread's recorded history is missing. Thread
revision stamps refresh an open file independently of
worktree totals. Checklist links open that same thread-recorded file diff; their
per-step counts retain their existing activity meaning.

The main process resolves the chat from its own enabled-provider snapshot and
validates every requested file against that chat's recorded file list. Open uses
the known absolute path from that list. Caller-supplied paths never select an
arbitrary filesystem read. Paths inside the preferred Git root display relatively;
recorded files outside that root are excluded from the uncommitted projection.

Worktree list/file/Open use separate IPC endpoints. The main process resolves the
root from its scanned session and validates paths against that worktree's current
changed-file list. The row badge and checklist links continue to use recorded-thread
endpoints; neither scope silently falls back to the other.

Worktree branch, ahead/behind and PR metadata remain separate from the thread's
added/removed totals. Synthetic UI validation does not restart the native application; a requested
restart can be followed by a read-only cold-start measurement.

## Verification

Focused tests cover repeated/reverted edits, sparse patches, full preimages,
creates/deletes/renames, same-file interleaved writers, failure pairing, sidechains,
malformed/oversized input, UTF-8 tails, rewriting, cache refresh, membership checks
and both source adapters. Browser checks use two providers sharing a worktree and
filename, with deliberately different repository and thread totals; they verify
own-file content, refresh, incomplete/unavailable states and checklist callers.
Real Git fixtures cover staged edits, partial/final commits, service restart,
untracked creates/deletes, overwritten edits, and same-file independent writers.

## Startup and refresh latency (26 October 2026)

Git demand now starts after the combined visible-chat selection. Provider scans
only peek at existing metadata and retain ordered repository candidates. Hidden
and lookup-only chats do not start Git processes. Each candidate resolves through
its actual filesystem ancestry, including nested repositories and linked worktree
`.git` files; aliases share one cache keyed by canonical worktree root.

Root and HEAD metadata publish before repository line counts and commit counts.
Those publications update the displayed snapshot directly, without waiting for a
provider rescan. Background metadata and attributed-diff Git commands share a
four-command limit. In-flight snapshots remain shared even after their normal TTL.
Invalidation during a read rejects its stale publication and schedules another read.

Completed-tool/lifecycle hooks and debounced filesystem notifications invalidate
visible worktrees. Git HEAD, index and shared refs are watched alongside source
changes; polling remains a fallback. Inactive worktree watchers are retired.
Root arrival and native activity bypass the thread-diff polling delay. Pending
diffs display a loading indicator, and pending repository counts never claim clean.
Shutdown closes watchers and drains metadata reads; failed parallel diff reads
wait for all child processes before returning.

Local validation: 65 distinct focused tests across Git scheduling, caches,
repositories, source adapters and trackers; TypeScript, focused ESLint, formatting,
diff checks and production build. UI checks cover loading-to-ready publication,
independent thread ownership, worktree actions and checklist links. The first
loaded run hit timeouts while the old application still had 53–78 Git processes;
tests passed after stopping it, with no timeout increases. Tests also exposed and
fixed early-return Windows file locks during failed reads and shutdown.

Two real cold starts produced their first listed snapshots in 1.94–2.09 seconds
and first branch metadata in 2.11–2.32 seconds. All displayed Git and diff states
resolved in 3.70 seconds on the first run and 9.07 seconds on the final run;
background load and the displayed worktrees affect the remaining counts. A direct production
reader measurement returned branch metadata in 4 ms and full counts in 337 ms.
These are local observations, not cross-machine latency guarantees. Evidence:
`Z:/Temp/threadlight-git-latency-startup.json`; production UI screenshots:
`Z:/General/threadlight-e2e/git-latency`.
