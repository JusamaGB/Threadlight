# Working copy and application launches

Use the primary repository checkout as the normal working copy and the source of
the running application. In this workspace, that is `Z:/General/threadlight`.

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
