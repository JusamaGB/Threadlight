# Integrated testing branch — 29 October 2026

Integration update, 29 October 2026: this work is now reconciled into primary
main with the connection setup fix. The record below describes the earlier
feature-branch validation. See [final reconciliation](WORKSPACE-RECONCILIATION-2026-10-29.md)
for combined checks and preservation evidence.

The existing `codex/guided-change-review` worktree combines primary snapshot
`5d1143d` with guided review `47f8ba3` and the previously merged Workflow tab.
Primary changes were committed without dropping files, resetting history or
publishing remotely. Feature work remains on the testing branch.

Merge resolution used the shared source snapshot `6c1fff9` to distinguish later
primary fixes from the feature additions. Security transports, multi-root
comparisons, shared composers, Brainstorm and motion changes were retained.

## Checks

- Canonical plugin package check, full lint and TypeScript checks passed.
- Initial full unit run: 876 passed, 4 failed, 8 intentionally skipped. Three
  failures involved process or filesystem timing under concurrent checks; each
  passed in a focused rerun with two workers. No timeout thresholds were relaxed.
- The remaining regression revealed duplicate Windows root identities and a
  changes request waiting on a second background observation. Root keys now use
  the existing canonical path normalizer; requests reuse the observation already
  in progress. The existing busy-refresh regression test passes without altering
  its assertions. Focused thread refresh, diff and local-change tests: 29 passed.
- Focused launcher, guided workflow, Git latency, local-change and uncommitted
  tests passed on rerun. The full suite was not repeated after the focused fixes.
- Production renderer checks passed for guided review with real temporary Git
  commits, Shared Spaces including Workflow, secure-memory UI, and thread diffs.
- Production build passed. The tests used isolated data and did not submit any
  real provider turns or create commits in the user's source checkout.

Live-provider and human acceptance remain separate from these automated checks.
The app and both plugin packages must use the compatible 0.3.0 transport. Existing
provider chats may need reopening/reconnecting; hook trust and memory enrollment
remain explicit human approvals. Upstream Codex router authentication and the
hostile same-user threat boundary remain unchanged.
