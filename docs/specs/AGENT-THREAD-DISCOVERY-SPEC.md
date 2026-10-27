# Agent thread discovery and reading

Status: implemented locally, with synthetic regression coverage and authenticated installed-runtime validation. See [validation and operating notes](../validation/AGENT-THREAD-DISCOVERY-VALIDATION.md) for the tested paths and evidence limits.

Date: 26 October 2026. Reviewed baseline: `c2e1c151b0b9a301854374ae3e5ce26306eda91e`.

This is the first functional slice of the conversational coordinator. It supplies accurate, current answers about named local Claude and Codex chats. It applies to the general hosted Agent, through typed input and its existing voice paths.

## 1. Product outcome

The user can ask “What is the dashboard chat doing?”, “What did it say last?”, “Is it waiting for me?” and “Has anything changed since I asked?” The Agent finds the intended chat, reads its current evidence and answers briefly. If the name is ambiguous, it identifies the alternatives. If reading fails, it explains the actual limitation instead of treating an old snapshot as current information.

The user does not need to open a workspace, expand a row, change the recent-history window, copy an ID or connect Shared Spaces. A read does not wake the destination, submit a message or take ownership of its runtime.

The first milestone is complete only when both providers are reachable through the actual hosted Agent tool path, and a subsequent spoken question can refresh information during the same Codex Live conversation. A service-only test or a tool description in the prompt is insufficient.

## 2. Scope decisions

Included:

- Discover named chats across locally indexed, enabled Claude and Codex providers, including collapsed workspaces and chats outside the displayed recent window.
- Read current activity, the latest user-visible exchange, a bounded recent conversation page, explicit plan/progress and pending questions or approvals.
- Read older pages of an identified conversation when the question requires them.
- Find archived chats when requested or when an ordinary search finds no active match; identify archived results clearly.
- Reuse a resolved chat identity for follow-up questions and refresh its contents on demand.
- Explain source freshness, incomplete coverage and unavailable data.
- Show compact evidence and, where needed, a choice of candidate chats in the existing Agent panel.

Deferred to later slices:

- Sending, queueing, interrupting, resuming, creating, renaming, archiving or deleting provider chats.
- Answering a destination's pending card, approving its work, or opening its native application.
- Background assignments, completion subscriptions and proactive spoken notifications.
- Remote/cloud threads and discovery of remote hosts.
- Searching the contents of every conversation, embeddings or a semantic knowledge index. Discovery searches names and bounded catalogue metadata; history reads target an identified chat.
- Inspecting project files, running Git, checking CI or independently verifying the work claimed in a chat. Existing badges can be reported as separately dated observations, but a chat read is not a repository audit.
- Reading images, downloading attachments or following URLs found in messages.

The Applications monitoring toggles define the providers readable by these tools. The Agent's own selected provider remains independent: a Codex Agent can read enabled Claude chats and vice versa. Changing toolbar presentation, workspace expansion or row limits does not change read scope. Disabling a provider stops new reads immediately; it cannot erase text already delivered in conversation history.

## 3. Current logic and required changes

| Existing component                                       | Current behavior                                                                                                                                                      | Required change                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/agent/briefing.ts`                             | At most 30 chats, derived from recent rows and expanded workspace trees; descriptive status rather than a general history tool                                        | Keep a small orientation briefing, add observed time/scope, and direct factual chat questions through the tools                                         |
| `src/main/sessions/service.ts`                           | Stores the UI snapshot; `find()` searches that snapshot. `refresh()` waits for a scan begun after the call, but `scan()` catches errors without returning read health | Share refresh work where suitable, but expose explicit source-read outcomes; a resolved refresh promise is not a freshness receipt                      |
| `src/main/sessions/tracker.ts` and `appRecords.ts`       | Claude app metadata, hooks and incrementally parsed transcripts; UI filtering and expansion determine which complete sessions are built                               | Separate cheap catalogue enumeration from selected-chat evidence reads; retain existing presentation behavior                                           |
| `src/main/sessions/transcript.ts`                        | Maintains a summary, not a paginated conversation. Missing files can leave the previous summary intact                                                                | Add a bounded normalized history reader and explicit source availability; never label a retained summary freshly read after a failure                   |
| `src/main/codex/tracker.ts`                              | Reads local state/history databases and a bounded rollout tail; limits metadata to 5,000 non-archived rows; catches some failures as empty/fallback results           | Extract reusable read adapters with coverage and provenance. Support catalogue pagination and explicit archived lookup without increasing every UI scan |
| `src/shared/providers.ts`                                | Combines provider UI snapshots and limits the displayed list                                                                                                          | Reuse provider identity/workspace normalization; do not use the combined UI list as the discovery universe                                              |
| `src/main/agent/agentRun.ts`                             | Claude front desk permits only Task and waits for its worker                                                                                                          | Permit the two built-in read tools directly for ordinary chat questions; no worker model call is needed solely to read Threadlight                      |
| `src/main/agent/codexAgentRun.ts` and `codexPolicy.ts`   | Owned Agent runtime has configured MCP tools, per-call approval policy and no Threadlight discovery tools                                                             | Inject the scoped built-in read service into this owned runtime and verify its effective tool inventory                                                 |
| `src/main/agent/codexLive.ts`                            | Opening uses a normal backend turn; later requests may use native delegation                                                                                          | Teach both voice and backend instructions to obtain fresh thread evidence. Prove the tools remain reachable on later spoken turns                       |
| Agent request cards and monitored-thread attention cards | Separate mechanisms with provider-specific response ownership                                                                                                         | Reuse a choice presentation for discovery ambiguity; present destination requests as read-only evidence in this slice                                   |

`MessageCoordinator`, relays and Shared Spaces assignments are not needed to read a chat. This work must not depend on the unresolved open-desktop-chat delivery integration.

## 4. Architecture and identity

Add a main-process `ThreadReadService` with Claude and Codex read adapters. Its catalogue contains metadata and source locators; conversation text is read only for selected identities. The UI and hosted Agent call the same service rather than implementing separate resolution rules.

Suggested modules:

```text
src/shared/threadRead.ts          schemas, results and evidence types
src/main/threadRead/service.ts    scope, catalogue, resolution and bounded reads
src/main/threadRead/claude.ts     app metadata, hooks and transcript adapter
src/main/threadRead/codex.ts      state/history/rollout adapter
src/main/threadRead/normalize.ts  visible items and provenance
src/main/threadRead/server.ts     scoped read-only MCP transport
src/main/agent/threadReadTools.ts owned-runtime setup and instructions
```

Extract/reuse existing parsers where they meet the evidence contract. Do not duplicate the trackers wholesale. All provider-owned disk locations remain declared in `src/main/sessions/paths.ts`, including archived rollout locations if newly needed there.

Canonical identity is `(hostId, provider, nativeId)`. `hostId` is `local` in this milestone. Existing Claude bare IDs and `codex:<id>` keys remain compatible at adapter boundaries. Never identify a chat by title, workspace path, list position or most recent activity alone.

Expose an opaque `threadRef` minted by the service for that identity. It is stable across catalogue refreshes, renames and moves to archive within an app session. It is not a filesystem path or authority by itself. Every use revalidates scope, existence and provider. On restart or expired conversation capability, resolve afresh; do not guess a native ID from the opaque value.

Exclude the current general Agent and other existing Threadlight-owned coordinator/brainstorm conversations using their registered native IDs. Do not hide every chat sharing a folder: unrelated legitimate chats may use that folder. Future visible workers will need a distinct role rather than inheriting this exclusion.

## 5. Discovery catalogue and name resolution

Catalogue enumeration uses local provider metadata and transcript indexes. It ignores UI time windows, expanded/collapsed state, focus filters and row limits. It does not eagerly parse every transcript. Metadata may include native title, provider, workspace label, known archive flag, known last-activity time and parent identity. Title source must distinguish an explicit title from a generated first-message fallback.

Provider failures are separate from zero matches. Every result reports which enabled providers were searched, whether coverage completed, and any unavailable providers. An inaccessible provider cannot contribute a “no matching chat” conclusion.

Matching is deterministic and inspectable:

1. An explicit previously returned `threadRef`, or a user-selected candidate, binds the identity.
2. Normalize case, Unicode presentation, repeated whitespace and ordinary punctuation for comparison; preserve the original title in results.
3. Prefer an exact normalized title within any explicitly requested provider/workspace.
4. Otherwise match distinctive title tokens/phrases. Provider and workspace stated by the user are constraints; recent activity is only an ordering aid.
5. Typo/phonetic/fuzzy matches may be offered as candidates but do not silently bind a destination. Fuzzy matching must not turn a provider or workspace constraint into a preference.

The tool returns `resolution: unique | ambiguous | none | incomplete`. `unique` requires exactly one exact match, or one unambiguous distinctive phrase match after a complete search of the requested scope. A shorter exact title does not suppress another clearly plausible match to a broad phrase. The implementation must lock these rules with named fixtures rather than a magic confidence number.

Duplicate titles across providers or workspaces require a choice unless the user's request already disambiguates them. List up to three leading choices in conversation, with provider and workspace; expose additional candidates in the panel. Native titles remain verbatim labels, escaped as data. Do not read all candidate histories merely to decide which one the user intended.

“That chat” refers to the most recently resolved chat in this Agent conversation, unless the user explicitly refers to another named or selected chat. A confirmed selection overrides a prior reference. A new Agent conversation starts with no inherited referent. Ambiguous or failed searches do not overwrite the last confirmed identity. A stale/removed reference causes re-resolution, not reassignment to a similarly named chat.

Default search covers non-archived chats. If it returns no match with complete coverage, the Agent may search archives once and state that the match is archived. Requests explicitly mentioning an archived chat can search archives immediately. Archive movement during a read preserves identity. A missing archive flag is `unknown`, never silently `false`.

## 6. Tool contracts

Expose exactly two product tools for this slice. Schemas are strict, bounded and share validation with the service. The following names are canonical tool names; provider MCP prefixes are transport details.

### `threadlight_find_threads`

```ts
type FindThreadsInput = {
  query: string // 0–200 characters; empty lists metadata
  provider?: 'claude' | 'codex' // omitted means enabled providers
  workspaceRef?: string // service-issued, never an arbitrary path
  archived?: 'exclude' | 'include' | 'only' // default exclude
  cursor?: string
  limit?: number // default 8, maximum 20
}
```

Result includes `queryId`, requested scope, per-provider read receipts, `resolution`, optional `resolvedRef`, candidate metadata, `hasMore`, `nextCursor`, and coverage/error information. Each candidate has its original title/title source, provider, host, workspace label/ref, archive status, known last activity and `matchReason`. Catalogue activity is labelled as metadata; it is not a fresh detailed status claim.

`limit` limits returned results, not the discovery universe. Adapters page metadata rather than silently inheriting the Codex tracker's 5,000-row ceiling. A deadline or scan budget produces `incomplete` with a continuation, not a confident negative or unique match. Candidate ordering is stable with identity as the final tie-breaker.

### `threadlight_read_thread`

```ts
type ReadThreadInput = {
  threadRef: string
  view?: 'status' | 'recent' // default recent
  cursor?: string // older history page of this exact thread
  limit?: number // visible items: default 40, maximum 100
  sinceObservationId?: string // compare with a prior successful read
}
```

Every call validates the selected identity and requests a current source observation. A cursor pages backward from its bound watermark; it does not pretend older content is the newest page. The response keeps latest status separate from paginated historical items.

Result includes:

- `observationId`, `threadRef`, current title/provider/host/workspace/archive metadata.
- `requestedAt`, `checkedAt`, source watermarks, per-source health and `changedDuringRead`.
- Status with evidence type (`provider_turn`, `hook`, `inferred`, `unknown`), evidence timestamp and any known turn identity.
- Current user request, latest progress, latest completed reply, explicit plan/current step and background-task observations, each with provenance or an explicit absence reason.
- Pending attention as read-only question/approval data, including expiry or unanswerable state when known. No usable approval capability is exposed by this tool.
- Ordered visible items with stable source IDs, role/kind, phase, known timestamps, turn identity where available, completeness and truncation flags.
- `hasMore`, `nextCursor`, omitted-content/coverage flags and source-specific errors.
- If requested, a deterministic delta from `sinceObservationId`: new items, updated streamed items, status/attention changes, rename/archive changes, or `baselineUnavailable`. No model-generated diff is required.

`view: status` avoids loading a whole history page but still retrieves enough current-turn evidence to distinguish active work, a waiting request and the latest completed turn. It must not label a previous turn's final response as the answer to a newer request.

Use structured outcomes: `ok`, `partial`, `unavailable`, `not_found`, `provider_disabled`, `out_of_scope`, `cursor_expired`, `invalid_request`. Include a human-readable reason. `partial` must identify which fields are usable. Preserve a previous observation only as explicitly dated stale evidence, never as a fresh success.

## 7. Freshness and consistency

“Checked now” means the service successfully revalidated the relevant local source during this read. It does not mean the provider has flushed everything it knows to disk, or that the chat is still in that state when the answer finishes speaking.

For a question about current state, start or join a source read whose observation boundary is at or after the request. Coalesce concurrent callers without returning a scan that started before their requests as current. Successful metadata/stat revalidation can reuse parsed content if the source identity and revision are unchanged; caching must preserve this distinction.

Keep three different times:

- `checkedAt`: when Threadlight successfully checked the source.
- `sourceUpdatedAt`: when the source says it changed, if known.
- Message/event time: when the particular item occurred, if known.

Do not use `lastActiveAt` as proof of a successful recent read. An old but successfully rechecked unchanged transcript can be current local evidence. A recently cached transcript whose latest read failed is stale evidence.

Read health is per source. A fresh catalogue cannot make a failed history read fresh. A hook can establish observed state without supplying conversation content. A readable transcript cannot establish that an unresponsive live runtime is idle.

Consistency rules:

- For SQLite, read each database through a read-only, bounded snapshot/transaction. Record the native item/turn ordinal or equivalent available revision. Do not claim cross-database atomicity.
- For JSONL, retain file identity and complete-record byte boundary. Do not parse a partial final record as a complete message. Appends after the boundary belong to a later read.
- Detect replacement, truncation and archive movement; re-resolve the registered source once. Invalidate cursors whose underlying ordering/identity changed.
- If state changes during a read, make one bounded reconciliation attempt. If still changing, return coherent bounded items with `changedDuringRead: true` and identify the last observed state. Do not spin until an active chat becomes quiet.
- If the native history projection demonstrably lags the rollout for the latest turn, use a validated fallback or return partial evidence. Do not silently combine an old final answer with a newer status as though they describe one turn.
- Preserve stable native item identities when available. Merge streaming revisions by ID, not text similarity. Similar or repeated messages from distinct turns remain distinct.

Status wording must reflect evidence. A writer lock means a process owns a chat, not that it is working. `idle` is not proof the requested job succeeded. A final message that says “tests passed” supports “the thread reports that its tests passed,” not an independent verification of tests, deployment or files.

## 8. Provider adapters and bounded history

### Claude

Use `AppRecordIndex` for native titles, archive state, provider/session mapping and workspace metadata. Include valid locally discovered CLI sessions where there is no desktop record, labelled accordingly. Resolve transcript paths from the adapter's index, with real-path containment checks within configured provider roots. Hook payload paths are hints requiring the same validation.

Use existing transcript parsing knowledge, but expose normalized user-visible items and source-read outcomes. Preserve tool-use/result ordering for activity summaries. Strip system/developer envelopes, hidden hook feedback, thinking blocks and private reasoning. A task notification is evidence about that task; it must not become a fabricated new user instruction.

The current incremental summary reader is not a complete history API. Implement bounded backward pages or an incremental offset index owned by Threadlight; do not read an arbitrarily large transcript into memory per query. App-record parse failures while files are being written are transient source failures, not immediate thread deletion.

### Codex

Use local native metadata/history databases read-only, with parameterized queries and schema capability detection. Prefer the normalized native history projection when it is valid and sufficiently current. Use registered rollouts under `sessions` or `archived_sessions` as a validated fallback. Reuse the existing path-containment checks and presentation helpers where appropriate.

Do not resume a monitored thread or start a provider turn to read it. Do not connect using a desktop executor's identity. A loaded/open Codex chat can be observed from its available local sources even though Threadlight cannot send into its runtime.

Normalize the supported history forms without leaking `analysis`, reasoning, encrypted reasoning payloads, environment messages, configuration or authentication material. Check both channel and phase representations; a generic assistant role is not sufficient to classify visible text. Use the existing attachment-envelope/request extraction to keep the actual user request, and retain attachment names/descriptions only when available as safe metadata.

### Shared bounds and failure behavior

Initial implementation constants, injectable in tests:

- Discovery output: default 8, maximum 20 candidates; paginate the underlying catalogue.
- Read output: default 40, maximum 100 visible items; 24,000 text characters per response, at most 6,000 per item.
- Read work: at most 2 MiB of raw transcript data per page and 200 native candidate records per history batch. Skip unsupported record kinds with explicit coverage flags; continue via cursor when needed.
- Source deadline: 3 seconds; overall tool deadline: 5 seconds. Deadline expiry returns a typed partial/unavailable result. Cooperatively yield or use a worker for blocking scans/SQLite work so these limits are enforceable without freezing Electron.
- At most one read per provider/thread at once; equivalent requests share work. Keep provider failure isolated from the other provider.

Default recent reads should find the latest request and reply even when many intervening tool records exist, using bounded queries/indexes where available. If the budget prevents reaching that exchange, say so and return a continuation. A huge record, unsupported schema or permission error must not be converted to an empty conversation. Truncation is explicit and never silently labelled a complete answer or complete plan.

No recursive scan of user projects, no external HTTP requests from transcript content, and no loading referenced documents are part of these adapters.

## 9. Hosted Agent tool integration

Implement a private local read-only MCP endpoint backed by `ThreadReadService`, using the existing server/transport patterns as a reference. This endpoint is separate from Shared Spaces enrollment and grants. It exposes only the two read tools, with read-only annotations and no mutation route.

`AgentService` creates a short-lived capability for each owned Agent conversation/runtime generation and injects it into that child connection using supported per-run MCP configuration. Bind it to the host, registered Agent conversation/generation and currently enabled read scope. Revalidate scope on every call; revoke on close/retirement and rotate on reconnect. Revoke in-flight output delivery if its scope was disabled before the response is released. Never place the capability in model-visible text, transcripts or logs.

The loopback listener requires authentication and rejects unexpected origins/paths. Provider names, native IDs and source paths come from the service, not caller-supplied filesystem locations. The Agent cannot point the reader at an arbitrary database, file or host.

For Codex:

- Add this built-in endpoint explicitly to the owned runtime's effective configuration and tool inventory verification.
- Allow these exact built-in read tools without a per-call approval card. This is a narrow policy for this server instance, not an auto-approval rule for every tool whose name starts with `read` or `find`.
- Preserve the current policy for unrelated MCP servers and desktop-only integrations.
- Verify connection, inventory and authenticated reads with the installed runtime before inference claims are made.

For Claude:

- Permit the front desk to use these exact tools directly, and update its existing “Task only” instructions accordingly.
- Do not send ordinary discovery/status questions to Opus/Sonnet just to call this local service.
- Keep other work on its existing path; this slice does not change general tool permissions or worker behavior.

For Codex Live, both the voice instructions and backing Agent instructions must require current tool evidence for questions about other chats. The briefing supplied at the opening is orientation, not a lasting source of truth. Native delegation must be exercised on a second and later spoken turn. If the runtime cannot reach the read tools on that path, mark voice support incomplete; do not fall back to answering from the initial briefing.

The tool implementation itself performs no inference. Ordinary refreshes do not launch model turns. Reads happen because the user asked, not because every tracker tick produces a new prompt.

## 10. Conversation and evidence presentation

Expected interactions, using synthetic examples:

| User asks                                 | Required behavior                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| “What is Refine dashboard spacing doing?” | Find the named chat, read it, state current observed activity and any pending input                                        |
| “What did it say last?”                   | Reuse the resolved identity; retrieve its latest visible reply and distinguish a streaming partial from a completed reply  |
| “Has it finished?”                        | Check the latest turn/status; report completed, working, waiting, interrupted or unknown without promoting idle to success |
| “And now?”                                | Perform a fresh read of the same chat; use the previous observation only as a comparison baseline                          |
| “What does it need from me?”              | Read and describe its current question/approval; show read-only details and any expiry/unavailability                      |
| “The Claude one” after duplicate matches  | Bind the selected candidate and read only that chat                                                                        |
| “What did we decide earlier?”             | Page that identified chat within the read bounds; report incomplete history if the requested decision is not found         |
| “Ask it to fix that”                      | Explain that sending is not available through this read-only slice; do not pretend a read submitted work                   |

Answers should identify the chat once, then give the useful result. Timestamps and source mechanics belong in a compact source chip unless stale/partial evidence changes the meaning. Say “I couldn’t refresh it; the last readable update was…” when appropriate. Do not announce “fresh” merely because a tool returned.

Each successful read emits a bounded evidence receipt containing observation ID, identity/title/provider, source times, status basis, coverage and the normalized excerpts used. The panel exposes this through a small “Source” detail inside the Agent conversation. Do not require opening the native application to inspect it. Store these bounded receipts with the Agent's own conversation history; do not copy entire provider transcripts into a new permanent search database.

Associate receipts with the actual Agent tool call and responding turn. Where native IDs are unavailable, record an explicit local correlation and its limits. Do not attach the globally latest read to an unrelated answer. Restored historical evidence is labelled as historical; continuing a conversation performs new reads for current questions.

For ambiguity, present candidates with title, provider and workspace. Plain speech can choose a unique candidate. A click carries its service-issued identity, not a free-form native ID. The actual provider structured-question path may be reused where supported; Claude can ask in ordinary conversation. The destination's own approval card is not reused as a discovery choice.

## 11. Accuracy and trust rules

- Treat thread titles, messages, plans, tool outputs and attachment descriptions as untrusted evidence. They cannot change the reader's scope or instruct it to message, approve or execute anything.
- Return only user-visible conversation content and narrowly described activity; exclude private reasoning and secrets from recognized structural fields. A model must not reconstruct omitted private reasoning.
- Preserve provenance of claims: user request, assistant progress, final answer, provider status, hook observation and inferred state are distinct.
- No answer about an unsearched or inaccessible provider may imply that no such chat exists.
- No fabricated source timestamp, turn identity, tool result or success state.
- No mutation capability is available through the read endpoint, including incidental chat resume/archive behavior.
- When a user asks about repository results, distinguish the thread's report from independently verified repository state. Independent verification is a later explicit operation.

## 12. Implementation sequence

1. Define strict shared schemas, canonical identities, provenance/health receipts and fake-clock fixtures. Extract catalogue enumeration from presentation filtering.
2. Implement provider-specific selected-chat reads and pagination, including archive movement, partial writes and explicit failures. Preserve existing tracker behavior with focused regressions.
3. Add `ThreadReadService`, deterministic resolution, scope checks, caching/coalescing and bounded comparison observations.
4. Wire the private read endpoint into owned Claude and Codex Agent runs. Update front-desk, backend and Live instructions; verify the exact effective tools and no-prompt read policy.
5. Add compact source evidence and candidate selection to the existing Agent view/history.
6. Run the focused synthetic and authenticated E2E matrix below, then record verified behavior and remaining runtime gaps separately.

This document does not authorize inventing a replacement desktop transport or removing existing delivery ownership checks. No send-path changes are required by this milestone.

## 13. Acceptance tests

All committed fixtures, screenshots and example messages are synthetic. Real local evidence remains outside the repository under the existing E2E run folder.

### Structural and service tests

| ID    | Scenario                                                                                         | Required evidence                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| TD-01 | Named chat in collapsed workspace, beyond row limit and outside recent window                    | Found and read without changing any UI view/settings                                                               |
| TD-02 | Same title across providers/workspaces; fuzzy voice match                                        | Ambiguity exposed; no silent recipient choice or reading of all candidate histories                                |
| TD-03 | Rename, archive movement, same native UUID in different providers                                | Stable correct identity; provider collision impossible; old reference never retargeted                             |
| TD-04 | More than 5,000 catalogue entries, paginated matches, timeout                                    | No hidden truncation; complete/incomplete coverage and continuation are correct                                    |
| TD-05 | Provider disabled, uninstalled, locked/corrupt database or malformed metadata                    | Distinct typed outcomes; healthy provider still usable; no false “not found”                                       |
| TD-06 | Read request arrives during an older scan; repeated “now?”                                       | Read boundary is after request; fake clock proves stale cache cannot count as refreshed                            |
| TD-07 | Valid unchanged old transcript; newer read failure                                               | First may be current local evidence; second remains explicitly stale/unavailable                                   |
| TD-08 | JSONL partial record, multibyte split, oversized record, truncate/replace/archive                | Bounded consistent page, correct cursor invalidation/recovery and no fabricated empty success                      |
| TD-09 | New turn with old final reply, streamed text, lagging history projection                         | Correct turn association; partial text and provider completion remain distinct                                     |
| TD-10 | Writer lock held but idle; inferred state; explicit failure/interruption                         | No conversion of ownership/idle into active work or successful completion                                          |
| TD-11 | Analysis/thinking, hook feedback, attachment envelopes and instruction-like titles               | Visible request preserved; private reasoning excluded; content never grants authority                              |
| TD-12 | Invalid ref/cursor, foreign conversation capability, out-of-root source, scope disabled mid-read | Request rejected or in-flight output withheld; no data from the wrong scope                                        |
| TD-13 | Pending question/approval resolved or expired during read                                        | Evidence updates or is marked changed; no active response capability exposed                                       |
| TD-14 | Tool inventory and permission policy                                                             | Only the two built-in reads auto-allowed; unrelated tools retain existing policy; no mutation methods invoked      |
| TD-15 | Long/empty history, repeated identical messages and older-page reads                             | Stable pagination and IDs; no content-based deduplication or unlabelled omissions                                  |
| TD-16 | Source receipt/history restoration and “that chat” references                                    | Correct answer-to-evidence association; no stale evidence promoted to current; no cross-conversation referent leak |

### Installed-app E2E

Use disposable synthetic Claude and Codex chats with known titles and answer keys. Set up any fixture messages through their normal authorized interaction paths; the read tool under test must never send those messages itself.

1. Ask the hosted Codex Agent about each provider's named chat through typed input. Verify exact identity, source receipt and answer content.
2. Repeat with the hosted Claude Agent through typed input and its existing recorded-voice/transcription path; verify direct built-in reads without launching its worker solely for lookup. This does not require adding native live voice to Claude.
3. In one uninterrupted Codex Live conversation, ask about a chat, change that chat through its normal native application, then ask “And now?” Verify a second actual tool read and the new answer. The opening briefing must be insufficient to answer the second question.
4. Ask about two similarly named chats, select one by speech or card, and ask a follow-up. Verify identity is retained even when recency ordering changes.
5. Read a chat while it is actively streaming and while it is waiting for input. Verify partial/completed/waiting distinctions; reading does not wake, resume, approve or interrupt it.
6. Make one provider unavailable and repeat a query. Verify the spoken answer reports the gap and does not substitute another chat.
7. Archive a selected disposable chat between reads, then ask about it again. Verify the same identity and archive status, or an explicit unavailable result if its local content cannot be read.
8. Close and reopen the Agent conversation. Historical source evidence remains inspectable; new current-state questions refresh the source.

Capture tool input/output IDs, lookup/read timestamps, provider source revisions, normalized excerpts, visible answer/card and voice transcript. Check provider histories for absence of an extra read-triggered user turn. The existing observer supplies useful renderer/voice evidence; add explicit read-tool/receipt events so inference is not used as proof of a read.

A simulated service result alone is not a pass for the installed-app matrix. Mark unavailable model/provider combinations BLOCKED or NOT RUN and report the supported subset; do not advertise full parity until each required path passes.

### Performance and local preflight

Targets on the supported Windows test machine: warm metadata lookup and selected status reads under 500 ms at p95; cold lookup/read under 2 seconds at p95 on the fixture catalogue. These are measured service budgets, excluding model generation and speech latency, not claims about every disk or dataset. Exercise a 5,000-chat metadata fixture and a large synthetic transcript. No UI input/voice callback should be blocked by unbounded synchronous scanning.

Before a code PR: run structural/schema and source-evidence checks first; then focused resolution, freshness, provider-adapter, policy and real-caller/UI tests; then type/lint, relevant build and diff checks. Follow the repository's required pre-PR checks and the user's local preflight preference. Do not rerun broad tests without a new change/failure that warrants them.

The implementation's local checks and real-runtime evidence are recorded in the accompanying validation document. Restart the running development application after building to activate new main-process code.

## 14. Definition of done

The Agent can reliably locate a named local chat regardless of UI filtering, retrieve bounded current evidence from either enabled provider, and answer with an inspectable source. It clarifies ambiguous identities, refreshes follow-up questions, distinguishes partial/stale/unavailable evidence, and reads an active chat without changing it. Typed Codex, typed/recorded Claude and subsequent-turn Codex Live behavior are verified through the actual owned-runtime tools. No send, approval or remote capability is implied by completing this slice.
