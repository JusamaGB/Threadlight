# Shared Space provider-chat cycle — 7 November 2026

Provider and space identifiers below use stable placeholders. Original receipts are retained privately.

## Contract and identity

Primary checkout and regular app source: `the primary checkout`, branch `main`.
Starting HEAD: `db3f06f2fe7f4568bcec8397f8ef456120bd2ea9`. Windows executor: `interactive Windows user`.
Read the previous cycle log first, then AGENTS.md. No nested AGENTS, executor/
directive contract or PowerShell diff-log helper was found. Build uses `npm run
build`; regular restart uses the existing renderer restart action and watchdog.
The old log, affected originals, index diff and complete tracked diff were saved
outside the checkout under the supplied reports folder before applying changes.

Verified patch SHA-256:
`B2A75A6E873FC3B9D0D5800AC318B7A657B627BA0E29933D05A7E03393614A16`.
Initially absent from source/build. Forward application failed only on the moved
cycle log; implementation applied cleanly with that path excluded. Reverse check
passed afterward for all implementation paths. Existing voice/discovery/selection
and styled Copy-menu changes remain present.

## Phase 1: implementation and static preflight

Passed 58 tests in six focused files: spaceChatCreation,
perplexitySpaceRoundtrip, appControl, accountChats, accountChatCommunication,
and communicationCatalog. These cover receipt reuse, pre-dispatch budget
preservation, exact native correlation and retaining a created target after a
membership conflict. These are controlled checks, not signed-in acceptance.
Focused ESLint, all TypeScript projects, diff checks and production build passed.
The built main bundle includes `threadlight_start_space_chat`.
Main bundle SHA-256: `8812ad6a40cd353d9a5a9b67773f80f7fce920d611564c6047a5f4d262c4f3e5`.

All 808 pre-existing files outside the patch paths
remain byte-identical. The user explicitly authorized including earlier contents
of affected untracked/modified files in the scoped commit. Unaffected work is
excluded from staging. This validation uses the existing working copy and does
not claim that unrelated uncommitted dependencies are included in the commit.

Affected paths:

- `CHANGELOG.md`
- `README.md`
- `docs/ACCOUNT-CHATS.md`
- `docs/PERPLEXITY.md`
- `docs/validation/SPACE-PROVIDER-CHAT-ACCEPTANCE.md`
- `src/main/accountChats/adapters.ts`
- `src/main/accountChats/service.ts`
- `src/main/appControl/claudeSpaceChat.ts`
- `src/main/appControl/service.ts`
- `src/main/appControl/startSpaceChat.ts`
- `src/main/communication/accountChatTransport.ts`
- `src/main/communication/catalog.ts`
- `src/main/communication/service.ts`
- `src/main/index.ts`
- `src/main/perplexity/verifiedPipe.ts`
- `src/main/sessions/paths.ts`
- `src/shared/appControl.ts`
- `src/shared/communication.ts`
- `test/accountChatCommunication.test.ts`
- `test/accountChats.test.ts`
- `test/appControl.test.ts`
- `test/communicationCatalog.test.ts`
- `test/perplexitySpaceRoundtrip.test.ts`
- `test/spaceChatCreation.test.ts`
- `test/spaceProvider.live.test.ts`
- `updatedifflog.md`

## Phase 2: signed-in runtime acceptance

Implementation commit: `ee0d53861d82d8f77ead482c5a6e340f519bc0d8`.
The regular app was gracefully restarted after idle Agent, Spaces, microphone,
relay and live-observer checks. PID 29608 and installed Perplexity processes
were owned by the same interactive Windows sign-in. Pipe ownership, package/
signature checks and enrollment checks remain intact. GPT discovery returned
30 chats with reply capability after restart.

The signed-in Claude opt-in check failed. Exact session/operation:
`00000000-0000-4000-8000-000000000001`, workspace
`a temporary test workspace`. Its saved transcript contains the exact
opening prompt and `oauth_org_not_allowed`, with a synthetic error model instead
of an inference reply. The provider says Claude Code cannot use the subscription.
The operation was uncertain, with one dispatch and no participant. Inspected the
original native history; did not resend it, change credentials or billing.

The Perplexity opt-in signed-in test passed. Space
`00000000-0000-4000-8000-000000000002` gained native participant
`perplexity:00000000-0000-4000-8000-000000000003`. Sent
`00000000-0000-4000-8000-000000000004`; exact correlated inbox reply
`00000000-0000-4000-8000-000000000005` contained `TL-REPLY-8043e2cc`.
This was real provider traffic with temporary communication stores, distinct
from the foreground regular-app check below.

## Phase 3: foreground Agent and presentation follow-up

Created named acceptance space `Provider Chat Acceptance 2026-11-07 1410`, ID
`00000000-0000-4000-8000-000000000007`, using the app's discovered primary
workspace and a two-hour communication period with ten dispatches. The original
plain-path setup was rejected before creation; the exact discovered Windows
extended path was accepted. No provider chat was manually pre-created.

Submitted the request through the normal Agent composer. The foreground Agent
looked up the named space and used `threadlight_start_space_chat`, operation
`00000000-0000-4000-8000-000000000008`. The human reviewed and approved its normal
card. Durable receipt: `ok`, `linked: true`; exact native target
`perplexity:00000000-0000-4000-8000-000000000009`. That target is the space's
Acceptance Research participant. The Agent recovered this receipt without
creating another chat and sent follow-up `00000000-0000-4000-8000-000000000010`.
Reply `00000000-0000-4000-8000-000000000011` has the exact `replyTo`, native
sender and body `TL-MAIN-FOLLOW-51fdae37`; inbox delivery is to originating
session `codex:00000000-0000-4000-8000-000000000012`. The Agent read and reported
it. Independent read-only journal inspection confirmed all IDs and membership.
Space budget: two dispatches used, ten allowed. Claude remains uncreated here
because of the diagnosed account rejection.

The human found the original card cramped and inconsistent with the description.
Fixed the demonstrated presentation boundary: provider creation uses a named,
readable summary instead of operation JSON; request cards have padded headings,
compact horizontal Allow/Deny actions and keyboard-readable details. Pending
cards remain in view rather than being passed by later Agent replies. Existing
intentional history scrolling and normal approval checks remain intact.

Additional owned paths for the presentation fix:

- `src/renderer/communication/ConversationTimeline.tsx`
- `src/renderer/panel/AgentRequestCard.tsx`
- `src/renderer/panel/AgentView.tsx`
- `src/renderer/panel/Panel.module.css` (only the new Agent request rules staged)
- `test/ui/agent-decision.smoke.mjs`
- `test/ui/providers.smoke.mjs` (only the new fixture entry staged)
- `test/ui/README.md` (only the new fixture description staged)

Passed all 16 affected application-control tests after the summary change, plus
41 communication real-caller tests. Initial controlled suite count was 58;
99 distinct controlled checks passed in total. Isolated `agent-decision` and
existing `conversation-events` UI regressions passed. Inspected the screenshots.
These use synthetic provider IPC and do not accept a real action. Focused lint,
all TypeScript projects, production build and owned diff checks passed. No broad
local suite was repeated. The live-test report now includes target, membership
and workspace identifiers, without native write tokens or credentials.

Regular app gracefully restarted with the final presentation build: PID 14516,
renderer `index-B3OK6p3C.js`, main SHA-256
`77c24911712d9768a18552aac7b3db84d693691562b1bef3b6447065935e1316`.
GPT discovery again returned 30 chats. Saved Local STT/Codex preferences and the
earlier voice, Smart Thread selection and styled Copy-menu fixes are retained.
Acceptance space files under `shared-spaces/` and provider histories are kept as
user data and excluded from commits. Unrelated pre-existing files remain intact.

Updated CHANGELOG Unreleased, README, affected account-chat/Perplexity guides,
UI test guide and the detailed validation record. See
[provider acceptance evidence](docs/validation/SPACE-PROVIDER-CHAT-ACCEPTANCE.md).
No release, push or PR was performed.

## Remaining gate — ENVIRONMENT_LIMITATION

Claude Code account/subscription access must be restored before the signed-in
Claude path can pass. The exact original failed session has been inspected;
no automatic replay or duplicate uncertain send was performed. Perplexity is
verified end to end through the foreground Agent, but complete acceptance for
both providers is not claimed. No applicable PowerShell diff-log helper exists;
this file is the current cycle record, with its predecessor backed up externally.
