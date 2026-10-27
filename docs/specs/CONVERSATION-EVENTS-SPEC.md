# Conversation cards and background return events

Status: implemented locally, 26 October 2026; validation and remaining human
acceptance are recorded below. Wednesday's provider
acceptance and additional-destination work is recorded in
`THREAD-COMMUNICATION-VALIDATION.md`.

## Outcome

Threadlight remains the conversation and orchestration layer. Existing Claude
and Codex chats perform the work. A worker's question appears immediately within
the relevant Threadlight conversation, retaining the identity and response path
of the original request. A result appears as a durable event card. During an
active GPT Live conversation, Threadlight briefly announces these events at an
appropriate pause. The user can keep talking while several workers wait.

Example: UI asks for a layout choice while Build is running tests. The UI card
appears without interrupting speech. At a pause, Threadlight says, “The UI thread
needs a layout choice.” The user's answer is routed to that exact UI request.
Build's result can arrive independently; its result card appears immediately and
its spoken summary waits for the next suitable pause.

## Current code and gaps

| Existing code                                                  | Reuse and required change                                                                                                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/communication.ts`                                  | Existing native request IDs/generations, project questions, deliveries and events. Add request revisions, field IDs, explicit outcomes and conversation event contracts. Destination is currently local and Claude/Codex only.         |
| `src/main/communication/service.ts`                            | Existing native response validation, human-input checks, operation replay, question answers and correlated results. Retain these rules; replace global request focus with conversation-bound focus.                                    |
| `src/main/communication/store.ts`                              | Durable messages and event cursor. Current event rows are entity/action notifications, with a bounded recent window; they are not a complete conversation presentation or speech-delivery log.                                         |
| `src/main/communication/ownedRequests.ts`                      | Native callbacks stay with their owner. Currently takes `requests[0]`, exposes question text without field IDs, and removes vanished handles. Expose every supported request, preserve field identity and publish lifecycle changes.   |
| `src/main/index.ts`, Claude/Codex holds                        | Existing callback and owned-runtime sources. Adapt their actual observations; a heuristic attention signal is not an answerable native question.                                                                                       |
| `src/main/memory/integration.ts`                               | Store changes broadcast renderer invalidation. Add a scoped conversation-feed service and provider request-change subscriptions. Native changes must not depend on an unrelated database write to refresh.                             |
| `src/renderer/communication/CommunicationView.tsx`             | Existing cards and history inside a compact Background messages disclosure. Extract reusable card presentation into the conversation timeline. Current human questions/native requests are not fully scoped by the conversation owner. |
| `src/renderer/panel/AgentView.tsx`, `AgentRequestCard.tsx`     | Reuse conversation layout and request controls. Keep the original card accessible in its native source too.                                                                                                                            |
| `src/main/agent/codexLive.ts`, `src/renderer/lib/liveVoice.ts` | Existing Live start/stop, transcripts and audio playback. No implemented general external-completion-to-speech injection path or pause-aware announcement queue. Implement and prove that path explicitly.                             |

## 1. Source identity and capability

A card is a projection of a source record, not a newly created question or a
forwarded prompt. Its immutable source reference contains host ID, provider,
native thread ID, owning runtime generation, native turn/request ID where
available, and service request ID. Display title and workspace are metadata.
For Threadlight project questions, use the stored question ID and generation and
identify the source as a Threadlight question; do not imply native ownership.

Each request additionally has a revision, kind, schema with stable question and
option IDs, observation time, provider expiry when supplied, and current response
capability. Keep connection-local RPC IDs and callbacks inside their owner.
Resolve public handles through that owner immediately before response submission.
Two questions with identical wording remain distinct.

Additional workers and remote hosts use the same contracts. Individually admit
read, send, observe, question response and approval response. An unobservable
request may offer “Open source chat”; it must not offer a simulated answer path.

## 2. Conversation scope and feed

Add a main-process `ConversationEventService` with a durable feed repository.
Bind each dispatched message/task to its originating conversation ID, and store
explicit project subscriptions for Brainstorm conversations. Authorization and
these bindings determine the audience; the currently open panel does not.
An unsolicited event from an unrelated authorized chat remains in the project or
global inbox unless that conversation explicitly subscribes to it. Never inject
all accessible human questions into every conversation.

Each feed entry carries an event ID, monotonic sequence, conversation ID, source
reference and revision, kind, causal message/attempt/task IDs, timestamps,
evidence reference and presentation state. Types include request opened/updated/
resolved/unavailable and execution result/failed/interrupted/uncertain.
Keep content scoped and bounded; reference saved result details and artifacts.

Persist communication outcome and feed publication intent atomically. Use an
outbox/projector for external provider events and a unique source-event/revision
key to suppress replay. Never deduplicate by title, text or arrival time.
IPC sends invalidation with a cursor; the renderer loads authorized deltas.
On a cursor gap, load a full scoped snapshot and merge by stable card ID.
Renderer reload must not create duplicate cards or speech requests.

Historical cards are durable. Native response authority is ephemeral and must be
revalidated after restart; saved history cannot reconstruct a live callback.

## 3. Card lifecycle and presentation

Render cards as timeline entries alongside user and Agent messages. Show source
chat title, provider/host, task context, question or result, current state, and
an “Open source” action when supported. Preserve arrival order without stealing
input focus or jumping the scroll position while the user reads older messages.
Show an unread/new-events affordance when the timeline is scrolled away.

Reuse the existing structured question/approval controls; preserve native
wording, choices, constraints and permission scope. Agent narration may summarize
the need but must not rewrite the actionable request. Keep secret questions in
the native surface; do not copy or announce their contents.

Request states: pending, submitting, answered-here, answered-elsewhere, expired,
cancelled, unavailable and response-uncertain. Disable controls when no longer
answerable. Update the same card in place and retain it in history. Only claim
answered-elsewhere when the provider supplies evidence; disappearance alone
means unavailable, not answered. Distinguish provider expiry from a local stale
observation timeout.

Each card has independent submission/error state. Several workers can wait
without blocking the conversation or disabling other cards. Duplicate views of
one request share one server-owned lifecycle. Native source and conversation
views may both remain open.

## 4. Exact answer routing

Submit `{ operationId, conversationId, requestId, generation, expectedRevision,
answersByFieldId }` through `CommunicationService`; approvals retain their own
typed action and scope. Validate current audience, membership, owner connection,
generation, schema, revision, expiry and live pending state at the last possible
moment. Serialize competing responses to the same request and use the native
provider's response semantics where available.

Persist an answer attempt before I/O. A confirmed native response updates all
views. A stale/conflicting answer returns the refreshed card without retargeting.
If the connection fails after submission, show response-uncertain and reconcile;
do not resend automatically. Repeated operation IDs return the existing outcome.
If the provider cannot distinguish delivery from acceptance, preserve that limit.

For voice, store focus as `{ conversationId, requestId, generation, revision,
focusedAt }`. Focus comes from selecting a card or an explicit unambiguous
reference to it. “Use the second option” is valid only against that exact current
schema and a subsequent user utterance. If multiple requests could match, ask
which card and send nothing. Changing/expiring a request invalidates old focus.
Peers and inferred user intent cannot approve native permissions. Preserve
existing human-input verification and require explicit approval for the precise
request. Project answers use their existing durable question/answer route.

## 5. Results as events

Subscribe to supported adapters' correlated completion/failure events and the
communication journal. Materialize a result card once the evidence is persisted,
without waiting for another user utterance or model tool call. Target: within
500 ms of a local event commit in the UI test; remote latency is measured from
local receipt and source observation age remains visible.

A transport receipt is not a task result. A finished turn that yields a question
produces a needs-input event, not “task complete”. Keep delivery completion,
execution termination, result submission and accepted assignment output distinct.
Expose these distinctions structurally; do not infer them from the word “done”.
An unrelated chat finishing becomes a conversation event only through a
supported observer and an explicit audience binding. Reading the latest text or
seeing an idle status does not establish a correlated result.

## 6. Spoken return path

Add an `AnnouncementScheduler` backed by durable per-conversation event states:
pending, reserved, submitted, playback-started, announced, superseded, suppressed
and uncertain. Separate visual/read state from speech state. Update cards
immediately; speech is an optional later presentation of the same event.

The scheduler may speak only in the matching active GPT Live session. Local STT
does not start GPT Live, synthesize speech or preconnect. A closed, muted,
disconnected or different conversation receives cards/unread state only. On
return, offer a compact catch-up instead of replaying every old update.

Use explicit user-speaking and assistant-response/playback lifecycle signals.
Proposed initial pause rule: user speech ended for at least 800 ms, no active
assistant response/playback, and no opening audio buffer awaiting handoff.
Audio energy alone cannot establish a conversational turn boundary. If the
required signal is unavailable, defer speech and keep the card visible. Recheck
the voice session generation and pause state immediately before submission.
Never interrupt the user to announce a result; user speech takes priority.

Coalesce events that arrive together into one short update, naming the sources:
“UI needs a choice, and Build's test results are ready.” Announce a request once
per meaningful revision; suppress it if answered before the pause. Result speech
should state verified outcome and any next action in one or two sentences.
Full output stays in the card. Prioritize pending human input over ordinary
results and retain queued events without repeated nagging.

Implement a typed `announceEvents` adapter boundary. First prove which supported
path the installed Codex Live runtime provides for an external context event and
an audio response, with correlation, interruption and playback completion.
Existing start/stop/transcript events do not prove that capability. Do not invent
an RPC, inject a fake human utterance, or treat a prompt instruction as an event
transport. Feed verified bounded event context as system-owned data, never peer
instructions or approval authority. The announcement must not redispatch work.

Correlate the submitted announcement with actual response and playback evidence.
Mark announced only after supported playback completion evidence. A lost
acknowledgement or disconnect becomes uncertain, never automatic speech replay.
Interrupted announcements retain that status; let the user request a repeat.
If no supported injection/observation path exists, ship cards separately with
spoken announcements explicitly unavailable; the full voice milestone remains
incomplete until the adapter and real audio E2E pass.

## 7. Implementation order

1. Complete Wednesday's real Claude Desktop admission test; inventory and admit
   additional worker/remote operations only with actual transport evidence.
2. Implement request identity/lifecycle adapters, all pending owned requests,
   field IDs, conversation scoping and exact response races.
3. Add durable feed/outbox and result observers, then inline card projection.
4. Prove the installed Live event-injection and playback-observation capability;
   implement the adapter, pause scheduler and durable announcement receipts.
5. Run the multi-worker native and voice E2Es below. Record provider/runtime
   versions and capability-specific evidence before enabling automatic speech.

## 8. Acceptance and test plan

- Unit/service: same titles on different hosts; repeated question wording;
  multiple pending requests per owner; generation/revision changes; revoked
  grants; wrong audience; duplicate response operations; competing native/card
  answers; disconnect after submit; restart without replay; cursor gap recovery.
- UI: cards appear while the user types/talks; multiple workers wait independently;
  native wording and source retained; answered/expired/unavailable states update
  every view; one failed response does not disable others; reload preserves
  timeline; no cross-conversation leakage or scroll/focus theft.
- Result pipeline: receipt is not result; question yield is not task success;
  explicit correlated completion creates one result card; duplicate/out-of-order
  events and reconnect replay do not duplicate it; accepted outputs stay distinct.
- Voice: no speech during user/assistant speech or opening buffering; burst
  coalescing; resolution before announcement; ambiguous “second option”; exact
  native approval; user interruption; muted/offline/wrong session; Local STT
  isolation; disconnect between submission and playback; no duplicate speech
  after reload/reconnect; no task redispatch from announcement context.
- Real E2E: use existing UI and Build chats concurrently. UI asks a choice; Build
  returns a result while the user talks. See both cards promptly, hear one short
  update at a pause, answer UI precisely, then answer/expire another request in
  the native app and verify Threadlight updates. Repeat with supported Claude
  Desktop and Codex paths; separately prove each admitted remote host path.
- Capture event/attempt/request IDs, source generations, commit/display/submit/
  playback timestamps, response acknowledgements and redacted UI/audio evidence.
  Tests must show actual audio and actual native response receipt, not only
  transcript text, synthetic cards or mocked adapters.

Done means the supported providers pass this complete return path with auditable
evidence. Unsupported destinations and unproven speech capabilities remain
explicitly unavailable.

## Implementation and validation — 26 October 2026

The implementation reuses `CommunicationStore` and its SQLite transaction/event
history, `CommunicationService` response authority, the existing native hold and
owned-runtime adapters, `AgentRequestCard`, the existing project question control,
and `LiveVoiceConnection`. It does not create another worker runtime, voice
connection or card-design system.

- `ConversationEventService` persists conversation bindings, anchored cards,
  revisions and speech receipts as validated communication records. They travel
  through the existing backup/restore mechanism. The renderer reuses existing
  invalidation broadcasts and reloads a bounded, scoped snapshot; recovery does
  not depend on retaining every intermediate UI event. Historical cards are
  capped at 2,000 per conversation while preserving active requests; the underlying
  communication history remains separate.
- `ConversationTimeline` puts existing request controls between conversation
  lines, preserves arrival order and source identity, updates closed cards in
  place, and keeps each card's submission state independent. Historical views
  use their own conversation ID. New-update navigation preserves scroll position.
- Owned requests retain their owning service, generation and field IDs and expose
  all nonsecret pending requests. Voice focus is conversation-specific. Partial
  Live transcripts cannot authorize native responses. Providers that only show
  a request disappearing produce `unavailable`, not an invented external answer.
- Questions can carry `originMessageId`. A yielding Claude completion carries
  `questionId`; the service verifies the relationship. The answer delivery's
  later result returns to the originating conversation, including one-off work.
- Speech reuses `thread/realtime/appendSpeech`. The installed native protocol
  exposed this method, and native WebRTC probes verified audible-content output.
  `turn.created`/`turn.done` with explicit user/assistant roles establish pause
  boundaries. Input/output energy only vetoes a pause or supplies playback
  evidence. The scheduler waits 800 ms, coalesces up to three updates, rechecks
  card revisions and the voice session, and never creates a fake user turn.
- A speech receipt is marked announced only after the expected status transcript,
  the matching locally tracked assistant turn's completion, observed output audio
  and a quiet playback interval. Mismatch, interruption or disconnect remains
  uncertain and is not replayed. This is local playback evidence, not a guarantee
  that a person heard it. Old pending updates have an explicit catch-up action;
  Local STT never starts a Live connection.

Official GPT-Live documentation distinguishes context acknowledgement from audio
playback and describes speakable commentary separately from factual context.
The implementation uses the installed Codex adapter and its observed native
events rather than assuming API event names match that adapter.
[Managing GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations).

Native transport evidence: `Z:/Temp/threadlight-live-check-22HM8j` (speech append),
`Z:/Temp/threadlight-live-check-SY8k4n` (user/assistant turn boundaries), and
`Z:/Temp/threadlight-live-check-QccOrL` (production journal, feed, scheduler and
observed announcement playback). These use generated test speech and a synthetic
background result with the real signed-in Codex Live runtime; no physical
microphone or speaker was used.

Real Claude delivery/question/answer evidence with explicit origin correlation:
`Z:/Temp/threadlight-wakeup-kCeWUp/proof.json`. This is a disposable native CLI
conversation, not Claude Desktop sign-off.

Focused tests cover feed isolation, exact request routing, multiple owned
requests, repeated wording, stale responses, duplicate projection, uncertain
speech recovery, question-yield separation, answer results, backup/restore and
the scheduler's boundary/playback requirements. The actual built UI smoke test
passed two independent cards, exact response routing, native disappearance,
result arrival and switching conversations without leaks.

Final native production-path evidence: `Z:/Temp/threadlight-live-check-5lIzrC`.
The diagnostic includes the saved card with `speech: announced`, its announcement
ID, the completed native transcript and audio evidence. The final local checks
passed 122 focused tests plus 12 packaged-plugin tests, TypeScript, focused lint,
plugin consistency, production build and diff checks. The Agent's 28-test suite
was rerun after restricting native response authority to completed user speech.

Remaining acceptance is the Wednesday human-operated Claude Desktop and concurrent
multi-worker/microphone scenario. Remote destinations remain capability-gated;
this implementation does not grant unsupported execution or native approval
paths. The production Claude Desktop wakeup allowlist remains empty.
