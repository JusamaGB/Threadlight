# Shared Space provider chat acceptance

Provider and space identifiers below use stable placeholders. Original receipts are retained privately.

The foreground Agent resolves the requested space and shows the opening message and participant role on its decision card. A successful receipt records the exact saved destination and membership. A pre-dispatch failure leaves the budget intact. An unconfirmed send keeps an uncertain receipt.

## Checks on 7 November 2026

| Check                                                                                | Result                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed Claude Code 2.1.317, isolated writable profile, local HTTP test endpoint   | One inference request. The CLI saved the requested reply, and the production creation code added the verified session ID to the test space.                                        |
| Signed-in Claude Code using its normal profile from the offline Windows test account | Timed out. The CLI diagnostic recorded refused API connections and denied transcript writes.                                                                                       |
| Installed Perplexity Windows app from the offline Windows test account               | Opening its pipe returned Windows error 5. The app reported the permission failure before sending or consuming a dispatch.                                                         |
| Perplexity framed RPC fixture                                                        | The production chat reader, account service, and communication journal created the native fixture chat and returned the matching follow-up to the Agent inbox over one connection. |

## Primary-checkout signed-in run

Applied the verified patch in `the primary checkout` on `main`, starting from
`db3f06f2fe7f4568bcec8397f8ef456120bd2ea9`. Implementation commit: `ee0d538`.
The user authorized including pre-existing contents of affected files in that
commit; unrelated staged/unstaged work was excluded. The previous cycle log and
affected originals were backed up outside the checkout. No worktree was created.

The executor, regular Threadlight process and Perplexity processes were all owned
by the interactive `interactive Windows user` account. Pipe ownership, signature/package
verification and enrollment checks were retained. Type checks, focused lint,
58 controlled tests and the production build passed before the regular app was
gracefully restarted. The new main process was PID 29608; its main bundle contains
`threadlight_start_space_chat`. The renderer loaded `index-5jUj8sgH.js`.
GPT discovery after restart returned 30 chats with reply capability advertised.

### Installed-provider outcomes

- **Claude: blocked by account access.** Operation/session
  `00000000-0000-4000-8000-000000000001` used the configured normal Claude profile
  and workspace `a temporary test workspace`. Its saved native transcript
  contains the exact opening prompt but an assistant error `oauth_org_not_allowed`,
  with model `<synthetic>`, rather than a successful model reply. The provider text
  says Claude Code cannot use the subscription. The application returned an
  uncertain outcome and added no participant. One dispatch was reserved. The
  original transcript was inspected before any further action; this operation
  was not resent. Claude Code account access must be restored before acceptance
  can finish. Credentials and billing actions were not changed.
- **Perplexity: passed the opt-in signed-in creation/follow-up test.** Temporary
  space `00000000-0000-4000-8000-000000000002` contains participant
  `perplexity:00000000-0000-4000-8000-000000000003`. Follow-up message
  `00000000-0000-4000-8000-000000000004` completed. Reply
  `00000000-0000-4000-8000-000000000005` has that exact `replyTo`, that Perplexity
  sender target, body `TL-REPLY-8043e2cc`, and an inbox delivery to originating
  target `codex:00000000-0000-4000-8000-000000000006`. This uses real signed-in
  provider calls and the production transport/journal with temporary stores;
  it is distinct from the normal foreground Agent check below.

### Normal foreground Agent acceptance

Created **Provider Chat Acceptance 2026-11-07 1410**, space ID
`00000000-0000-4000-8000-000000000007`, through the regular app's Shared Spaces
API using its discovered primary workspace. The policy allows ten dispatches for
120 minutes. The discovered workspace uses Windows' extended path spelling;
the initial plain-path attempt was rejected before space creation, then the
app's exact discovered workspace value was used.

The request was submitted through the regular Agent composer. The Agent resolved
the space by name, checked live capabilities, and exposed its normal decision
card for Perplexity, role **Acceptance Research**, opening message
`Reply with exactly TL-MAIN-OPEN-51fdae37`. Operation ID:
`00000000-0000-4000-8000-000000000008`. The card was surfaced to the human for
approval; no automation accepted it. The human approved the card. Its durable
receipt confirmed `outcome: ok`, `linked: true`, native target
`perplexity:00000000-0000-4000-8000-000000000009`. The exact target appears in this
space's workflow with role **Acceptance Research**.

The originating Agent then recovered that receipt and sent one follow-up message
`00000000-0000-4000-8000-000000000010`, body
`Reply with exactly TL-MAIN-FOLLOW-51fdae37`. Its delivery completed. Reply
`00000000-0000-4000-8000-000000000011` has that exact `replyTo`, the same native
Perplexity sender, and body `TL-MAIN-FOLLOW-51fdae37`. It was delivered as an inbox
message to `codex:00000000-0000-4000-8000-000000000012`, the native session for
foreground Agent conversation `codex:00000000-0000-4000-8000-000000000013`.
The main Agent read its inbox and reported those exact IDs and matching reply.
Read-only journal inspection independently confirmed these relationships.
The space used two of its ten dispatches: creation and the follow-up.

Claude creation through the foreground Agent is intentionally not retried while
the diagnosed account-access rejection remains unresolved. End-to-end completion
for both providers is not claimed.

### Decision-card presentation follow-up

During normal acceptance the human reported that the card was cramped and did
not clearly match the described request. The original card used raw operation
JSON, and auto-following later Agent replies could hide its heading. The provider
creation request now has a readable provider title plus named space, role and
opening message. Agent request cards have a padded heading, compact horizontal
approval controls and keyboard-focusable scrollable details. While following
live updates, the log brings a pending card into view rather than jumping past
it to later commentary; intentional history scrolling remains under user control.

The isolated `agent-decision` UI check passed for Claude Code and Perplexity,
including both Allow and Deny paths, exact summary text, compact controls,
keyboard access and visibility during later replies. It uses synthetic IPC and
does not approve a live request. The updated application-control test passed
all 16 tests; the affected communication caller suite passed 41 tests separately.
Type checks, focused lint and the production build passed. Screenshots were
visually inspected in the external reports folder under
`threadlight-agent-decision/`. No extra provider conversation was created to test
the presentation change.

The shared `conversation-events` UI regression also passed: independent worker
cards, precise native answers, disappearance/recovery and conversation isolation.
After idle Agent/Spaces/microphone/relay and observer checks, the regular app was
gracefully restarted again. PID 14516 loaded renderer `index-B3OK6p3C.js` and
the new main bundle SHA-256
`77c24911712d9768a18552aac7b3db84d693691562b1bef3b6447065935e1316`.
Post-restart GPT discovery again returned 30 chats; Local STT and Codex Agent
preferences were retained. The acceptance space and real provider histories were
kept for inspection and resumption.

**Stop reason: ENVIRONMENT_LIMITATION.** Complete signed-in acceptance for both
providers requires restoring Claude Code subscription/account access, then running
the Claude path with a new reviewed operation after inspecting the saved failed
session above. Perplexity acceptance is complete, including the normal human
decision card and the originating Agent inbox. A controlled Claude transcript
fixture is not substituted for a successful signed-in Claude reply.

## Signed-in Windows acceptance

Run from the patched Threadlight checkout in the Windows session used for Claude and Perplexity. Each check sends a short acceptance message to a new provider conversation. Its communication journal and workspace are temporary. The native provider conversation remains in provider history.

```powershell
$env:THREADLIGHT_LIVE_SPACE_CHAT = 'claude'
npm.cmd test -- test/spaceProvider.live.test.ts
$env:THREADLIGHT_LIVE_SPACE_CHAT = 'perplexity'
npm.cmd test -- test/spaceProvider.live.test.ts
Remove-Item Env:THREADLIGHT_LIVE_SPACE_CHAT
```

The Claude check requires the exact opening reply in the saved Claude transcript. The Perplexity check requires a second reply attached to the original sender's space inbox. Also check the foreground Agent decision card in the regular app after deploying the patch. Select the intended space and confirm the provider, role and message before accepting.

### Codex Shared Space follow-up, November 9

The saved creation receipt for the reported conversation confirms a native workspace chat. Its receipt has no Shared Space membership. The earlier Claude request used a descriptive operation ID where the tool required a UUID.

The Codex space path now resolves a requested model against the installed catalog, starts the native thread, sends the approved opening through its desktop owner, and adds the confirmed destination to the selected space. A failed opening or membership conflict returns the known thread identity for recovery. A signed-in, ephemeral native check confirmed the catalog ID and thread-start result for `gpt-6.1-sol`. Focused tests exercise the desktop request, approval, participant registration, delivery failure and membership conflict with controlled dependencies.
