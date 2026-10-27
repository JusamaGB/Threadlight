# Codex Agent validation

Validated on Windows on 25 October 2026 against native Codex CLI
`0.164.0-alpha.11.1`. The adapter uses the installed CLI's generated app-server
schema and the [official protocol documentation](https://learn.chatgpt.com/docs/app-server).
This is a tested version, not a claim that every older or future CLI is compatible.

## Implementation

- Settings selects Claude or Codex independently of chat monitoring. Codex model
  IDs and reasoning levels come from all pages of the runtime catalog, including
  optional additional entries. No fixed list of model names is used by the app.
- Each conversation pins its provider, model, reasoning and app exclusions.
  Follow-ups reuse the owned connection; continuation restores the exact thread.
- The Agent checks the effective read-only sandbox, untrusted-command approval
  policy and user approval reviewer before sending a turn. Configured MCP tools
  use per-call prompt approval; an unexpected effective integration blocks launch.
- The connection opts into experimental APIs for structured user input and enables
  `default_mode_request_user_input` locally. Inherited hooks are disabled for these
  sessions. No global settings, desktop launcher or Windows sandbox provisioning
  are changed.
- Request cards have distinct connection, conversation, turn and typed RPC IDs.
  They support file/command approval, turn-scoped permissions, questions and basic
  MCP string forms. Unsupported interactions stop or offer decline.
- An atomic index stores ownership and a bounded unresolved-send journal. Provider
  transcripts remain authoritative. Uncertain messages are never auto-replayed.

## Evidence

| Check                                              | Result                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| TypeScript and ESLint                              | Passed                                                                                                              |
| Full ordinary Vitest suite                         | 218 passed in the isolated Codex-support snapshot; four authenticated cases skipped by default                      |
| Electron main, preload and renderer build          | Passed                                                                                                              |
| Browser smoke with synthetic IPC                   | Passed, no browser errors; settings, reasoning reset, questions, approval queue, Stop/End, Earlier and continuation |
| Live model catalog and effective permission policy | Passed                                                                                                              |
| Live MCP mutation                                  | File absent before explicit allow; exactly one write after allow; subsequent denial caused no second write          |
| Live native file change                            | File absent before approval, correct contents after approval                                                        |
| Live structured input                              | Native question received; explicit Green answer submitted and turn completed                                        |
| Live interruption                                  | Pending file action interrupted; target file remained absent                                                        |

Live text turns passed on both GPT-6 Luna and GPT-6.1 Sol: initial reply, follow-up,
history reading and exact-thread continuation.

Focused regression tests also cover paginated history, exact thread identity,
missing-model/effort errors, malformed protocol and corrupt metadata, late child
events, stale/double approval replies, disabled integrations, no-Claude operation,
settings migration and uncertain-send recovery. Runtime-only tests use disposable
workspaces and a synthetic MCP server; they never approve a production tool action.

Some earlier text-only live probes exceeded the harness's 90-second wait without producing
an answer. The final two-model run passed; a direct app-server text probe also passed.
Tool and question probes completed. Threadlight retains
the unresolved message and permits Stop; it does not convert silence into success
or replay the message. See the live test output when diagnosing runtime latency.

## Boundaries

Desktop-only plugins and connectors remain unavailable because their executor
identity and mutation-approval behavior have not been verified for this owned
connection. Ordinary configured MCP servers are supported. Complex/URL MCP forms
are decline-only. Available models still depend on the signed-in account; catalog
membership is not an entitlement guarantee. No Codex dollar cost is invented.

The browser smoke exercises the built renderer with mocked IPC. The authenticated
tests exercise the real CLI adapter separately; they are not an installed Electron
end-to-end test. Existing Claude behavior has synthetic regression coverage.

## Reproduce

Ordinary local checks require no account or model calls:

```powershell
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
node test/ui/providers.smoke.mjs
```

For authenticated checks, set `THREADLIGHT_LIVE_CODEX` to the native CLI executable.
Catalog discovery alone performs no inference. Additional flags opt into model
calls using the signed-in account and disposable test threads:

```powershell
$env:THREADLIGHT_LIVE_CODEX = 'C:/path/to/codex.exe'
# Optional: verify effective policy without inference.
$env:THREADLIGHT_LIVE_AGENT = '1'
# Optional: two catalog models, follow-up, history and exact-thread continuation.
$env:THREADLIGHT_LIVE_TURNS = '1'
# Optional: synthetic MCP allow and deny.
$env:THREADLIGHT_LIVE_APPROVALS = '1'
# Optional: native file approval, structured question and interruption.
$env:THREADLIGHT_LIVE_FILES = '1'
npx --no-install vitest run test/agentCodex.live.test.ts --reporter=verbose
```

`THREADLIGHT_LIVE_TRACE=1` prints event names and synthetic identifiers for protocol
diagnosis. Test workspaces contain synthetic data only.
