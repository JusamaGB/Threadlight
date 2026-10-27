# Threadlight Agent Codex Support Specification

Status: implemented locally. See [validation and compatibility evidence](../validation/AGENT-CODEX-VALIDATION.md).

Date: 25 October 2026. Baseline: local `main` at `6481092`.

## 1. Product outcome

The user can run Threadlight's hosted Agent with Claude or with a Codex model selected from the installed Codex runtime's model catalog. The existing Agent panel remains the place to ask questions, follow progress, answer questions, approve actions and continue earlier conversations.

For Codex, the selected model handles the conversation and its work directly. Claude retains its existing Haiku front desk and configurable Opus/Sonnet worker. Reproducing that two-model arrangement for Codex is outside this first implementation.

“Any Codex model” means any eligible text-capable model exposed by the supported installed runtime, subject to account access and runtime compatibility. It does not promise access to every OpenAI model or make a catalog entry proof of entitlement. New catalog entries must appear without a Threadlight release. An unavailable selection produces a clear error; Threadlight never silently substitutes another model.

Agent provider selection is independent of the Applications toggles used to monitor desktop chats. A Codex Agent must work with Claude monitoring off and without Claude installed.

## 2. Scope and existing behavior

The current application already has Codex chat monitoring and a relay for messages to existing chats. This feature adds a runtime for conversations that Threadlight itself hosts.

| Area           | Current implementation                                                        | Required change                                                    |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Agent launch   | `src/main/index.ts` constructs `AgentRun` with Claude and a fixed Haiku model | Select a provider implementation through a common agent service    |
| Agent protocol | `src/main/agent/agentRun.ts` uses Claude streaming and permission messages    | Retain a Claude adapter and add a Codex adapter                    |
| Entry point    | `src/renderer/panel/Panel.tsx` hides the Agent when Claude is disabled        | Keep the Agent accessible independently of monitoring toggles      |
| Settings       | `agentWorker` accepts Opus or Sonnet                                          | Add agent provider, Codex model and reasoning selection            |
| Context        | Briefing and readable folders use only the Claude snapshot                    | Use a bounded, provider-labelled snapshot of monitored chats       |
| History        | Claude project transcript files                                               | Merge legacy Claude history with indexed Codex agent conversations |
| Apps           | `claude mcp list`, with a global cache                                        | Discover and control apps separately for each runtime              |
| Approvals      | One pending request                                                           | Queue correlated requests without overwriting them                 |

Existing relay behavior, desktop question-card limitations, voice routing and chat monitoring remain separate features. This specification does not add autonomous messaging of monitored chats or migrate their conversations into the Agent.

The earlier [desktop attachment results](../Codex/CODEX-STAGE0-RESULTS.md) did not establish a supported connection to the running desktop's private runtime. The [shared runtime experiment](../Codex/CODEX-STAGE0-SHARED-RUNTIME-EXPERIMENT.md) also found that a separate profile did not isolate Windows sandbox provisioning. This feature therefore uses a Threadlight-owned child process and Threadlight-owned conversation IDs. It must not redirect desktop startup, borrow a desktop executor identity or provision a Windows sandbox automatically.

## 3. User experience

### Agent settings

Add the following controls under Settings → Agent:

| Control            | Behavior                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Provider           | Claude or Codex; defaults to Claude on upgrade and new installs                                    |
| Claude worker      | Existing Opus/Sonnet selection, visible for Claude                                                 |
| Codex model        | Searchable catalog with display names; stores the exact runtime model identifier                   |
| Reasoning          | Options supplied for the selected model; omitted when unsupported                                  |
| Refresh models     | Refreshes the catalog without starting an inference turn                                           |
| Connected apps     | Lists only apps available to the selected runtime, with connection state and per-provider switches |
| Conversation lasts | Existing lifetime setting, shared across providers                                                 |

Keep separate remembered choices for each provider. Switching away from Claude does not erase its worker or app preferences. When Codex has no saved model, preselect the runtime's declared default; if none is declared, require a selection. Changing a model resets reasoning to that model's returned default and visibly updates the control.

Model discovery has loading, unavailable and retry states. Cached results may be displayed as stale, but a new conversation requires validation against a fresh catalog for the current runtime/account context. A missing saved model stays visible as unavailable instead of reverting to a different model. Hidden catalog entries are available through a clearly labelled “Show additional models” option where supported; text-ineligible entries cannot be selected. Arbitrary typed model IDs are out of scope.

Provider, model, reasoning and app selections apply to the next conversation. During an existing conversation show “Applies to new conversations.” Its header continues to identify the actual provider/model. Continuing an earlier conversation uses its recorded configuration, not the current defaults. Changing a conversation's model in place is out of scope.

### Agent panel

Show the active provider and model in the header, with reasoning where applicable. Before launch, show the configured selection. Keep existing messages, progress, steps, Earlier and End controls. Add Stop for an active turn and question cards for structured input. Stop interrupts the turn and preserves its history; End closes the active conversation and leaves it in Earlier.

Only one hosted conversation may be active at a time. Browsing Earlier does not resume a provider thread. Continue is disabled while the current conversation is starting, working, stopping or waiting for input. Opening an earlier conversation never changes the default provider settings.

Disabling a monitoring provider does not close the Agent, interrupt it or hide its request cards. Both monitoring toggles off means the briefing contains no monitored chats; the Agent remains reachable through the panel/tray. Closing the panel does not stop work. Active work or a pending request retains an accessible activity indicator without opening a terminal or stealing focus.

## 4. Runtime architecture

Introduce a small `AgentService` in the main process. It owns the selected conversation, lifecycle, request queue, history index and publication to the renderer. Provider implementations own protocol serialization and parsing. The renderer receives normalized data and never launches processes or reads provider files.

Suggested responsibilities:

| Module                            | Responsibility                                                            |
| --------------------------------- | ------------------------------------------------------------------------- |
| `src/main/agent/agentService.ts`  | Dispatch, active-conversation ownership, settings snapshots and recovery  |
| `src/main/agent/agentRun.ts`      | Existing Claude implementation behind the shared contract                 |
| `src/main/agent/codexAgentRun.ts` | Codex conversation and event translation                                  |
| `src/main/agent/codexClient.ts`   | Child process, handshake, JSON-RPC correlation and bounded stream parsing |
| `src/main/agent/agentModels.ts`   | Catalog discovery, pagination, validation and cache invalidation          |
| `src/main/agent/agentHistory.ts`  | Provider-aware history and legacy Claude reader                           |
| `src/main/agent/agentApps.ts`     | Provider-specific app discovery and availability                          |
| `src/main/agent/briefing.ts`      | Shared context assembled from enabled monitored providers                 |
| `src/shared/agent.ts`             | Runtime-independent state, identity, model, request and history types     |

File names are implementation guidance; keep modules small and avoid a general-purpose provider framework. All new on-disk locations belong in `src/main/sessions/paths.ts`. Extend the typed IPC contract and preload bridge together.

The provider contract needs asynchronous start/send, resume, interrupt, end and respond operations, plus state/event delivery. Separate “request accepted” from “turn succeeded.” A successful process spawn or JSON-RPC acknowledgement does not constitute a completed answer.

### Codex connection

Use the discovered native CLI and a Threadlight-owned `codex app-server` process over stdio. Initialize once per connection. The official protocol provides model discovery, thread creation/resume/read, turn start/interruption, streaming events, request responses and MCP status discovery. Model entries include reasoning choices; history can require pagination. These capabilities must be checked against the installed CLI's schema and exercised before selecting the supported version range. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server)

Use normal supported authentication through the selected local Codex installation. Do not copy tokens, embed API keys, impersonate another client, or edit global Codex configuration. Inherit its configured data home deliberately and show a sign-in/setup error if it is unusable. Account authentication does not guarantee access to desktop-only tools or connectors.

Launch with `windowsHide`, no shell and piped stdio. Strip inherited executor identity variables as the existing Codex relay does. Set a distinct Threadlight client identity. Start lazily for discovery, history access or an explicit user message; never run a model to check installation or populate settings. Dispose of an idle discovery-only process when its operation ends. Reuse the active agent connection rather than spawning a process for every follow-up.

The process may operate only on agent threads registered by Threadlight. Keep the existing relay isolated from this transport. A writer conflict is an error; do not terminate another process, steal ownership or fall back to an external chat.

## 5. Models, instructions and context

Fetch every catalog page. Store model IDs and reasoning values as validated bounded strings, not fixed enums of today's names. Namespace catalog caches by CLI identity/version and account/data-home context; invalidate after authentication changes or relevant runtime errors. Store no credentials in cache keys or logs.

Use a Codex-specific instruction set for the direct agent. It should explain Threadlight's role, the briefing, when to verify facts with tools, how to report progress and how to respect denied actions. Do not pass Claude's `Task` instructions, `--agents` arguments or Claude tool names to Codex. Deliver instructions through the installed runtime's supported instruction mechanism, verified during the compatibility gate.

Each user message receives a fresh briefing assembled from the combined snapshot for enabled monitoring providers. Include provider, stable chat identity, title, state, workspace, known git summary and available plan summary. Keep the existing 30-chat bound and add an overall character bound of 24,000, with a visible truncation marker in the briefing. Label absent/stale information instead of inventing it. Escape structured delimiters and treat titles and transcript excerpts as untrusted data, never as instructions.

Readable workspace context follows those same enabled providers. A workspace listed in a briefing is useful context, not an OS sandbox grant. Enforce access through the runtime's supported permissions. Do not expand writable roots merely because a monitored chat uses a folder. Exclude Threadlight-hosted agent conversations from ordinary monitoring lists and their own briefings using registered IDs, with legacy Claude workspace exclusion retained.

Snapshot permitted tools and app exclusions when a conversation starts. Re-evaluate the briefing on each turn; app-setting changes still apply only to new conversations. Make that distinction explicit in Settings.

## 6. State and lifecycle

Expand the normalized state to distinguish idle, starting, working, waiting, stopping, ready, interrupted and error. An ended conversation retains its displayed transcript but has no active runtime. Add a monotonically increasing state revision so an older initial IPC read cannot overwrite a newer streamed update.

Every run has a connection generation and conversation identity. Every turn has its provider turn ID when known. Requests and item updates carry these identities. Ignore late events from a closed/replaced child and deduplicate final items against their streamed versions. Do not duplicate replies when history reconciliation meets live events.

Serialize start/send operations in the service. Reject duplicate submission while starting or working. Keep the draft on definite rejection. Persist a bounded pending-send record before submission; after uncertain acknowledgement, retain the user's message and reconcile recorded history before offering a retry. Never automatically replay a message that may already have been accepted.

Use a 15-second startup/handshake timeout and 30-second discovery/control-request timeout. These are Threadlight policy defaults, not inference deadlines. Long-running turns remain interruptible; silence alone must not mark them successful. If Stop is not acknowledged within 10 seconds, terminate only Threadlight's owned child, mark the result uncertain and reconcile before another send.

On normal completion, clear transient progress and start the configured inactivity timer. On failure, retain partial output and expose the error; on interruption, label the turn interrupted. Expiry runs only while idle after a completed turn, never during a pending question or approval. The next send after expiry starts a new conversation. Quit performs bounded shutdown, retains recoverable metadata and never records unfinished work as complete.

## 7. Approvals, questions and tools

Preserve Threadlight's product expectation that changes require explicit permission. The first compatibility gate must establish a supported per-conversation sandbox/approval configuration for that behavior. Do not treat a prompt instruction as enforcement, and do not copy permissive global defaults into an agent session without checking their effective behavior. Never weaken managed restrictions.

Handle requests by their actual family: command execution, file changes, permission grants, structured user input and MCP elicitation. Present supported choices and meaningful details for each family. A generic Allow/Deny boolean is insufficient for every request. Unknown actionable requests must produce a visible compatibility error and a supported rejection/cancellation, or interrupt the turn if no safe reply is defined.

Queue requests under `(provider, connection generation, conversation, turn, request ID)` and retain item IDs where provided. Two concurrent requests must remain independently answerable. Show the pending count and one actionable card at a time. A reply may resolve only its exact current request. Duplicate clicks, old cards, replaced connections and already resolved requests are rejected.

Approvals default to one action/turn as supported; omit persistent grants from the first UI. Neither closing a panel, timing out, stopping nor disconnecting means approval. Resolve or invalidate pending cards on the provider's authoritative resolution/turn events. After reconnect, never reuse old request IDs without reconciliation.

Question cards support the runtime's supplied options and free-text fields. Keep answers local until Submit. Do not reuse the monitored desktop chat's copy-and-open limitation for these owned conversations: the app-server connection must support direct question responses. An unsupported question shape must be explained and cancellable rather than left hanging.

Connected apps are discovered from the actual agent runtime, not assumed from those visible in Codex desktop. Key exclusions and caches by provider and stable server/app identity. Enforce disabled apps through supported session-scoped configuration/tool exposure, without writing global configuration. If exclusion or mutation approval cannot be enforced for an integration, keep it unavailable to this Agent and explain why. Do not port Claude's tool-name prefix heuristic as the Codex permission policy.

Sensitive tool inputs and grants must be reviewable without logging secrets. Long command/diff details may scroll or expand; do not irreversibly truncate the action the user is approving. External authentication URLs require explicit opening and must not launch silently.

## 8. History, identity and usage

Conversation lifetime is an inactivity window restarted after each successful reply.
Follow-ups reuse the same provider thread; neither a voice pause nor closing/reopening
the mic starts another thread. End, idle expiry and normal app shutdown archive the
owned Codex thread while retaining its Agent index entry and provider transcript.
Reading Earlier must not unarchive it. Continue explicitly unarchives and resumes the
same provider ID. Pending sends remain journaled through retirement. A persisted
archive-state marker distinguishes pending cleanup from acknowledged archiving;
startup retries pending cleanup only for indexed Agent-owned conversations.
Agent workspace paths and registered IDs are excluded before workspace aggregation,
including during creation and after restart. Live test teardown awaits the same
retirement path on success and failure; no-inference discovery uses ephemeral threads.

Introduce a Threadlight conversation key distinct from the provider thread/session ID. Persist schema version, provider, provider ID, model, reasoning, title, creation/update time, effective app exclusions and completion/recovery state. Provider identity is required even if two providers return identical IDs.

Keep provider transcripts authoritative for full conversation content. Maintain a small atomic index under Threadlight user data to identify its own Codex conversations. Store bounded recovery text only for unresolved sends; clear it once reconciliation succeeds. No credentials or full tool inputs belong in this index. If a crash occurs between thread creation and index persistence, do not guess ownership from an arbitrary thread title or resume an unrelated chat.

Earlier merges indexed Codex conversations with the existing Claude agent-workspace reader, sorted by last activity, initially showing the latest 30. Adapt old Claude entries as `provider: claude` without rewriting their transcripts or changing the legacy workspace path. Unknown historical model metadata is labelled unknown, not filled with today's defaults.

Read Codex history through supported paginated methods and load older items on demand. Reading history must not resume execution. Continue validates the recorded provider/model and restores the conversation through that provider. If it is missing, inaccessible or owned elsewhere, retain any readable history and show the reason. No implicit cross-provider conversion or automatic model replacement.

Replace mandatory dollar cost with optional provider-reported usage fields. Unknown cost is unavailable, not zero. Keep account quota separate from conversation token/cost reporting. Preserve Claude usage behavior; Codex account limits must not be presented as a per-conversation budget. Do not make billable probe requests or invent prices.

## 9. Settings and migration

Add `agentProvider`, `agentCodexModel`, `agentCodexReasoning` and `agentCodexAppsOff`. Retain `agentWorker`, `agentAppsOff` (Claude exclusions) and `agentLifetimeMinutes` for backward compatibility. Use `null` for a not-yet-selected Codex model/reasoning. Validate model/effort combinations against the catalog before launch in addition to schema validation.

Existing settings migrate without changing provider, monitoring toggles, worker, lifetime or exclusions. Invalid new fields fall back independently. Settings updates cannot silently end or reconfigure a current conversation. Defaults and active configuration are distinct state presented through IPC.

Add typed IPC operations for model discovery, interruption and discriminated request responses. History reads/resume take a Threadlight conversation reference resolved in the main process; the renderer cannot provide an arbitrary provider transcript path. Validate identities, payload sizes and allowed responses in the main process.

## 10. Delivery stages

1. **Compatibility proof.** Use the installed CLI's version/schema and a fake protocol server to establish required request shapes. Then use disposable agent conversations for signed-in model discovery, two turns, interruption, history/resume, an approved and denied synthetic action, structured input and app exclusion. Record which tools actually exist. Do not launch a replacement desktop or request sandbox provisioning; machine-level setup experiments belong in a disposable VM. A failed safety/tool gate limits tool availability explicitly; failed core conversation or approval handling blocks Codex Agent release.
2. **Shared service and Claude regression.** Extract lifecycle dispatch, provider identity and queued requests. Preserve existing Claude behavior, legacy history and settings. Fix stale-child event handling while moving ownership into the service.
3. **Codex runtime and persistence.** Add transport, discovery, direct agent instructions, streaming, questions, approvals, interruption and indexed history. Restrict runtime operations to owned conversations.
4. **Product integration.** Add settings/header controls, remove Claude-only UI gating, use combined briefings, separate app lists and handle unavailable usage honestly.
5. **Release evidence.** Complete the acceptance matrix, compatibility record and documentation. Update README, Codex setup notes and CHANGELOG when the implementation exists; this specification alone does not mark the feature shipped.

## 11. Acceptance and verification

| ID  | Scenario                                                             | Required evidence                                                                               |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A01 | Upgrade an existing Claude installation                              | Provider, worker, lifetime, exclusions and Earlier entries preserved                            |
| A02 | Claude absent or monitoring disabled; Codex selected                 | Agent opens and completes a conversation without Claude discovery/launch                        |
| A03 | Both monitoring providers disabled                                   | Agent remains reachable; briefing contains no disabled chats                                    |
| A04 | Catalog pagination, additional model and different reasoning options | All eligible choices render; exact selected values reach the runtime without a fixed model enum |
| A05 | Saved model removed, access denied, or catalog unavailable           | Clear error, recoverable draft and no silent substitution or inference probe                    |
| A06 | Send, stream, follow up, End, restart and Continue                   | Correct provider thread reused for follow-up/resume; End followed by new send creates another   |
| A07 | Change settings while a conversation exists                          | Current provider/model/apps remain pinned; new conversation uses new defaults                   |
| A08 | Mixed Claude/Codex chat briefing                                     | Provider-labelled bounded context; disabled and agent-owned chats excluded                      |
| A09 | Simultaneous approvals and a stale/double response                   | No overwritten request; only matching current request resolves                                  |
| A10 | Synthetic read, file change, command and connector mutation          | Effective permissions match the displayed behavior; deny prevents that action                   |
| A11 | Structured question and MCP elicitation                              | Submitted answers reach the owned turn; unsupported shapes fail visibly and can be stopped      |
| A12 | Stop, End, expiry, quit and delayed old-child events                 | No false success, accidental approval or corruption of the next conversation                    |
| A13 | Process loss before/after send acknowledgement                       | Pending message retained; history reconciled; no automatic duplicate submission                 |
| A14 | History longer than one page and identical IDs across providers      | Pagination works; entries remain distinct; browsing does not execute a turn                     |
| A15 | Disabled/missing app or changed account context                      | Exclusion enforced, capability gap shown and discovery cache invalidated                        |
| A16 | CLI missing, unsigned-in, incompatible or writer conflict            | Actionable error; no desktop restart, global setting change or ownership takeover               |
| A17 | Missing token/cost/quota report                                      | Unavailable shown accurately; Claude reporting unchanged                                        |
| A18 | Existing chat monitoring, relay and voice workflows                  | Focused existing regressions and synthetic UI smoke checks pass                                 |

Use a fake app-server fixture to test split JSON lines, multiple messages per chunk, out-of-order responses, numeric/string request IDs, bounded malformed output, lifecycle races and protocol errors. Use synthetic app/tool servers for permission cases. Fixtures and screenshots must contain no personal chats, paths, email or credentials.

For model breadth, cover at least two distinct catalog models in the fake suite and smoke-test two accessible real models where the account permits it, including differing reasoning choices when available. Record tested CLI/model versions and distinguish protocol coverage from real-model evidence. Do not run costly turns across the entire catalog.

Before publishing or updating an implementation PR, run fast structural, product-evidence and coverage checks first; then focused behavior tests and affected caller/UI snapshots; finish with relevant diff and build checks. Complete the repository-required lint, typecheck, tests and formatting preflight before publication. Fix failures locally before pushing; do not repeat broad checks without a new change or failure that warrants them.

Completion requires all applicable acceptance cases to pass, a documented supported CLI range, working live conversation/approval evidence and no Claude regression. Unsupported optional integrations must be visibly unavailable. Core Codex Agent behavior cannot be declared complete on fake transport tests alone.

## 12. Design boundaries

This first implementation deliberately uses one selected Codex model per conversation. Cross-provider handoffs, separate Codex front-desk/worker model selection, in-place model switching, concurrent hosted conversations, hosted/cloud agent backends and desktop-only tool parity are future work.

The architecture, defaults, timeout values, UI behavior and acceptance criteria above are Threadlight design decisions. The installed runtime compatibility proof determines exact wire fields and supported permission controls; it must not quietly weaken these product requirements to accommodate a missing capability.
