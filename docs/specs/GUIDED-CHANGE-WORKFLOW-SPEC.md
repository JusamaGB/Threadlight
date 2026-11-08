# Guided change workflow

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

29 October 2026. Approved for the first implementation by Kris in the guided diff review chat.

## Purpose and release boundary

Turn a thread's diff viewer into a guided route from unfinished edits to a reviewed,
versioned change. Teach Git terminology at the point of use. The same service
operations should eventually support a human, Brainstorm, a Swarm assignment and
a scheduled workflow, under separately configured authority.

Release one implements local inspection, explicit file/section selection, exact
candidate review, validation, and a commit saved on a **new local branch**. It
does not publish, open or merge PRs, switch the user's checkout, clean worktrees,
rewrite history, or enable an agent/schedule to mutate repositories. These later
capabilities are specified below, not presented as implemented controls.

## User journey

1. Click a thread's diff. Keep the existing historical/thread/worktree distinctions.
2. Choose **Prepare changes**. Explain that the selection covers current checkout
   changes from all writers, not exclusive thread ownership. Display the exact
   repository path and current branch. Nothing is preselected.
3. Select files. For modified text files, optionally select individual patch sections
   (Git hunks). Whole-file selection explicitly includes every current edit in that
   file. Added/deleted/binary/renamed files are selected as complete changes where
   supported; unsupported cases are explained and blocked rather than omitted.
4. Prepare a candidate based on the observed HEAD. Show the resulting complete
   patch, selected paths, source revision and available checks. The Git index used
   for preparing this candidate is private to this operation.
5. Run validation against the candidate. Always run Git whitespace/conflict-marker
   validation. Optional supported package scripts run only when explicitly selected,
   against an exported candidate, with local installed dependencies where available.
   These commands execute project code and are not a security sandbox. Show each
   result, output and failure and which project scripts were actually selected.
   A whitespace pass must never be labelled “tests passed.”
6. Review the commit message and destination **new local branch**. If project checks
   were not run, require an explicit acknowledgement before saving the checkpoint.
7. Save the exact candidate tree as a commit on that new branch. Show the commit ID,
   branch, and verification result. The current checkout, current branch, index,
   and dirty files remain unchanged, including the selected edits. Explain this
   explicitly: saving elsewhere must not look like cleaning the original checkout.

The new branch makes a mixed shared checkout usable without moving another chat's
active branch or taking over its staging area. Users can later publish this branch.
Do not claim all necessary feature dependencies were selected merely because a
patch applies; this remains part of review and project validation.

## Teach, Tour, Full and Off

Keep the existing persisted `hoverHelp` values compatible: `tour`, `info`, `off`.
Add `teach`. Display `info` as **Full** in the setting, matching the requested labels.
Existing users retain their saved setting; Teach is opt-in.

- **Tour:** explains where controls are and what they do.
- **Full:** ordinary detailed information and hover hints.
- **Teach:** Full information plus contextual explanations of source-control concepts,
  action effects and reasons. Offer Tour guidance as a fallback where no teaching
  content exists. The workflow's teaching area stays at its bottom and is reachable
  by keyboard/tap, without requiring hover. Do not reserve an empty teaching area.
- **Off:** suppress optional teaching/hints. Essential scope, errors, destinations,
  consequences and confirmation text remain visible in every mode.

Teach staging, commits, branches, dirty worktrees, push, PR, merge, rebase and
cherry-pick only when relevant. Distinguish file saving from a Git checkpoint and
merging from deployment. Teach mode does not grant extra automation permissions.

## Exactness and preservation contract

- Resolve repository identity on the main side from an authorised session; never
  accept an arbitrary root from renderer input. Bind every plan to session/root.
- Bind inspection and plans to HEAD, branch, index and current change content.
  Refresh/review after changes; never silently commit a different selection.
- Use literal repository-relative paths, bounded input and bounded subprocesses.
  Reject traversal, external symlinks, submodules and unsupported conversions.
- The candidate is an immutable Git tree; validation and commit use that same tree.
- Preserve the original index byte-for-byte, existing staged changes, dirty files,
  untracked files, branch and all unrelated refs. Never stash/reset/clean implicitly.
- New-branch creation is compare-and-swap and must not overwrite an existing ref.
- Respect signing requirements. Custom commit hooks are unsupported in release one
  and block the operation with an explanation; never silently bypass active hooks.
- Exclude unsupported filter/text conversion setups rather than promising exact
  raw-file reproduction through arbitrary external transformations.
- Persist plan/receipt identity before publishing a branch ref. A retry after an
  uncertain response returns the same commit if that ref already contains it.
  A conflicting ref, changed input, failure or unavailable repository is not success.
- Local processes can still write files outside this service. Immutable candidates,
  revalidation and never changing the source checkout limit that concurrency risk;
  a process-local lock is not advertised as a lock on other editors or Git clients.

## Service and UI boundaries

Use typed commands and results: inspect, prepare, validate, save. Renderer requests
must come from the panel's main frame. Validate all fields on the main side. Only
authorised session roots are available. Surface failures without losing selection.
The service is independent of React and scheduler/LLM implementations. Future agent
adapters require explicit capabilities; sharing these functions is not permission.

Durable plans contain candidate tree, base commit/ref, source fingerprint, selected
paths, check evidence and optional save receipt. Repository objects hold candidate
contents; the plan store must not duplicate source text unnecessarily. Expired or
unreadable records are unavailable, never recomputed into a changed operation.

## Subsequent phases

### Publish and pull requests

Review exact remote URL/account, branch, base branch, all outgoing commits/files,
title, description and visibility. Publish only after relevant local preflight.
Retain a durable operation receipt; recover unknown outcomes by querying the
remote rather than retrying blindly. Recheck branch HEAD and account authority.
Draft PR is the first remote destination. Saving locally remains a complete path.

### Include existing PRs and merge

Select exact PR identities and revisions. Check base branches, dependencies,
review requirements, branch protection, conflicts, CI and merge method. Several
green PRs require validation of their proposed combined integration result.
Refresh approvals/checks after meaningful revision changes. Rebase and cherry-pick
are explicit advanced routes with previews, recovery references and appropriate
authority; no implicit force-push. Deployment and worktree cleanup are separate.

### Recipes, agents and schedules

A versioned project recipe specifies trigger (click, completion, schedule), scope,
dependencies, required checks/review, destination, permitted actions, approval
boundaries, concurrency and failure policy. Authority is per operation, not an
ambiguous “autonomy percentage.” Saved recipes cannot broaden current human grants.

All entry points create durable runs of the same state machine: inspecting,
awaiting-selection, prepared, validating, awaiting-approval, executing, succeeded,
failed, stale or uncertain. Persist exact evidence and receipts. Resume from
verified state after crashes; deduplicate trigger delivery. Notify on meaningful
change, completion, failure or required action, not every unchanged poll.

## Validation and acceptance

Use temporary Git repositories for real commit tests. Cover whole-file and partial
section selection, additions/deletions, mixed writers, unrelated staged work,
source mutation after review, branch collision, replay, hooks, invalid paths,
failed checks, no project checks, and unchanged source checkout/index after save.
Check candidate tests against candidate contents, not source working files.

Exercise the actual renderer and IPC contract: entry from thread diff, loading and
errors, selection, patch preview, checks, commit acknowledgement, success receipt,
Teach setting persistence and keyboard-accessible teaching. Use an isolated app
profile for automated checks; never run test commits against the user's repository.

## Worktree and rollout record

Primary main at start: `602e1d2`. Current unfinished work preserved as snapshot
`6c1fff9`. Workflow branch `4201578` reconciled as merge `bf719d9`, preserving newer
composer/microphone changes. Implementation branch: `codex/guided-change-review`;
checkout: `C:/dev/threadlight-guided-change-review`.

Main history and the workflow branch are both ancestors of this build. The primary
checkout is left intact. Before eventual integration, inspect new primary edits
again; do not overwrite them with this snapshot. User explicitly requested testing
from the feature worktree, overriding the normal primary-only launch preference.
Build before switching; check active Agent/test work before closing the old app.

The subsequent documentation-only main commit `b04e45f` is also merged into this
feature branch, with its reconciled README/changelog retained alongside this feature.
