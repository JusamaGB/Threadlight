# Source preview preparation: 4 November 2026

Scope: Windows source preview, version `0.1.0-alpha.1`. This record describes local
validation, not a published release or a reload of the user's running application.

## Public scope

- Kimi is disabled in public settings by `KIMI_PREVIEW_ENABLED`. Its provider
  choice, setup and workspace are absent even when an older profile selected it.
  Saved configuration and development code remain intact.
- README, limitations, roadmap, privacy, security, contributor guidance and the
  repository's static-site copy now describe the source preview and uneven provider
  support. Claude needs catch-up and renewed live validation.
- Public proof records use generalised workstation paths and native identifiers.
  Live native Codex proofs require an explicitly supplied disposable chat instead
  of embedding a maintainer's chat identifier.
- Approved plugin pairing documentation now reflects durable, revocable links and
  their private credential cache.

## Validation

- Plugin asset consistency: passed.
- Full ESLint: passed, including the patched development-tool dependency.
- TypeScript main, renderer and browser-test projects: passed. Browser-only tests
  have their own DOM-enabled project; DOM globals were not added to main code.
- Full Vitest suite: **116 files passed, 3 skipped; 1,124 tests passed, 8 skipped**.
  Opt-in live-provider tests remain skipped; no provider messages or paid operations
  were sent during release preparation.
- Focused renderer checks: public provider settings and account-chat replies passed.
  Settings checks include All/subset/none, independent chat choices, failed saves,
  reload, compact width and hidden Kimi configuration retention.
- Production build: passed. A separate source export also completed `npm ci`,
  type checking and production build without reusing the checkout's dependencies.
- Dependency audit after the pinned `minimatch` override: **0 known vulnerabilities**.
  The override addresses the development-tool dependency described in
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
- Gitleaks 8.30.1 over all fetched local/remote Git refs: **75 commits scanned,
  no detected secrets**. Automated scans are not proof that no sensitive data exists.

Initial full-suite failures exposed stale pairing test assumptions and a Windows
process-start timeout. Tests now supply the same connection snapshot and project
scope as real callers; revocation checks remain enforced. The process-lifecycle
fixture allows startup time separately from the deliberately hung operation.

## Limits

This is not renewed live acceptance for Claude, Kimi or Perplexity Computer, a
microphone/device acceptance run, or a signed Windows distribution. It does not
establish support for every provider desktop version.

Sanitising current files does not rewrite Git history. Existing public commits
retain their original author metadata and historical examples. No remote changes,
social posts, installer publication or history rewriting were performed here.

The private launch pack records the final source commit, archive checksums,
current-file scan and final formatting/diff results.

## Subsequent history cleanup

Later on 4 November, all eight published branch histories were rewritten to remove
personal author email, identified native chat IDs, personal paths and local-only
screenshots/build artifacts. The local development branches were reconciled without
discarding working files. The release snapshot and private launch pack were refreshed
onto the cleaned history. This supersedes the earlier history limitation above for
branch-reachable commits; GitHub's retained PR references and cached old commits
still require a separate Support purge. See [clone guidance](../security/HISTORY-CLEANUP.md).
