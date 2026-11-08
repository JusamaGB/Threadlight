# Working copy and application launches

Use the primary repository checkout as the normal working copy and the source of
the running application. Use the primary repository checkout selected for your workspace; do not hard-code a maintainer-specific path.

- Do not create additional worktrees unless the user explicitly requests one.
- Build and launch the regular app from the primary checkout. Do not replace the
  user's running app with a build from another worktree.
- Run automated UI checks in their isolated test environment. Check for an active
  Agent or live test before restarting the regular app.
- Preserve unfinished changes in existing worktrees. Retire obsolete worktrees
  only after verifying their commits and any untracked or ignored user data.
- On Windows, inspect dependency junctions before removing a worktree. Detach a
  junction itself without traversing its target; dependencies may be shared with
  the primary checkout.

# UI design

For UI work, read and follow [the compact, contextual UI guideline](docs/UI-GUIDELINES.md).
Prefer shared components, content-sized controls, tight spacing and contextual
actions. Keep routine explanation in hints or opened details, with keyboard access.

# Local preflight

Before publishing or updating any pull request, complete a local preflight of
every relevant check that can reasonably run in the current environment. Run fast
structural, product-evidence, and coverage checks first; then run focused tests for
changed behavior and affected source or real-caller snapshots; finish with diff
and build checks where relevant. Resolve discovered issues locally before pushing
again so CI confirms a prepared change instead of serving as the first diagnostic.
Keep local test scope focused when requested; normal CI may still run the full
suite. Do not rerun broad checks locally without a new failure or change that
warrants them.

# Keep user-facing documentation current

These rules apply to every human or agent chat working on Threadlight, including
follow-up work and changes that have not been committed or opened as a PR.

- Update `CHANGELOG.md` under **Unreleased** in the same work session as each
  notable user-visible addition, change, fix or security change, before reporting
  the work complete. Do not leave documentation for a later release chat.
- Update `README.md` and affected setup/plugin guides when supported capabilities,
  entry points, requirements or limitations change. Keep the README about the
  current implementation; keep proposals in `docs/specs/`.
- Describe the user-visible result concisely. Consolidate related entries instead
  of logging every implementation step. Preserve other chats' entries; coordinate
  shared-file edits and re-read the file before applying a patch.
- Back claims with the actual implementation and validation. Link detailed
  evidence from `docs/validation/` when useful, distinguish synthetic checks from
  live-provider checks, and retain unverified paths and release gates explicitly.
  A build, isolated test or worktree implementation is not a release or live reload.
- Changes confined to an unmerged worktree must not be advertised as available
  in the primary checkout. Update that worktree's documentation with its change;
  reconcile it during integration. Do not turn an accepted specification into a
  shipped-feature claim.
- At handoff, state which documentation was updated. If a change has no
  user-visible effect, briefly explain why no changelog entry is needed.
