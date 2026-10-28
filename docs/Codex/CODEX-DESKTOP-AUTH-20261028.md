# Codex native decision cards: connection investigation and implementation

Date: 28 October 2026. Requested outcome: answer a decision card from an existing
Codex desktop chat inside Threadlight, without opening Codex or starting another
agent. **Native desktop asynchronous question submission is now implemented and live-tested.**

## Current outcome: local desktop coordination

The successful route is the installed desktop's local client-coordination pipe,
`\\.\pipe\codex-ipc`. Threadlight initializes as its own `threadlight` client,
discovers the chat's owning client, and sends the desktop's native question-reply
envelope through `thread-follower-steer-turn`. It does not impersonate a desktop
client, host a router, queue a later turn, or modify Codex's database. Claude's
hooks and submission paths are unchanged; Shared Spaces is not involved.

The tracker supplies the original turn and question-item IDs. Before sending,
the main process re-reads the active question from read-only SQLite, reconstructs
the native IDs for each question, and rejects expired or already answered cards.
Success requires an acknowledgement from the discovered owner for the original
turn. A small receipt containing IDs, without answer text, prevents duplicate
submission across restarts. An uncertain result preserves the draft and blocks
automatic retries.

Live proof on desktop **26.1023.6123.0** used the authorized disposable chat
`01a182bd-bc7e-77f2-a94e-2ee42f2709eb`. The production service delivered both
`Green sample` and `Free text reaches the same turn.` in **171 ms**. Read-only
history verified one native answer in the original active turn, and the waiting
agent acknowledged both answers. A second submission was blocked.

Implementation: [native question service](../../src/main/codex/nativeQuestions.ts),
[desktop connection](../../src/main/codex/desktopConnection.ts), and
[card UI](../../src/renderer/panel/CodexQuestionCard.tsx).
The opt-in [live proof](../../test/live/codex-native-answer.proof.mjs) is restricted
to that disposable chat and two exact test questions. Focused unit checks passed
(31 tests across native questions, Codex tracking and compaction), as did the
isolated renderer smoke test, typecheck, lint and production build. Renderer
interaction and live provider delivery were tested separately.

This is an internal desktop protocol, verified for this installed build rather
than a public compatibility guarantee. The desktop steering method selects its
active turn internally; it does not accept a caller's expected turn ID. A fresh
read immediately before submission and exact acknowledgement checking reduce,
but cannot atomically eliminate, a race with turn completion. A mismatched or
lost acknowledgement is treated as uncertain and never automatically retried.
Blocking app-server questions and permission approvals are outside this adapter.

The investigations below are historical evidence for unsuccessful routes. Their
connection failure does not apply to the subsequently verified pipe integration.

## Direct composer messages

The human composer now uses the same independently initialized desktop connection
for ordinary Codex messages. An idle chat receives `thread-follower-start-turn`
(protocol version 2), with native thread settings inherited. An active chat receives
`thread-follower-steer-turn` (version 1). The existing owning desktop handles both;
no CLI writer or Shared Spaces enrollment is needed. If the owner is unavailable,
the composer retains the draft and asks the user to open the chat in Codex.

The main-process route validates the caller, enabled provider and listed chat.
The composer waits for acknowledgement before clearing its draft. Per-chat receipts
store client message ID, text hash and acknowledged turn ID, without copying the
message text. Uncertain submissions are never replayed. Read-only history can
reconcile them using the exact native `userMessage.clientId`; matching a draft's
text alone is not acceptance evidence. Confirmed turn IDs drive sent/reply status.
Claude's composer still calls its existing delivery route.

The opt-in [production-service proof](../../test/live/codex-native-messages.proof.mjs)
started an idle disposable chat in **511 ms**, then delivered a follow-up into the
same active turn in **40 ms**. Native history contained both exact client message
IDs, and the agent replied `Native start and follow-up received.` Unit checks cover
owner routing, settings inheritance, active steering, completion, invalid inputs,
duplicate clicks, uncertain delivery across restart and receipt reconciliation.
The isolated renderer check covers Enter/button submission, retained drafts on
failure, clearing after acceptance, and the unchanged Claude composer call.

## Earlier WebSocket candidate result

The authenticated shared-runtime candidate fails at desktop authentication on the
tested installed build. An independent client with valid credentials initializes
successfully. The actual desktop omits the Authorization header on all six observed
connection attempts and receives HTTP 401 each time. Therefore it cannot share
that authenticated connection with Threadlight through the tested local URL override.

| Component                                           | Tested version                                  |
| --------------------------------------------------- | ----------------------------------------------- |
| Desktop                                             | 26.1023.6123.0                                  |
| CLI                                                 | 0.165.0-alpha.1.2                               |
| Environment                                         | Fresh offline Windows Sandbox                   |
| Independent client, no token                        | HTTP 401                                        |
| Independent client, wrong token                     | HTTP 401                                        |
| Independent client, correct token                   | HTTP 101 and successful JSON-RPC initialization |
| Actual desktop, local URL override                  | Six attempts without Authorization; HTTP 401    |
| Native question submission and desktop continuation | Not reached                                     |

The archive and CLI hashes are in the [sanitized result](CODEX-DESKTOP-AUTH-20261028.json).
Fresh distribution files were copied from the current installation and their hashes
matched the guest copies. An initial rerun also reproduced the failure on the older
26.1021.3705.0 / 0.164.0-alpha.11.1 distribution; that older run is not the evidence
for the current-build conclusion.

The [reproducible guest harness](../../test/live/codex-desktop-auth/README.md) saves
results before cleanup, resolving the earlier probe's lost-result problem. It uses
a transparent observer that records header presence and status only. Tokens stay
guest-local. No real account sign-in or model execution is involved, and no native
question in a user conversation was answered or dismissed.

## Scope of the finding

Read-only inspection of the current desktop archive finds a handshake callback for
a separate remote-host path, but not the tested local WebSocket override. The live
Windows app-server process still has a stdio invocation and no observed listening
TCP endpoint. This does not prove that every future build or every possible launch
arrangement lacks an integration route.

[Codex's official App Server reference](https://learn.chatgpt.com/docs/app-server)
documents bearer-token authentication for WebSocket clients and responses to live
`item/tool/requestUserInput` requests. The protocol's availability does not establish
an independently accessible connection to this desktop instance. The installed CLI's
generated request schema also exposes no generic request-list/answer API that could
replace possession of the live request connection.

## Implementation consequence

The connection gate is failed for this candidate. No desktop adapter, native-card
Send button or production write capability has been enabled on the basis of this
experiment. A new CLI writer, ordinary queued message, changed transcript/database,
or a relabelled clipboard action would not resolve the original pending question.

Remaining work is contingent on a verified desktop connection arrangement: establish
authentication and shared request ownership, correlate exact request IDs, wire the
answer UI, confirm resolution, and test expiration, disconnect and competing answers
in the same desktop chat. A different arrangement requires its own proof, including
desktop tool ownership and lifecycle behavior, before deployment.

Threadlight-managed questions are a separate possible route for future cards. They
change how the agent asks and do not answer an already open Codex-native card. That
scope change was presented to the user rather than silently substituted.
The user subsequently chose that route; its implementation and validation are
documented in the [managed decision-card specification](../specs/MANAGED-DECISION-CARDS-SPEC.md).
The user later corrected the requirement: native desktop cards must work independently
of Shared Spaces. Managed questions are not the implementation of that requirement.

## Verification

- Guest identity guards passed; only distribution/scripts and the results directory
  were mapped. Network and clipboard sharing were disabled.
- Both negative authentication controls failed and the positive control initialized.
- The actual current desktop attempted the same observed endpoint and failed.
- The result was saved and verified before the disposable Sandbox was closed.
- The existing desktop and its active conversations were not restarted or modified.
- Application source was not changed by this investigation; application unit/build
  results would not validate this transport and were not rerun as substitute evidence.

## Follow-up: real desktop asynchronous cards

The user authorized a disposable desktop chat for fresh native-card tests:
`01a182bd-bc7e-77f2-a94e-2ee42f2709eb`. Claude hooks and messaging were not changed.

Read-only inspection of this desktop build distinguishes two mechanisms:

- Blocking app-server questions use the live JSON-RPC response connection described above.
- Desktop `request_user_input_async` cards are projected as `agentMessage` items with
  `delivery: async` and `questions`. The desktop builds a question ID from the source
  item ID and question index, and sends a structured question-reply message. Its
  pending-card calculation requires an `inProgress` turn and excludes accepted replies.

This distinction matters: the blocking-request transport experiment alone does not
establish whether asynchronous desktop answers can be delivered another way.

The installed CLI's documented `codex queue` command was tested with an exact native
question-reply envelope, using only the disposable chat. The CLI reported successful
queueing of message `01a182c0-8538-72d3-a3b0-0e64a07bf736` at 13:43:37 London time.
The running test agent continued waiting and reported a timeout at 13:45:58. The
queued answer then began a **new turn** at 13:45:59, which acknowledged `Blue sample`.
History confirmed the exact question ID and answer were retained. This proves eventual
delivery, not an immediate answer to the active turn. No production Send button was
enabled on this evidence, and the test message was consumed rather than left queued.

`codex app-server daemon version` also found no reachable local daemon control socket
for the existing desktop session. A managed daemon is not interchangeable with this
desktop's current stdio runtime. Native accessibility exposed window content after
raising the window, but an attempted button action failed with `coordinate input
geometry is unavailable`; reliable native-control submission is still unverified.

Separately, Threadlight was reconstructing old async questions as pending after their
turn had ended. The Codex tracker now uses the authoritative terminal turn status to
expire those cards. It retains active questions and ordinary end-of-turn questions.
Focused tests cover desktop projections, rollout async calls, all three terminal
statuses, and the read-only tracker caller against both projection schema variants.
This lifecycle correction does **not** claim that native submission is complete.

The next transport proof needed to demonstrate an exact asynchronous answer accepted during
the original active desktop turn, followed by native-card resolution. It must also
reject stale or mismatched question IDs and avoid duplicate submissions on uncertain
delivery. The local desktop coordination proof above now supplies that evidence.
Claude's existing path remains outside the change scope.
