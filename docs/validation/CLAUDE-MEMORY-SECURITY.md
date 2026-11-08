# Claude and shared-memory security follow-up

Implemented in the primary checkout on 29 October 2026. This is an unreleased
change, not a live-app or plugin-cache update. See [the security model and upgrade
procedure](../security/LOCAL-IPC.md).

## Changes and threat coverage

| Finding                                                                                                                         | Threadlight change                                                                                                                                 | Evidence                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A replacement loopback listener could receive pairing secrets, bearer tokens and Claude inbox credentials, or forge MCP replies | Authenticated AES-256-GCM requests and nonce-bound replies, with a Windows-protected rotating service key; no plaintext route or redirect fallback | Real HTTP adversarial tests and both packaged stdio bridges                                                     |
| Owned memory/communication, chat-reader, space-context and app-control clients still used plaintext HTTP                        | Shared authenticated transport behind provider-facing stdio proxies                                                                                | Real proxy processes exercised by hosted Claude/Codex adapter fixtures and relay fixtures                       |
| A capability could be revoked while its request body was uploading                                                              | Authorization checked after the complete authenticated upload; long-running communication retains its revalidation                                 | Slow-upload revocation, paired/owned revocation, existing scope and recovery tests                              |
| MCP configuration exposed bearer values in provider command lines                                                               | Protected private configuration files; only script/configuration paths on argv; per-caller cleanup, including locked-file revocation               | Real proxy/relay execution, manual enrollment, cleanup and revocation tests                                     |
| Manual enrollment still displayed plaintext HTTP configuration                                                                  | Exports authenticated stdio configuration without exposing bearer/server keys to the renderer                                                      | Real enrollment/proxy test and focused memory UI check                                                          |
| Claude pipe identity lacked a Windows user/logon check                                                                          | Read the actual pipe owner's process token and require matching SID and logon authentication ID, before credential writes                          | Native Windows token/handle-count checks, mismatch policy tests and existing runtime generation/ownership tests |
| Claude relay prompts were visible in process arguments and stdout was unbounded                                                 | Prompt on stdin; bounded stdout/stderr; oversized-output termination waits for process cleanup                                                     | Actual child-process fixture with punctuation, private prompt, excessive output and authenticated MCP calls     |

All production bootstrap directories have protected DACLs allowing only the
current user, SYSTEM and Administrators. Tests create isolated temporary profiles,
inspect those Windows ACLs and exercise key rotation for hooks and every local MCP
service. They do not read the live application's secret files.

## Validation

The focused regression run passed **212 tests across 17 files**:

```powershell
npx vitest run test/memorySecurity.test.ts test/memoryPlugins.test.ts test/memory.test.ts test/communicationIntegration.test.ts test/claudePipeSecurity.test.ts test/claudeRuntime.test.ts test/hookBootstrap.test.ts test/hookServer.test.ts test/ipcSecurity.test.ts test/relay.test.ts test/relayService.test.ts test/codex.test.ts test/threadRead.test.ts test/appControl.test.ts test/spaceContext.test.ts test/agentRun.test.ts test/agentCodex.test.ts
```

The attack cases include wrong keys, tampered ciphertext, stale/future timestamps,
request replay, replayed replies, origin/port binding, empty browser headers,
unexpected Host, forged pairing replies, redirects, raw-route rejection, revoked
capabilities and server restart. Existing enrollment, scope, long-polling decision
cards, restore/recovery and native inbox release-gate tests remain in the run.

The shipped proxy also ran under the installed Electron binary in Node mode.
A separate read-only check passed the generated TOML to the installed Codex CLI's
`mcp get threadlight --json`: it parsed as stdio and disclosed no bearer token.
This check made zero model calls and created no provider conversation.

After the regression run, a final cleanup review added a Windows file-lock case:
a temporarily locked credential file cannot block capability revocation or listener
shutdown. The updated `memorySecurity.test.ts` passed **12/12** (including that new
case); the 17-file run above preceded this small cleanup correction. That is 213
distinct passing tests, without rerunning unaffected suites.

Both provider plugin manifests are versioned 0.3.0 so a package refresh can detect
the transport change; the Codex portable and compatibility manifests agree. No
package was installed or published by this task.

Typechecking, targeted ESLint, canonical plugin-asset checks, diff checks and the
production build passed. The focused UI checks also passed:

- `THREADLIGHT_UI_FOCUS=memory-security node test/ui/providers.smoke.mjs` exercised
  the real memory store through the rendered UI, including manual stdio enrollment
  without bearer headers, pairing/revocation, scoped folders, drafts and stale edits.
- `node test/ui/app-control-restart.smoke.mjs` exercised an isolated Electron app,
  encrypted control requests, a flushed durable receipt, a lost response, graceful
  relaunch and recovery in the new instance. It did not restart the user's app.

The provider-turn proof scripts now use isolated test keys and the new proxy instead
of rotating the live app's credentials or using raw HTTP. They were not run in this
follow-up. The UI checks used synthetic provider transports and made no provider sends.

## Remaining limits and activation

- The key authenticates an account-scoped local service, not a uniquely attested
  executable. Malicious same-user code, administrators and modified app/plugin
  files remain inside the trust boundary. No cross-user exploitation test was run.
- Native-chat associations in memory enrollment remain human declarations. Pairing
  and scoped capabilities still authorize access; a bootstrap key alone does not.
- Codex's desktop router still needs upstream client authorization, mandatory
  initialization, connection-derived sender identity and response/discovery binding.
  Threadlight cannot supply those server-side protections.
- The real Claude Desktop inbox acceptance gate remains closed. These tests do
  not certify or enable native Desktop wakeup. No live Claude/Codex model turn was
  used for this follow-up; provider-turn proof scripts were adapted but not run.
- Arbitrary third-party MCP servers configured by the user are outside this change.
  This is a focused review of these local connections, not a complete application audit.
- Restart Threadlight and refresh both complete plugin packages together, then
  reconnect MCP processes and request fresh human-approved enrollment. Old
  plaintext clients fail closed. Manual configurations must be regenerated after
  app restart. Hook trust still needs normal provider review.

Other unfinished work was preserved. The review does not require a live app
restart, global plugin installation, new permissions, commits or a pull request.
