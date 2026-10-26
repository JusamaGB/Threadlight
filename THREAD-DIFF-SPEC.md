# Thread-specific changes

The row's diff badge, hover, heading, file list and opened patch all describe the
same provider-qualified chat. They do not use the checkout's diff against HEAD.
The scope is the recorded lifetime of the thread; committing a worktree does not
erase that thread's recorded changes. Right-clicking a thread offers Worktree diff:
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

The ledger never reads the current edited file to manufacture a diff. Two chats
may therefore present different changes to the same file in the same worktree.
Shell commands and formatters are included only when the provider records their
mutations as file-change evidence; filesystem activity alone is not attribution.

## Combining changes

Known original-line identities and recorded contexts combine successive patches
into a net diff. Creates, deletions, replacements, renames and reverted edits keep
their own lifecycle. Recorded gaps may remain unknown; unchanged context is not
invented. When an intervening writer, malformed patch or unavailable preimage
prevents a safe combination, that file shows its separate recorded patches and
the badge/viewer marks the history incomplete. Such totals describe the available
recorded edits rather than claiming an exact net result. No workspace fallback is
used. Missing history is distinct from a successfully read thread with zero edits.

The cache is independent per chat and refreshes at most every five seconds.
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
recorded files elsewhere remain accessible under their actual paths.

Worktree list/file/Open use separate IPC endpoints. The main process resolves the
root from its scanned session and validates paths against that worktree's current
changed-file list. The row badge and checklist links continue to use recorded-thread
endpoints; neither scope silently falls back to the other.

Worktree branch, ahead/behind and PR metadata remain separate from the thread's
added/removed totals. The native window and running E2E app are not restarted as
part of local validation.

## Verification

Focused tests cover repeated/reverted edits, sparse patches, full preimages,
creates/deletes/renames, same-file interleaved writers, failure pairing, sidechains,
malformed/oversized input, UTF-8 tails, rewriting, cache refresh, membership checks
and both source adapters. Browser checks use two providers sharing a worktree and
filename, with deliberately different repository and thread totals; they verify
own-file content, refresh, incomplete/unavailable states and checklist callers.
