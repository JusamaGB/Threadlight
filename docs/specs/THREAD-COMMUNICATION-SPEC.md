# Thread communication and Brainstorm project coordination

Status: proposed implementation specification. No communication capability described as new below is implemented by this document.

Date: 26 October 2026. Baseline: commit `c2e1c151b0b9a301854374ae3e5ce26306eda91e` plus the current local working tree on `feat/agent-thread-reading`, including the locally implemented thread reader and voice buffering changes. This is not a claim about a released build.

Related specifications: [thread discovery and reading](AGENT-THREAD-DISCOVERY-SPEC.md), [Codex integration and transport gates](CODEX-INTEGRATION-SPEC.md), and [Shared Spaces plugin enrollment](SHARED-MEMORY-PLUGINS-SPEC.md). This document extends them for communication and workflow coordination; it does not retroactively mark their deferred capabilities complete.

## 1. Product outcome and boundaries

Threadlight provides reliable communication between existing Claude and Codex chats. The conversational Agent, Shared Spaces Brainstorm and enrolled project participants use the same service to resolve destinations, deliver messages, observe work, route answers and receive results. The existing provider models retain responsibility for reasoning and execution.

Brainstorm coordinates a live project according to a user-selected workflow: roles, models, destination chats, dependencies and rules for advancing work. New ideas update that project rather than automatically starting an unrelated plan. Participants can directly ask one another for information without requiring Brainstorm to rewrite every exchange.

Voice is an optional interface to the same operations, especially answering a card or requesting a one-off task. No communication operation requires GPT Live. Closing the microphone does not stop project work. Local STT / GPT Live selection, buffering, Send text to and deterministic keyword routing remain unchanged.

The first release supports local destinations through individually verified transports. Remote hosts, automatic creation of replacement chats, changing providers on failure, generic desktop UI automation and bypassing native session ownership are outside scope. Full cross-provider support cannot be claimed until actual Claude-to-Codex and Codex-to-Claude exchanges pass the installed-runtime proofs in section 15.

## 2. What exists today

These are code findings, not proposed behavior.

| Existing code                                                                                                        | Current behavior                                                                                                                                                                         | Required change                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/threadRead/`, `src/shared/threadRead.ts`                                                                   | Fresh local discovery and bounded reads through a private read-only MCP service; opaque references and source evidence                                                                   | Reuse resolution and freshness rules; preserve the read-only tool boundary; add communication-specific scoped resolution                                                            |
| `src/main/messaging/coordinator.ts`                                                                                  | Durable-operation logic for identity, queueing, epoch checks, uncertain delivery and correlated completion; explicitly gated pending a verified desktop adapter                          | Extract/generalize these invariants into the shared service; do not treat this as an enabled desktop transport                                                                      |
| `src/main/messaging/store.ts`, `src/shared/messaging.ts`                                                             | Atomic JSON draft/operation storage; submitting becomes unknown on recovery; queued becomes held; completed/cancelled message text is pruned after a day                                 | Preserve drafts and legacy recovery; use a canonical communication journal for new project operations and longer-lived history                                                      |
| `src/main/relay.ts`, `src/main/relayService.ts`                                                                      | Claude CLI resume, one in-flight send per session, process-start callback, final JSON reply; refuses a held session                                                                      | Adapt only after ownership/receipt tests; process started is not provider acceptance; no generic pending-question response channel exists here                                      |
| `src/main/codex/relay.ts`                                                                                            | Codex CLI resume and completion parsing; refuses live/held chats; sends stdin once                                                                                                       | Preserve restrictions; expose exact capabilities and native IDs where available; no arbitrary live desktop DM is supplied by this path                                              |
| `src/main/index.ts`, `src/main/sessions/service.ts`                                                                  | Routes composer and memory delivery through relays; lookup uses displayed session snapshots; status callbacks feed memory                                                                | Resolve participants independently of recent rows/expanded workspaces; one delivery arbiter across composer, Agent, Brainstorm and plugins; validate UI callers                     |
| `src/main/memory/dispatcher.ts`                                                                                      | Durable assignment outbox; sends only idle, non-live targets; at most two occupied destinations; observes reply by attempt ID                                                            | Delegate delivery to common service; keep assignment policy separate; explicit subscriptions and task relationships replace per-session inference                                   |
| `src/main/memory/store.ts`, `src/shared/memory.ts`                                                                   | Versioned items, grants, tasks, discussion messages, output submission, human resolution, subscriptions, dispatch/time limits and recovery                                               | Add communication records and workflow bindings; distinguish delivery, execution, submission and acceptance; migrate without reinterpreting old states                              |
| `src/main/memory/protocol.ts`                                                                                        | `memory_post_message` records discussion without waking a chat; `memory_submit_result` submits saved outputs; agents cannot perform human-only task authorization/resolution             | Add explicit communication tools and narrowly scoped workflow authority; preserve old tool semantics                                                                                |
| `src/main/memory/connections.ts`, `src/main/memory/server.ts`                                                        | Human-approved, expiring per-chat plugin connections and scoped capabilities                                                                                                             | Extend with explicit messaging scope and verified participant binding; memory access alone must not enable DMs                                                                      |
| `scripts/memory-bridge.mjs`, `scripts/package-memory-plugins.mjs`                                                    | Canonical bridge/protocol packaged for both providers; explicit connection ID on calls; five-second HTTP timeout                                                                         | Expose the same new contracts to both providers; mutations return quickly; do not put long waits behind this timeout                                                                |
| `src/shared/spaces.ts`, `src/main/spaces/service.ts`                                                                 | Brainstorm is discussion-only by prompt; user separately prepares reviewed assignments. Assignment schema has provider/assignee/brief but no role/model/dependency config                | Introduce versioned workflow setup, planning proposals and an event-driven coordinator under explicit user policy                                                                   |
| `src/main/agent/agentRun.ts`                                                                                         | Claude front desk waits for its foreground worker; `AskUserQuestion` is disabled in that owned runtime                                                                                   | Permit direct communication tools; dispatch must release the conversational turn; add a supported question path where needed, without claiming existing parity                      |
| `src/main/agent/codexAgentRun.ts`, `codexRequests.ts`                                                                | Owned Codex runtime has structured requests with connection-local response IDs                                                                                                           | Reuse parsing and routing within the owning connection; never apply those IDs to another process                                                                                    |
| `src/main/holds.ts`, `src/main/codex/holds.ts`                                                                       | Hook-held cards can be answered while the hook remains connected. Claude holds last up to 12 hours; Codex holds up to 60 seconds. Codex Stop questions use a trailing-question heuristic | Wrap real response capabilities with stable request/generation identity, expiry and provenance; heuristic attention alone does not establish a task question or successful delivery |
| `src/renderer/memory/MemoryView.tsx`, `src/renderer/spaces/SharedSpacesView.tsx`, `src/renderer/panel/AgentView.tsx` | Separate discussion, assignment, Brainstorm and Agent views                                                                                                                              | Shared message/task/request presentation with destination, evidence, status and source links                                                                                        |

The Codex app tools available to the coding assistant (`send_message_to_thread`, `wait_threads`, etc.) are not automatically available to Threadlight's hosted runtimes or Claude. Implement against actual Threadlight adapters; do not assume access to the enclosing Codex app's private tool service.

## 3. DMs and Shared Spaces

Direct messaging is the normal way to ask a participant something or give it authorized work. Shared Spaces is the durable project record and shared artifact store.

- A project DM is persisted once, delivered to its recipient and automatically visible in the project's communication timeline. The record includes sender, recipient, body, project/task association, reply relationship and delivery evidence. The sender does not also call `memory_post_message`.
- A reply is addressed to its original sender, linked to the original message and visible to Brainstorm when it belongs to that project. Project DMs are visible to authorized project members; the UI must say this. “Direct” describes addressing, not privacy from the project.
- A note is deliberately passive. Existing `memory_post_message` remains a note/comment operation and never starts waking recipients after an upgrade. Label its UI action “Add note”; label delivery “Send to chat”. Preserve historical discussions as notes, not purported past deliveries.
- Decisions, specifications, exact input versions and result files remain shared items. DMs can link these items; a decision in chat does not become an accepted canonical decision until the configured acceptance rule is satisfied.
- Do not mirror all native chat history. Record Threadlight-mediated messages, relevant explicit replies/results and references to source turns. Unrelated private chats and internal reasoning are not copied into a project.
- One-off Agent requests use the same communication records without requiring a Shared Space. Only the originating conversation/user and permitted recipient can inspect that exchange. They are not automatically added to the last-open project.

Group communication is explicit fan-out to selected project participants. One group message has separate recipient deliveries and outcomes. No all-participant broadcast by default, no implicit broadcast reply, and no single “delivered” badge when only some recipients received it.

## 4. Canonical service and identity

Add a provider-neutral `CommunicationService` with adapters. All sends from the panel, Agent, Brainstorm, memory assignments and participant plugins must pass through it before group automation is enabled. It owns per-destination serialization, durable operation IDs and receipt handling. There must not be competing relay queues able to start two writers for the same native chat.

Use a structured destination identity: `{ hostId, provider, nativeThreadId }`. Initially `hostId` is local only. Store workspace binding and display title separately; titles can change and are never identity. UI or model input must not select arbitrary working directories, endpoint URLs, permission flags or executable paths.

Project participants have stable participant IDs bound to a verified destination and an explicit role. Plugin connection labels/provider claims are insufficient proof of native thread identity. Bind a connection through host-provided identity where available and the user-approved destination selection; expose the assurance level. Ambiguous or unbound connections may read their existing memory scope but cannot impersonate a project sender.

Discovery returns scoped service references. Current reader references may be connection-scoped; resolve them inside the service and mint a communication reference rather than persisting/reusing another connection's opaque token. At dispatch, revalidate provider enabled state, archive state, workspace, membership, model constraints, session ownership and transport generation. A renamed chat retains its identity; a missing/rebound chat does not silently inherit queued work.

Capability lookup returns individual operations and reasons: read, send-now, queue, observe, respond-to-question, respond-to-approval, interrupt, requested-model selection, plus observation time and generation. Reachability, model availability and successful delivery are separate facts.

## 5. Transport admission and initial capability matrix

| Destination path                 | Present evidence                                                      | Admission rule                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle, unheld Claude CLI chat     | Resume/send/final reply exists                                        | Candidate for asynchronous DM; require native identity, ownership races, preserved content and recovery proofs before enabling orchestration             |
| Idle, unheld Codex CLI chat      | Resume/send/completion exists                                         | Same gate; capture acceptance/turn identity when supported; process spawn cannot substitute                                                              |
| Open Claude/Codex desktop chat   | Existing relay deliberately refuses competing ownership               | Ordinary send remains unavailable until an independently verified supported adapter exists; a plugin connection alone does not provide wakeup            |
| Live hook-held card              | Existing callback may accept an answer                                | Answer only that exact current request; this is not permission or capability to send arbitrary messages                                                  |
| Threadlight-owned Codex runtime  | Native request/response and turn events exist                         | Can form an interactive adapter when the service owns that specific destination connection; do not steal the front desk's connection for background work |
| Threadlight-owned Claude runtime | Permission handling exists; owned question tool is currently disabled | Verify or implement explicit question support before advertising it; retain provider-specific limitations                                                |
| Remote/cloud destination         | No admitted communication adapter in this slice                       | Explicit unsupported result                                                                                                                              |

Local locks protect against other Threadlight sends, not a native app opening the same chat between check and submit. An adapter must demonstrate native ownership enforcement or a safe exclusive handoff. If it cannot, mark its operation unavailable instead of weakening checks. The implementation's first deliverable is this capability proof; mocks alone cannot unlock a transport.

Stored inbox delivery and native wakeup are separate capabilities. A connected participant may read pending messages through its tools at a natural boundary. Unless a supported transport actually starts/continues its native turn, show “queued” or “available in inbox”, never “chat notified”.

## 6. Records, state and recovery

Persist these typed records; provider callbacks and model conversation memory are not the source of truth:

| Record           | Required information                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message          | ID/operation ID, immutable body and hash, authenticated sender, destination(s), project/task scope, kind (`request`, `question`, `answer`, `information`, `result`), correlation/reply-to IDs, timestamp, workflow revision and authority reference |
| Delivery attempt | Message/recipient ID, destination identity, adapter/generation, queue position, attempt ID, provider receipt/turn IDs when available, phase, reason and evidence                                                                                    |
| Execution        | Assignment/message relationship, native turn(s), activity/attention, observed time, terminal outcome and result provenance                                                                                                                          |
| Pending request  | Service request ID, destination/turn/generation, provider request or hook identity, request kind/schema, expiry, response capability, question audience and answer operation                                                                        |
| Workflow         | Project identity, revision, participants/roles/model choices, progression rules, dependency graph, approved scope, limits and pause state                                                                                                           |
| Event            | Monotonic cursor, stable ID, causal operation, entity revision, actor, type and timestamp; notification/reconciliation consumer cursors                                                                                                             |

Keep three independent dimensions:

- Delivery: queued → submitting → accepted, rejected or unknown; unsent messages can be held/cancelled. Acceptance requires evidence. A transport lacking an acceptance event may remain submitting until a verified correlated terminal event.
- Execution: running, needs-input, finished, failed, interrupted or unknown. “Finished” describes the provider turn, including a turn ending with a question.
- Assignment: planned, ready, active, blocked, result-submitted, accepted, superseded or cancelled. Only the configured acceptance rule releases dependents that require accepted work.

Persist before transport I/O. Reusing the same operation ID with identical content returns its prior outcome; changed content with that ID is rejected. Correlate by IDs, not title, reply similarity, latest session status or a trailing question mark. Preserve multiline replies; the Claude relay currently normalizes its output to one line and must not be the canonical project transcript representation.

Use new versioned communication/workflow tables in the existing local Shared Spaces SQLite database, accessed through a dedicated repository. Message creation, its outbox row and its project event commit atomically. A standalone message can have a null project without receiving Shared Spaces grants. Database unavailability fails new sends before dispatch; no untracked fallback. Native provider history remains separate and untouched.

Keep the JSON composer draft store. Reconcile/migrate legacy operations once using an import ID, preserving uncertainty and held queues. Legacy `MemoryTask.completed` means a provider reply occurred, not newly accepted work. Old `resolved` remains human-accepted; old notes remain notes. Backup/restore must include the new tables; restore revokes live response capabilities and pauses coordination. Existing active delivery must be resolved or safely quiesced before migration.

On restart, revalidate grants, participants and transport generations. Interrupted submits become unknown unless correlated evidence proves their outcome; never blindly resend. Queued operations become held until the coordinator revalidates unchanged scope/policy/dependencies. Only workflows explicitly configured for restart recovery may release those operations automatically; other queues retain explicit resume. Pending native callbacks are not restored as if still alive.

Native delivery is not guaranteed exactly once. Promise idempotent local submission, duplicate event suppression and honest uncertain outcomes. A verified retry after known non-delivery uses a new attempt linked to the same message. Uncertain user answers must also be reconciled before retrying.

## 7. Shared tool contracts

Names below are proposed. Typed schemas and tool allowlists must be generated from one canonical definition for the hosted Agent and both provider plugins. Plugin calls retain explicit per-chat `connectionId`; caller identity/authority is injected by the service, not supplied as model-controlled sender text.

| Tool                                    | Contract                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing find/read tools                | Fresh scoped discovery/history; still no mutations. Project participants see only permitted destinations/context                                                                                                                     |
| `threadlight_get_destination`           | Resolve a service reference or authorized participant ID; return current identity, model information and exact transport capabilities                                                                                                |
| `threadlight_send_message`              | Operation ID, target reference, body, optional task and reply-to; explicit send/queue intent. Derive/validate project from scope. Return durable message ID and current delivery evidence promptly, not a fabricated recipient reply |
| `threadlight_get_message`               | Read one message, recipient deliveries and correlated outcomes by ID; optionally revalidate provider evidence                                                                                                                        |
| `threadlight_read_inbox`                | Bounded authorized incoming messages after cursor; returns persisted cursor and current attention; reading is not accepting work                                                                                                     |
| `threadlight_read_communication_events` | Bounded events after cursor; gap/retention returns snapshot-required. Non-blocking for the existing five-second plugin HTTP bridge                                                                                                   |
| `threadlight_ask_question`              | For participating workers: create a task-linked question with schema and audience (participant/role/user); return request ID promptly. Does not manufacture a native approval or keep an MCP request open indefinitely               |
| `threadlight_answer_request`            | Operation ID, exact request ID and generation, validated answer. Route through the owning callback or an explicitly supported continuation. Return response receipt; separate human approval decisions from informational answers    |
| `threadlight_cancel_message`            | Cancel a definitely unsent delivery only; running-task interruption is a separate adapter capability and explicit action                                                                                                             |

Result publication reuses `memory_submit_result` for project assignments, preserving exact output versions. One-off results can reference the correlated native result without forcing a saved item. A correlated DM marked result is evidence of a participant report, not automatic acceptance of an assignment.

The common service also provides internal watch subscriptions for UI and workflow scheduling. It must not require the conversational model to keep calling a blocking wait tool while the user is talking. Native application tools are not automatically bridged into these APIs.

## 8. Direct participant communication and group rules

Both Claude and Codex receive the same scoped communication tools. A participant can ask a permitted peer, receive its reply and continue its task. Brainstorm observes project exchanges but need not mediate each sentence.

Workflow setup grants named participants explicit permission to communicate for this project, allowed roles/destinations and whether they may request work or only exchange information. Existing read/write/delegate memory grants do not silently expand into messaging grants. No per-message user confirmation is needed inside an already authorized workflow, subject to the recipient runtime's own permissions. A peer message cannot expand project scope, grant filesystem permissions or impersonate the user.

Deliver a labelled envelope into native chat context: project/task, real sender, request type, reply handle and referenced input versions. Include instructions to use the reply handle when responding. Never present a peer DM as a fresh human instruction. Authenticated identity remains out-of-band; copying the envelope cannot forge a sender.

Peer questions use asynchronous delivery. If chat A asks B while A is working, A can continue independent work or finish its turn with an explicit waiting status. B's answer is recorded immediately and queued for A's next supported intake boundary. Do not block A's native connection on an MCP call while the answer requires that same connection to become idle. Do not invent mid-turn injection when unsupported. Reciprocal waits are detected as dependency cycles and surfaced to Brainstorm/user.

Information-only messages do not require acknowledgements. Replies do not automatically trigger replies. Group messages freeze recipients at submission and record individual outcomes; late membership changes do not silently add recipients. Explicit reply-to-sender and reply-to-group actions remain distinct.

Initial configurable limits: one active writer per destination, two concurrent background executions per project, ten delivery attempts per causal peer exchange, and the existing space dispatch/expiry limits as an overall ceiling. Count peer wakeups, Brainstorm automatic turns and retries against explicit budgets; log blocked attempts without initiating another model turn. Rate-limit/coalesce repeated events. Reaching a limit pauses the exchange with a visible reason, never discards its history.

Project DMs and accepted decisions have different authority. A peer may supply an answer within its assigned role; it cannot approve another chat's permission card. General native prompts asking the human are surfaced to the human unless the workflow explicitly authorizes Brainstorm to answer that class of informational question from established project facts. Preserve the real answer author.

## 9. Cards and response routing

Use one request representation for native structured questions, live hook-held cards and explicit project questions. Preserve their different wire protocols and lifetime rules behind adapters.

Each card shows source chat/provider, project/task, actual question/action, whether it is answerable here and expiry/unavailability. Before answering, revalidate the exact request, owner generation and schema. Duplicate clicks/voice retries use the same operation ID. A replacement question never inherits the old response.

Claude's existing session-only hold response entry points need a request/generation token: a stale card must not answer a newer hold in the same chat. Codex already checks a hold ID, but its short timeout must be visible. Owned Codex RPC responses are usable only on the connection that owns the pending request.

Voice may answer a clearly focused card: “Choose the second option” refers to that card's current options. Ambiguous “yes” when multiple cards are pending requires selection. Secret-input questions remain in an appropriate private input control, not project transcripts or speech. Permission approval requires an explicit human decision bound to the presented action; a project role grant does not imply approval.

Human-response authority originates in the trusted UI/input path and is bound to that request. A tool argument or peer message claiming “the user approved” is not sufficient. The conversational model can resolve the user's answer, but the service checks the corresponding input/decision binding; project participants cannot mint it. Validate renderer sender and main-frame identity for all mutation IPC entry points during consolidation.

A plain-text question inferred from a native reply is attention evidence. Present it with provenance, but only expose an answer action when there is a live response capability or a supported new-turn continuation tied to the same task. Never convert an expired approval into an ordinary message saying “approved”.

Closing a card or microphone does not approve, reject or cancel work. Explicit dismissal can release a hook to its native app using existing behavior. Stopping a running task requires a verified interrupt operation; cancelling an unsent DM is not equivalent.

## 10. Brainstorm workflow configuration

Add a reviewed, versioned configuration per project:

- Roles with purpose, participant/destination binding, provider, selected model and supported reasoning settings; verify the actual effective model before dispatch. Existing relay builders use scanned session models and do not yet enforce a project role model.
- Project/workspace identity and accessible context/output folders. Existing chat bindings must match the project; intentionally shared external expertise requires explicit scope.
- Progression mode: manual, assisted or automatic, retaining existing meanings. Explicit automatic authority identifies which task transitions, result acceptance and peer exchanges it covers; it does not turn an agent into the human actor for all memory operations.
- Dependencies and acceptance requirements, review roles, allowed parallelism, resource conflicts, budgets, expiry and recovery behavior.
- When the user must decide: scope changes outside the approved goal, unavailable role/model, unresolved disagreement and native permission requests.

Changing the selected model must either be supported and verified for that destination's next turn or block dispatch with an actionable reason. Do not silently use the scanned old model, substitute another model or create a new chat. Configuration changes apply to future dispatches; running work retains the config/brief revision it received.

Existing projects migrate to their current manual/assisted behavior with automation off until the user configures it. Preserve discussion-only Brainstorm as a usable mode. Replace its current blanket discussion-only prompt only when the relevant workflow authority is present; prompting alone cannot grant that authority.

## 11. Brainstorm planning and event-driven execution

Brainstorm uses model reasoning for decomposition, assignment briefs, interpreting outcomes and proposing the next steps. Store those decisions as structured plan revisions validated by code.

Each assignment identifies goal, role, acceptance criteria, input versions, expected outputs, dependency conditions and resource claims. Code rejects missing destinations, cycles, unauthorized dependencies, stale revisions and unsupported model requirements. Shared-checkout writes require serialization or an explicitly configured isolated workspace; different chat IDs do not prove independent workspaces.

On a new idea, Brainstorm reads the latest project snapshot and relevant fresh thread evidence, then proposes changes to the existing plan. Unsent work may be superseded. Already delivered briefs remain immutable; amendments are separate correlated messages, delivered at supported boundaries. Hold affected downstream work until the change is assessed. Unrelated ready work can continue.

The scheduler releases work only when the saved workflow permits it, prerequisites satisfy their exact conditions, inputs/config remain current, and destination/resources are available. A reply or idle indicator alone cannot release a build/review dependency. A result may be accepted by the user or an explicitly authorized review role; store the actor, rule and evidence. Implement this as scoped workflow transitions, not by exposing current human-only `resolve_task` indiscriminately.

Persist subscriptions to delivery, question, result, failure and relevant idea/config changes. A background service receives those events, marks affected work and schedules a bounded Brainstorm turn with the project ID, snapshot revision and unseen events. A delivery acknowledgement alone updates UI/state without requiring a model call. Coalesce events while Brainstorm is busy; never open competing turns on its runtime. Commit the consumed cursor with the resulting decisions/outbox operations. Lost acknowledgements replay idempotently, not as repeated assignments.

Existing folder subscriptions must enter the same scheduler with a stable causal ID. A folder update and Brainstorm observing its submitted result must not independently create the same review assignment. Preserve manual subscriptions, show their ownership in workflow setup, and require an explicit migration/configuration choice before replacing an existing subscription with a workflow rule.

Ending a model turn does not end project tracking. Pausing coordination prevents new dispatches; existing provider work can finish and its results are still recorded. The user can inspect held work and reasons. A runtime disconnect marks observation uncertain without claiming that the destination stopped.

## 12. User experience and observability

Project view combines participant roles, current assignments and a communication timeline. Show queued, accepted, running, waiting, result submitted and accepted with precise meanings. Each held assignment has a reason and prerequisite. A result links to native source and saved outputs. Group messages show each recipient's status.

The Agent can answer “What is waiting on me?”, “What did Review tell Build?” and “Why hasn't this started?” using current service evidence. Routine background events should not clutter the main conversation. Questions and meaningful results become cards; optional spoken summaries wait for a conversational boundary and never reopen GPT Live. The same card can be answered through typing, Local STT or an already active Live session.

Persist structured diagnostics: operation/message/task/request IDs, participant identities, config revision, event cursor, adapter generation, receipt source and timestamps for enqueue, provider acceptance, question, response and result. Include explicit freshness/gaps. Never log bearer tokens, secrets or internal reasoning. Project members can inspect project communications; security grants must also apply to event pages, search and exports.

Retention is bounded and explicit: do not prune unresolved or uncertain operations or undelivered results. Paginate message/event history; a cursor gap requires a fresh snapshot. Preserve project history until user archive/purge policy applies, rather than the existing one-day composer text pruning. Deleted/revoked participants lose future access and delivery; historical authored records remain attributed without exposing removed credentials.

## 13. Implementation sequence and file plan

1. **Prove destination capabilities.** Extend installed-runtime harnesses for exact identity, ownership, acceptance, completion, card responses and two-way peer delivery. Publish a capability matrix with evidence and blocked paths. No live desktop send claim without its independent proof.
2. **Build the common communication core.** Add `src/shared/communication.ts` and `src/main/communication/{service,store,adapters,requests,events}.ts` (proposed paths). Version database migrations/backup; reuse coordinator invariants; route existing delivery callers through one arbiter while preserving old UI contracts.
3. **Expose cross-provider communication.** Extend canonical memory protocol/bridge/package generation with scoped tools. Separate communication permissions from memory grants. Register equivalent hosted Agent tools without adding writes to `threadlight_reader`. Prove direct Claude↔Codex exchanges and correlated replies before enabling project scheduling.
4. **Unify attention and results.** Adapt holds and owned runtime requests; add stale-card protection and common cards/timeline. Remove foreground waiting only for delegated communication; ordinary provider-owned worker behavior need not be rewritten globally.
5. **Add workflow setup and scheduling.** Extend `src/shared/spaces.ts`, Spaces store/service and UI; add `src/main/spaces/workflow.ts` for validated transitions/subscriptions. Extend memory tasks/acceptance with narrow policy authority. Persist roles, model requirements, dependencies and resource claims.
6. **Integrate and verify.** Update Brainstorm/Agent/participant prompts, migrations, packaging and user documentation. Add the live project scenario below. Keep existing discovery, voice routing and manual handoffs working.

Avoid a second queue in MemoryDispatcher or a separate DM transport per caller. The same operation ID must be traceable from model tool call through storage, delivery, destination turn, response and project event.

## 14. Focused regression and contract tests

Extend existing suites where behavior lives: `test/messaging.test.ts`, `relay.test.ts`, `relayService.test.ts`, `codex.test.ts`, `memory.test.ts`, `memoryPlugins.test.ts`, `spaces.test.ts`, `agentRun.test.ts`, `agentCodex.test.ts`, `threadRead.test.ts` and `threadReadAdapters.test.ts`. Add dedicated communication/workflow tests and actual UI callers in the existing memory/spaces/Agent smoke harnesses.

| ID    | Case                                                                              | Required evidence                                                                               |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| TC-01 | Duplicate titles, renamed chat, collapsed workspace, provider disabled, archive   | Exact identity or explicit clarification/block; view filters do not control routing             |
| TC-02 | Concurrent composer, Brainstorm and peer sends; native app ownership race         | One writer; supported queue ordering; no fork/steal of native session                           |
| TC-03 | Process starts, provider rejects, disconnect before/after acceptance              | Accurate receipts; no premature “sent”; uncertainty retained without automatic resend           |
| TC-04 | Duplicate operation/event, delayed reply, old generation, restart                 | No duplicate delivery/notification; source and causal IDs retained                              |
| TC-05 | Claude→Codex and Codex→Claude, reply-to and group fan-out                         | Real sender/destination, exact body, correct return route, individual recipient outcomes        |
| TC-06 | Existing passive note and new DM                                                  | Note never wakes; DM persists and delivers once; no manual duplicate logging                    |
| TC-07 | Expired/replaced/native-resolved card; duplicate answer; multiple pending cards   | Correct request or refusal; no stale answer/approval; ambiguity resolved                        |
| TC-08 | Information-only reply, reciprocal peer questions, chat busy                      | No acknowledgement loop or blocked-connection deadlock; limits/cycles visible                   |
| TC-09 | Spoofed sender, wrong connection, revoked grant, cross-project refs, secret input | Access rejected/redacted consistently across tools, UI, history and exports                     |
| TC-10 | Role model unavailable/mismatch, config changes mid-run                           | No silent fallback; running work retains revision; future dispatch revalidated                  |
| TC-11 | Dependency, failed review, stale inputs, shared-checkout conflict                 | Next work held with reason; release only after configured evidence/acceptance                   |
| TC-12 | New idea while tasks active; coalesced/replayed scheduler events                  | Immutable sent briefs; explicit amendment; affected dependents held; no duplicated plan actions |
| TC-13 | Database failure, legacy migration, backup/restore, cursor gap                    | No untracked sends; preserved uncertainty/history; callbacks revoked; snapshot recovery         |
| TC-14 | Microphone closes, user continues conversation, Live not active                   | Background work persists; front desk available; no automatic voice connection                   |

Before publishing implementation: fast protocol/package/schema and evidence checks; focused changed-behavior tests and actual caller snapshots; then lint, types, relevant build, format and diff checks. Expand local scope only for a new failure or affected area. This specification-only change requires document/link/format validation, not a product build or fabricated runtime evidence.

## 15. Installed-runtime acceptance

Use an isolated test project and owned/enrolled test chats. Never send synthetic tasks to unrelated user chats. Capture sanitized native IDs, tool receipts, task/request IDs and event timelines. Tests must traverse production tool registration, service, adapters and UI; a mocked transport alone is insufficient.

1. Configure existing Claude and Codex chats as project participants with selected models and explicit communication authority. Verify effective destinations/models. If an open desktop path is unsupported, demonstrate the block and use a separately verified supported path; do not pretend this proves desktop DM support.
2. From Claude, send Codex a bounded request; Codex replies directly using the reply handle. Verify the source chat receives the response at a supported boundary. Repeat with Codex initiating to Claude. Both exchanges appear once in project history with correct attribution.
3. Run a small project with an implementation role and a review role. Implementation requires one fact held by the other participant. It requests that fact, receives the answer and finishes. Brainstorm observes the exchange without manually forwarding it; review remains held until the configured prerequisite passes.
4. Cause a genuine human question/card, answer it through the user interface and separately through speech, and verify the destination consumes the specific answer. Include expiration/native-resolution and ambiguity. Do not force every normal task to ask a question.
5. Add a new idea while work runs. Verify Brainstorm updates the existing project plan, preserves delivered brief versions, holds affected downstream work and releases the right next assignment only after its gate passes.
6. Continue an unrelated front-desk conversation during work. Close the mic. Receive the result card and correct project state without reopening GPT Live. Exercise typed/Local STT and Live inputs as independent clients of the same service.
7. Restart during uncertain delivery and while a question is pending. Verify no duplicate sends, no restored stale approval capability, honest uncertainty and evidence-based recovery. Exercise pause, budgets, disconnected participants and failed review.

Exit criterion: both provider directions, one complete question/answer/result lifecycle and one dependency-controlled Brainstorm project pass through actual supported transports, with inspectable evidence. Unsupported paths remain visibly unsupported. Record completion of each stage separately; a successful send-only proof is not completion of this specification.

## 16. Decisions fixed by this specification

- Direct participant communication is first-class and uses the same tools as Brainstorm and the conversational Agent.
- Shared Spaces automatically records project DMs and retains durable artifacts/decisions; passive notes stay available but are not a required intermediate step.
- Project DMs are project-visible; one-off/private exchanges do not leak into the project.
- Prompting supplies planning judgment; code owns identity, authorization, receipts, dependencies, durable state and recovery.
- Existing chat ownership, provider permissions and runtime capabilities remain authoritative. A plugin or a model's confidence is not a transport.
- Automatic progression is configured once within explicit scope, not approved message by message; native approvals and out-of-scope decisions remain human decisions.
- Voice behavior and Send text to are separate and unchanged by this work.
