# Shared Spaces Brainstorm V1 validation

Date: 2026-10-28. Primary checkout: `Z:/General/threadlight`.

## Delivered

Notes replaces Ideas in the Shared Spaces product UI. Independent named-space discussions
work without a note and can link several notes. Brainstorm receives the shared Threadlight
identity, planning skills and a dedicated read-only context server in both provider adapters.
It can retrieve saved material, native chat history and communication evidence in its scope.
Comparison spaces require explicit selection. Proposals do not send work or advance workflows.

See [the implemented contract](../specs/SHARED-SPACES-BRAINSTORM-SPEC.md) for data migration,
authority boundaries, source types, bounds and remaining limitations.

## Automated checks

| Check                                                                                                                                            | Result                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Nine focused test files covering context, Spaces, native reader/adapters, Claude/Codex hosted adapters, app control, participants and navigation | 132 tests passed before the final two migration cases                                                          |
| Final affected subset: `spaceContext.test.ts`, `spaces.test.ts`, `agentCodex.test.ts`                                                            | 60 tests passed, including the two added migration cases; 134 distinct focused tests covered across these runs |
| Main/preload/shared source and affected tests using a scoped extension of `tsconfig.node.json`                                                   | Passed                                                                                                         |
| Renderer `npx tsc -p tsconfig.web.json --noEmit`                                                                                                 | Passed                                                                                                         |
| ESLint on changed Brainstorm sources, adapters and tests                                                                                         | Passed after correcting one ref cleanup warning and declaring browser globals in the native test               |
| Prettier on changed Brainstorm sources and tests                                                                                                 | Passed                                                                                                         |
| Scoped `git diff --check`                                                                                                                        | Passed                                                                                                         |
| `npm run build`                                                                                                                                  | Passed: main, preload and renderer bundles                                                                     |

The main type-check extension includes all `src/main`, `src/preload` and `src/shared` files,
`spaceContext*.test.ts`, `spaces.test.ts`, `agentCodex.test.ts`, `agentRun.test.ts` and the native
Brainstorm fixture. It sets composite false and rootDir to the repository. This avoids unrelated
concurrent test imports in the node project. The earlier full-repository typecheck was not clean:
`artifactMessage.test.ts` and `stackedDiff.test.ts` have separate project-boundary/test type
errors in this shared checkout. They were not changed for this task, and a globally green
repository preflight is not claimed.

Core focused command:

```powershell
npx vitest run test/spaceContext.test.ts test/spaces.test.ts test/threadRead.test.ts test/threadReadAdapters.test.ts test/agentRun.test.ts test/agentCodex.test.ts test/appControl.test.ts test/projectParticipants.test.ts test/navigationHistory.test.ts
```

## Isolated native UI

`test/ui/brainstorm.smoke.mjs` launches the real Electron Panel/preload and Spaces service with
an isolated profile and synthetic provider responses. Final run passed:

- Starting a discussion in an empty named space.
- Capturing a Note and discussing it without removing it from Notes.
- Opening a versioned source citation in the reply.
- Editing and saving a discussion plan.
- Returning to another discussion with unsent text and cursor selection preserved.
- Explicitly selecting a comparison space and passing it into the request context.
- Two independent discussions, one retained note, zero sent messages and zero created tasks.
- No renderer page errors.

The provider boundary is synthetic in this UI check; actual provider execution is tested
separately below. Run after building, with the installed Playwright path when needed:

```powershell
$env:THREADLIGHT_PLAYWRIGHT = '<installed Playwright directory>'
node test/ui/brainstorm.smoke.mjs
```

## Installed provider execution

`test/spaceContext.live.test.ts` is opt-in and uses temporary synthetic data.

**Codex passed.** The installed runtime executed real overview, search and source-read calls
against the dedicated context MCP and returned the synthetic note's content. Initial testing
caught inherited MCP servers surviving a replacement map; the implementation now explicitly
disables inherited entries and verifies the exact allowed context inventory before inference.
The corrected live run passed. Automated adapter tests additionally verify denied native
command approval and connection revocation.

**Claude remains blocked by account policy.** The installed runtime returned:

> Your organization has disabled Claude subscription access for Claude Code

No credentials or account settings were changed. The production Claude adapter was exercised
with a controlled process transport and real loopback context MCP: strict MCP configuration,
empty built-in tool list, injected shared role, successful read, denied shell/worker/external
requests, and token revocation all passed. This does not substitute for live Claude acceptance.

```powershell
$env:THREADLIGHT_LIVE_SPACE = 'codex' # or 'claude'
npx vitest run test/spaceContext.live.test.ts
```

## Boundaries and readiness

The source and production build are ready for review/use after the next normal app launch.
The regular running app was not restarted and its real data was not migrated by these checks.
No PR, deployment, workflow enablement or external message was performed.

V1 has an explicit 5,000-source catalogue cap and paginated substring search. It has no semantic
index, automatic background monitoring, durable evidence ledger or persistent exact-message
navigation for native references. Prior quoted material remains in conversation history after
scope revocation. Hosted conversation visibility in provider stores is still a separate unresolved
requirement. Live Claude remains unverified until its runtime access is restored.
