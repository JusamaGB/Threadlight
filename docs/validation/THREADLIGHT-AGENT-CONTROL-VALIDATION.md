# Hosted Agent application control: implementation and validation

Date: 2026-10-28. Implemented in the primary checkout; no deployment, PR or regular-app restart.
This checkout contains unrelated concurrent changes, which were preserved.

## Implemented contract

`src/shared/appControl.ts` owns the versioned, twelve-tool schema registry and the knowledge
bundle explicitly injected into both hosted adapters. `skills/threadlight-control/SKILL.md`
documents that runtime source. Tools expose capabilities, observed application state, known
workspaces, saved spaces, artifacts and scoped changes; acknowledged navigation; supported
settings; named-space/native Codex chat creation; restart; and durable operation lookup.

Application control is supplied only to the general foreground Agent. It is not supplied to
Shared Spaces Agents or exported through the shared-memory plugins. Claude workers are denied
the control server, and Codex's existing external-tool and multi-agent restrictions remain.
Both adapters receive current state as untrusted orientation and the same page/action guide.

The dedicated HTTP MCP server uses loopback binding, exact Host validation, rejection of Origin
headers, bounded requests and random memory-only bearer tokens revoked with the caller.
Exact chat references reuse the existing reader's scope. No generic IPC, shell or JavaScript
execution tool is exposed. Only the panel's registered main frame can claim commands and publish
acknowledgements; instance, renderer generation, revision, command identity and expiry are checked.

Navigation reuses the panel's existing routes and history. The Agent view remains mounted after
its first visit so hiding it preserves its draft and cursor. Shared Spaces drafts remain mounted.
Artifacts wait for the exact selected artifact's load outcome. Card navigation carries a bounded
copy of the selected native edit event; it does not substitute a current worktree or aggregate diff.

Writes use the existing Agent request cards. Settings support `listMode`, `maxSessions`,
`listWindowHours`, `panelLayout` and `hoverHelp`, with an expected revision checked at persistence.
Space creation and Codex chat creation reuse their existing domain services. Persisted operation
IDs, conversation ownership and payload fingerprints prevent retries from duplicating actions.
Denied and uncertain receipts do not claim success. Corrupt receipt storage fails closed.

Restart shares the existing graceful application restart action. It persists a pending receipt,
waits for the matching HTTP response to finish, and blocks other active work, captures, pending
writes and a running test observer. The next ready instance completes the receipt without replay
or a new chat message. The requesting Agent's own turn does not block its requested restart.

## Evidence

| Verification                                                                                                                                | Result                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused service, schema/security, adapters, settings, reader, cards, native stream, navigation, spaces, new-chat and voice regression suite | PASS: 168 tests in 12 files                                                                                                                                                                                     |
| Both real adapter classes using fake provider transports against the actual loopback MCP server                                             | PASS: tools execute and return service evidence; approval/revocation paths covered                                                                                                                              |
| Authenticated installed Codex runtime                                                                                                       | PASS: actually invoked capabilities, app state and navigation against synthetic application state                                                                                                               |
| Authenticated installed Claude runtime                                                                                                      | BLOCKED: organization disabled Claude subscription access for Claude Code; no live Claude PASS claimed                                                                                                          |
| Native Electron panel/preload/IPC fixture                                                                                                   | PASS: list/workspace/chat, Spaces/library/create, exact artifact and missing artifact, all diff scopes, distinct same-file card patches, Back, draft/cursor preservation, guest sender rejection and revocation |
| Isolated native Electron relaunch fixture                                                                                                   | PASS: real graceful relaunch, cleanup marker, response flush, lost follow-up response and exactly one completed durable receipt in the new instance                                                             |
| Renderer TypeScript check                                                                                                                   | PASS                                                                                                                                                                                                            |
| Focused main/preload/shared and control-test TypeScript check                                                                               | PASS                                                                                                                                                                                                            |
| Scoped ESLint and `git diff --check`                                                                                                        | PASS                                                                                                                                                                                                            |
| Production Electron build                                                                                                                   | PASS                                                                                                                                                                                                            |

The combined test command was:

```powershell
npx vitest run test/appControl.test.ts test/agentRun.test.ts test/agentCodex.test.ts test/settings.test.ts test/threadRead.test.ts test/threadReadAdapters.test.ts test/cardChanges.test.ts test/threadStream.test.ts test/navigationHistory.test.ts test/spaces.test.ts test/newCodexThread.test.ts test/liveVoice.test.mjs
```

Live provider checks are opt-in via `THREADLIGHT_LIVE_CONTROL=codex` or `claude` and
`npx vitest run test/appControl.live.test.ts`. They use temporary receipts and synthetic domain
services; no real settings writes, microphone, outbound messages or restart are involved.
Native tests are `test/ui/app-control.smoke.mjs` and `test/ui/app-control-restart.smoke.mjs`.
Set `THREADLIGHT_PLAYWRIGHT` to the installed Playwright module directory when it is outside
the project's dependency resolution. Native tests use isolated profiles, not the regular app.

## Limitations and validation boundaries

- Identity follow-up: `src/shared/agentIdentity.ts` supplies the same explicit Threadlight role
  to Claude's system instructions, Codex's start/resume developer instructions, and both live
  voice instruction fields. Provider identity remains truthful and distinct from product role.
  Existing adapter tests inspect the actual outgoing instructions, including resume and voice.
- The requested exclusive home for the hosted Agent conversation is Threadlight. This is not yet
  a storage guarantee: Claude history reads its CLI project transcripts; Codex uses persistent
  native threads in the normal provider home and archives them on End. Separately created work
  chats must remain normal provider-visible sessions. Isolating hosted history must preserve
  authentication, configured integrations, resume, pagination and existing history. Changing
  `CODEX_HOME` also changes authentication/configuration storage; turning off persistence would
  conflict with the current resume/history contract. No transcript migration or credential
  changes were made as part of the identity update. See the official
  [state location documentation](https://learn.chatgpt.com/docs/config-file/environment-variables)
  and [app-server history contract](https://learn.chatgpt.com/docs/app-server).
- Claude native chat creation remains unavailable. Captured edit-card discovery/navigation uses
  the existing Codex native stream; Claude card scope explicitly reports unavailable.
- Chat/artifact/diff navigation currently requires the chat to be in the monitored snapshot.
  Archived or unloaded chats remain readable through the existing reader, but control does not
  manufacture a UI session for them. This is a bounded UI limitation relative to the wider reader.
- Artifact listings report availability as unknown until opened (or unavailable for unsupported
  kinds). Successful navigation requires the exact artifact to finish loading.
- Live Claude execution and worker isolation were not exercised because the installed account
  returned: “Your organization has disabled Claude subscription access for Claude Code”. Local
  adapter and policy tests pass; credentials and account settings were not changed.
- Voice coverage is the existing synthetic pipeline regression, not live microphone acceptance.
  Control uses the existing backing Agent path and adds no second voice submission path.
- Full-repository `npm run typecheck` is blocked by concurrent `artifactMessage.test.ts` and
  `stackedDiff.test.ts` errors (renderer imports outside the node project file list and possibly
  undefined test accesses). Those unrelated files were left unchanged. A temporary focused
  config extending `tsconfig.node.json`, including main/preload/shared and the control fixtures,
  passed; `tsconfig.web.json` passed separately.
- The regular running app was not restarted. These results validate source, build, adapters and
  isolated native fixtures; they do not claim the existing running instance has loaded this build.
