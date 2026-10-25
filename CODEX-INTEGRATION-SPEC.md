# Threadlight Codex Integration Specification

Status: proposed implementation plan. No integration has been built or enabled by this document.

Date: 25 October 2026. Scope: the Windows Threadlight application, preserving its Claude integration and adding a selectable Codex provider.

## 1. Product outcome

The user selects **Claude** or **Codex** in Threadlight Settings. The existing dot, session list, workspace tree, detail view, composer and local voice transcription then operate on the selected provider. Threadlight remains a small background companion. Monitoring, message delivery and ordinary responses must not focus the provider application, open a terminal or move the pointer.

For Codex, the intended destination is an existing local chat in the desktop application, with its history, tools, permissions, model and project context intact. Creating an independent Codex agent with similar context does not satisfy this requirement.

Codex exposes richer integration primitives than Threadlight currently uses for Claude. Availability in the protocol is not proof that a separate application can attach to the installed desktop runtime. Establishing that connection is the first delivery gate, before substantial integration work.

This specification defines the full intended product, a restricted monitoring milestone, the experiments that distinguish them, and acceptance criteria for implementation. A monitoring milestone must never be described as completed messaging integration.

## 2. Evidence and confidence

### 2.1 Existing Threadlight implementation

The current application uses four independent Claude mechanisms:

| Mechanism        | Implementation                                                                 | Responsibility                                                              |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Hook reports     | `hooks/hooks.json`, `src/main/hookServer.ts`, `src/main/sessions/hookState.ts` | Events sent to loopback update session activity.                            |
| Local readers    | `src/main/sessions/appRecords.ts`, `transcript.ts`, `tracker.ts`, `paths.ts`   | Merge desktop metadata and transcript content into sessions and workspaces. |
| Background sends | `src/main/relay.ts`, `relayService.ts`                                         | Run the user's CLI against a known session, with a held-session guard.      |
| Held questions   | `src/main/holds.ts`, wiring in `src/main/index.ts`                             | Return a user's answer through a waiting question or stop hook.             |

Shared UI and voice features already exist. However, types, IPC names, workspace identity, visibility logic and several labels assume Claude. Introducing a dropdown alone would leave those assumptions in place.

The earlier review on this date ran 98 passing tests across 13 files and passing type checks. This is historical baseline evidence, not a substitute for verification at implementation time.

### 2.2 Documented Codex surfaces

The official app-server documentation describes thread discovery/history, runtime status, turn control, event streams and approval/input requests. Representative methods are `thread/list`, `thread/read`, `thread/turns/list`, `thread/items/list`, `turn/start`, `turn/steer` and `turn/interrupt`. Reading a thread is distinct from resuming it; the latter can attach live resources. The app-server command and WebSocket transport are documented as experimental. These are candidate integration surfaces, not a guarantee of external desktop attachment. [App-server reference](https://learn.chatgpt.com/docs/app-server)

Codex hooks include session, prompt, local-tool, permission, stop, interrupt and subagent events. They support plugin packaging, Windows command overrides and asynchronous command hooks. Non-managed hooks require trust review. Tool hooks do not cover every execution path, and the transcript format is not stable. [Hook reference](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins)

The CLI documents `codex queue` for sending text to an existing session, with optional server selection. Queue-command availability does not establish that it reaches desktop-owned chats. [CLI reference](https://learn.chatgpt.com/docs/cli/reference)

Opening a local chat through `codex://threads/<thread-id>` is documented. Use it only for an explicit Open action. [Desktop commands](https://learn.chatgpt.com/docs/app/commands)

### 2.3 Local observations and unresolved questions

Read-only investigation found standalone CLI version `0.157.1` and desktop runtime version `0.164.0-alpha.11.1`. Their displayed/default home paths differed; path aliases or junctions must be resolved before concluding they are different storage locations. Standard control-socket connection attempts failed, including an explicit attempt at the desktop data location. The running desktop app-server had no explicit listen argument. This establishes a connection gap in the inspected setup; it does not prove that all attachment routes are unavailable.

The inspected local state database contained thread/project metadata and project membership. A separate history database contained turns and structured items. Desktop preferences also contained project information. These are observed internals, not supported storage contracts.

The installed app-tools plugin uses a local pipe and executor thread/turn metadata. Its source verifies the existence of an internal desktop management bridge. It does not establish a public standalone client contract. Never invent executor context to make Threadlight impersonate an agent invocation.

The following remain unproven: external attachment to the owning desktop runtime; event delivery to a second client; preservation of desktop-owned tools; approval ownership; response races; reconnect recovery; the effect of app updates; and whether hooks cover this desktop's actual execution paths sufficiently.

## 3. Scope and release boundaries

### 3.1 Required for the full local Codex release

1. Switch between Claude and Codex without restarting Threadlight.
2. Show local Codex chats grouped by their actual projects where available.
3. Distinguish working, waiting, idle and unknown state using available evidence.
4. Show the latest public reply, current plan and useful task activity when available.
5. Send typed and transcribed messages to an existing desktop chat in the background.
6. Retain drafts and recover honestly from failed or uncertain delivery.
7. Answer supported structured questions through their original request channel.
8. Display approvals accurately; enable decisions only for request families whose routing and lifecycle pass validation.
9. Offer Open in Codex as an explicit escape hatch.
10. Preserve existing Claude behaviour, including held-question release and voice controls.
11. Install, diagnose, disable and uninstall the integration reversibly.

Full messaging release requires a proven existing-chat control route. If only monitoring is proven, ship only a clearly labelled monitoring preview, with send and answer actions unavailable. Approvals may remain display-only in an otherwise complete messaging release if this limitation is explicit; question answering must not be advertised until validated.

### 3.2 Excluded from the first release

Remote computers, WSL runtimes, cloud execution and ChatGPT-backed conversations are separate providers/hosts for future work. Also excluded: creating/forking chats, changing models, editing permissions, archiving/deleting chats, managing projects, controlling Git operations, and merging both providers into one list.

Windows computer-use isolation is a separate project. Threadlight must not claim that a background delivery channel makes every task it starts background-only.

### 3.3 Non-negotiable requirements

| ID  | Requirement                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------- |
| R01 | Every operation targets an immutable provider, installation, host and thread identity.                     |
| R02 | Existing desktop chats retain their owning runtime and effective context.                                  |
| R03 | No automated UI interaction is used to monitor, send or answer.                                            |
| R04 | No direct writes to provider databases, transcripts or private message queues.                             |
| R05 | No duplicate sends after timeouts, restarts or uncertain acknowledgements.                                 |
| R06 | Unsupported or disconnected features are explicit, never silently simulated.                               |
| R07 | Permission decisions answer the exact outstanding request and preserve scope.                              |
| R08 | Switching providers cannot redirect an existing draft, recording or pending operation.                     |
| R09 | Existing Claude installation and behaviour survive migration and rollback.                                 |
| R10 | Public fixtures and evidence use synthetic data; personal installation details stay out of the repository. |
| R11 | Monitoring never loads every historical chat as an active runtime session.                                 |
| R12 | A protocol capability is enabled only after transport and lifecycle checks pass for that installation.     |

## 4. Connection feasibility gate

### 4.1 Gate G0 must precede the integration build

Conduct a bounded experiment using dedicated synthetic chats and a disposable project. Read-only discovery comes first. Message, interrupt and approval experiments require an explicitly authorized test run, not this planning request. Do not restart a user's live desktop, change its transport or resume production chats merely to diagnose connectivity.

Produce a compatibility report containing runtime versions, transport category, supported capabilities, evidence locations and unresolved limitations. Record sanitized results; never include credentials, complete environment dumps or real transcript content.

### 4.2 Candidate routes in preference order

| Route                                                             | Required proof                                                                        | Decision                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Supported connection to the existing desktop-owned runtime        | Same chat identity, ownership, tool availability, events and delivery in both clients | Preferred full integration.                                                                     |
| Explicitly supported desktop extension/bridge                     | Stable discovery and authorization contract; background operations; no impersonation  | Accept if it meets the same lifecycle tests.                                                    |
| Shared managed runtime explicitly supported by the desktop        | Desktop can actually attach to that runtime and preserve its capabilities             | Evaluate only with evidence; do not infer support from CLI remote mode.                         |
| Hooks plus compatible read-only data                              | Accurate observation and safe failure when formats change                             | Monitoring route; insufficient alone for arbitrary messaging.                                   |
| Private pipe, undocumented desktop RPC or injected debugging port | No supported external contract established                                            | Excluded from the normal release; a separate experimental design would need explicit agreement. |
| Separate CLI process resuming desktop history                     | Context/ownership conflicts and different tool environment remain possible            | Not the default route; does not pass G0 merely because a reply appears.                         |

Do not implement automatic fallback from a failed control connection to a second agent process. Never start or upgrade a daemon as a side effect of a routine connection check.

### 4.3 Experiment sequence and acceptance

| Step  | Experiment                                                       | Required result                                                                                            |
| ----- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| G0.1  | Discover application, runtime, data home and connection endpoint | Correct installation selected without hardcoded usernames, versions or global environment changes.         |
| G0.2  | Initialize an independently identified read-only client          | Authorized connection; report version and unsupported methods clearly.                                     |
| G0.3  | Discover a test chat and its project                             | Same stable identity and project as the desktop; no new chat or turn.                                      |
| G0.4  | Observe a desktop-started test turn                              | Correlated start, progress and terminal state; do not assume a global event subscription exists.           |
| G0.5  | Read recent history without resuming every chat                  | Accurate latest reply and bounded paging; no tool startup caused by list browsing.                         |
| G0.6  | Send one unique test message to an idle chat                     | Exactly one matching user input and one resulting turn in the same desktop chat.                           |
| G0.7  | Send while the chat is working                                   | Queue/steer/reject semantics documented from observation; no accidental interruption.                      |
| G0.8  | Open the chat in the desktop while Threadlight is attached       | No competing writers, lost tools or configuration drift.                                                   |
| G0.9  | Exercise a structured question in both clients                   | Correct response correlation; answering in either client invalidates the other's card.                     |
| G0.10 | Exercise a harmless approval request                             | Exact action and scope; correct allow/decline lifecycle; no default approval.                              |
| G0.11 | Disconnect before and after acknowledgement                      | Delivery uncertainty is distinguishable; no automatic duplicate.                                           |
| G0.12 | Close Threadlight during work or a pending question              | Desktop remains able to continue/answer; no stranded requests.                                             |
| G0.13 | Restart desktop, then reconnect Threadlight                      | New connection epoch, refreshed capabilities, no stale response reuse.                                     |
| G0.14 | Verify a representative desktop-provided tool in the test chat   | Existing tool environment remains intact; unsupported client-executed tools do not migrate to Threadlight. |

If a test cannot be conducted, mark it unverified. A method existing in a generated schema is not a passed lifecycle test.

### 4.4 Gate outcomes

**Full-control eligible:** discovery, observation, delivery, ownership and recovery pass. Question/approval capabilities get separate results per request family.

**Monitoring eligible:** hooks/readers pass, but control is unavailable. A monitoring preview may proceed with explicit scope. Preserve the full-control work as unresolved.

**Unsupported installation:** even monitoring is insufficiently reliable. Show setup diagnostics and retain Claude mode. Do not substitute guessed state or UI automation.

## 5. Architecture and code boundaries

Use one application-owned coordinator with independent provider adapters. Adapters translate their provider into shared product concepts; the renderer never interprets provider files or protocol messages.

```text
Dot / Panel / Workspace tree / Composer / Voice
                       |
             Typed preload and IPC
                       |
              Provider coordinator
              /                  \
       Claude adapter         Codex adapter
       hooks/readers          runtime connection, if proven
       CLI relay              observation hooks
       held questions         versioned read-only fallback
                       |
        Threadlight drafts and operation journal
```

Suggested responsibilities, subject to small naming adjustments during implementation:

| Module                                    | Responsibility                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/shared/providers.ts`                 | Provider identifiers, capabilities, target references and connection state.                             |
| `src/shared/types.ts`                     | Normalized sessions, workspaces, plans and attention cards.                                             |
| `src/shared/ipc.ts`                       | Validated renderer/main contract, including provider-aware commands.                                    |
| `src/main/providers/coordinator.ts`       | Adapter lifecycle, selection, identity resolution and snapshots.                                        |
| `src/main/providers/claude/adapter.ts`    | Wrap existing Claude services before moving implementation files.                                       |
| `src/main/providers/codex/discovery.ts`   | Installation/runtime discovery and compatibility checks.                                                |
| `src/main/providers/codex/connection.ts`  | Version-specific transport and request correlation, if G0 passes.                                       |
| `src/main/providers/codex/events.ts`      | Normalize protocol/hook events and reconcile state.                                                     |
| `src/main/providers/codex/history.ts`     | Bounded structured history retrieval.                                                                   |
| `src/main/providers/codex/localReader.ts` | Optional schema-checked read-only fallback.                                                             |
| `src/main/providers/codex/requests.ts`    | Outstanding question/approval lifecycle.                                                                |
| `src/main/operations/`                    | Drafts, operation journal, delivery reconciliation and per-thread serialization.                        |
| `src/main/sessions/paths.ts`              | Remains the central registry for provider filesystem locations, consistent with repository conventions. |

Keep raw provider payloads in main-process adapters. Do not turn the IPC bridge into a generic RPC proxy or expose arbitrary executable/path arguments to the renderer.

## 6. Identity and normalized contracts

### 6.1 Stable identity

A thread reference contains `providerId`, an opaque `installationId`, `hostId`, `surface` and `threadId`. First-release Codex supports only the explicitly identified local Codex surface. `runtimeSessionId`, where supplied, is a separate opaque field; never assume it equals the conversation's thread ID.

Project references contain provider/installation/host identity plus the provider project ID. A folder path is metadata, not the universal project key. Duplicate titles, identical folders and provider-overlapping IDs must be safe.

Serialize compound keys unambiguously, for example as a validated tuple, rather than concatenating unchecked strings. The main process resolves each reference against its current registry before performing an operation.

### 6.2 Session representation

Retain existing presentation fields where useful, but separate these concepts:

| Field group      | Proposed content                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Identity         | Thread reference; optional parent/fork references; runtime session ID separately.                    |
| Project          | Stable project reference; display name; actual working directory; repository/worktree root if known. |
| Activity         | `working`, `waiting`, `idle` or `unknown`; terminal outcome separately.                              |
| Attention        | Question, permission approval, suggested follow-up or recoverable error.                             |
| Evidence         | Source, observation time, current connection epoch, authoritative/observed/inferred confidence.      |
| Content          | Last public prompt/reply, current plan, latest useful action, public progress text.                  |
| Runtime          | Model metadata, turn reference, timestamps, tool/background-task summaries if supported.             |
| Optional metrics | Context usage, diff totals and linked PRs; absent rather than invented.                              |

Represent failures and interrupted turns separately from the current activity state. An idle thread can have a failed last turn. Do not render hidden reasoning or raw internal protocol material as user-facing progress.

### 6.3 Adapter operations

The proposed internal interface offers `connect`, `disconnect`, `getCapabilities`, `listProjects`, `listThreads`, `readThreadDetail`, `observe`, `send`, `respondToRequest`, `cancelOperation` and `openThread`. These are Threadlight design names, not claims about Codex wire method names.

Every mutating operation returns a structured result with an application operation ID, disposition, provider correlation IDs when available, and a reason code on failure. Transport details are private to the adapter.

### 6.4 Capabilities

Each capability reports `available`, `unavailable` or `unverified`, with a reason and connection epoch. Track discovery, history, live status, plan, final reply, context metric, send-when-idle, queue-while-busy, steer, interrupt, answer-question, approval families, request synchronization, project grouping and explicit open independently.

Capabilities are installation- and sometimes thread-specific. Presence in documentation or an executable's help is insufficient. Recompute after reconnect, sign-in changes or runtime upgrades. UI controls must obey capabilities, while main-process validation independently enforces them.

## 7. Installation discovery and connection lifecycle

### 7.1 Discovery order

1. Revalidate a previously selected installation using its saved opaque identity and current executable/data-home evidence.
2. Discover the running desktop's runtime and data location through supported metadata where available. Distinguish the desktop binary from an unrelated CLI on PATH.
3. Inspect known installation locations and explicit user configuration without recursively scanning the whole disk or reading credential contents.
4. Probe only the endpoint associated with that installation. Authenticate through the supported mechanism if required; keep credentials out of arguments, logs and renderer payloads.
5. If several valid installations exist, offer a labelled chooser. Do not silently pick the newest binary or merge accounts/homes.

Do not modify global `HOME`, `USERPROFILE`, PATH or Codex configuration to make discovery work. A child-process environment may explicitly select the verified data home when the chosen contract requires it. Local credentials remain under the provider's control; Threadlight must not copy login tokens into its settings.

### 7.2 Connection state machine

```text
disabled -> discovering -> connecting -> connected
                    \          \             |
                     unavailable/error       connection lost
                                               |
                                            reconnecting
                                               |
                                connected / degraded / unavailable
```

`connected` describes the control/observation channel, not the existence of the desktop process. `degraded` means some observations remain available but one or more capabilities are lost. `unavailable` covers absent applications, unsupported runtime, missing trust or inaccessible data, with distinct reason codes.

Assign a new connection epoch after each handshake. In-flight request IDs and observations belong to that epoch. Old responses cannot complete new requests merely because the numeric request ID was reused.

Reconnect with bounded exponential backoff and jitter, proposed delays of approximately 1, 2, 4, 8, 16 and 30 seconds. Reset after a sustained healthy connection. Settings may offer Retry now. Backoff must never delay a user-requested disconnect or application shutdown.

On reconnect: refresh identity and capabilities, rebuild the active-thread summary, reconcile unresolved outbound operations, retrieve relevant outstanding requests if supported, and then resume normal event handling. Until reconciliation finishes, show stale data as stale and disable uncertain writes.

### 7.3 Observation versus attachment

Treat list/read and attach/resume as different resource operations. Loading history must not start a turn. If observing a live thread requires attachment, prove its ownership and tool effects in G0 and attach only to a bounded set of relevant threads. Do not assume that initialization subscribes to all chats or that any undocumented subscribe method exists.

A Threadlight disconnect must remove only its own subscriptions. It must never stop the desktop runtime, end a shared chat or kill provider-owned tool processes. A helper process launched solely by Threadlight may be stopped only when its ownership and detach semantics are known.

## 8. Observation hooks and fallback readers

### 8.1 Codex observation plugin

Package Codex hooks separately from Claude's existing manifest. Share internal event normalization where appropriate, but not raw payload assumptions or hook response shapes. Installation selects the correct provider package.

Use an event envelope containing schema version, provider installation identity, event kind, relevant thread/turn/tool IDs, producer event ID, producer sequence when available, and observation timestamps. Native hook data may not provide every field. Never manufacture a sequence as though it came from the runtime. Record local receipt order separately.

Post a minimal normalized payload to a provider-specific loopback route. Do not forward full prompts, tool outputs or file contents for a simple activity update. Reply/plan summaries can be fetched through the detail path or explicitly included only when required and bounded.

Observation hooks should complete quickly and leave the provider running if Threadlight is absent, busy or incompatible. Use asynchronous execution only where supported and semantically appropriate. Async delivery can reorder events; ingestion must account for this. Use explicit short deadlines appropriate to each hook event rather than inherited long defaults.

Hook setup must respect the provider's trust flow. Never enable a trust-bypass flag as an installation shortcut. A changed hook definition may require review again. Do not enable new question-holding hooks as part of monitoring setup.

### 8.2 Local endpoint

Bind only to loopback. Preserve existing Claude routes during migration. A Codex route uses explicit provider identity and rejects malformed, oversized or unknown envelope versions. Use a per-installation local authentication mechanism for any newly designed route that can influence request handling; browser Origin/Referer checks alone are not authentication.

An observation endpoint does not expose generic send, execute, approve or file-write commands. Rate-limit bursts and coalesce refreshes. A flooding or invalid client must not starve voice, the panel or another provider.

Authentication credentials live in user-scoped storage, are not printed in diagnostics and are never taken from transcript text. The endpoint protects against accidental/cross-origin misuse; it is not a security boundary against all processes already running as the same user.

### 8.3 Fallback metadata/history reader

Keep any database or file dependency behind a versioned compatibility reader. Open databases read-only, use bounded queries and short read transactions, and tolerate WAL mode and concurrent writes. Do not perform migrations, checkpoints, repair, vacuuming or provider writes. Do not copy a live SQLite main file alone and assume it contains WAL-resident state.

Inspect schema compatibility before querying. Unknown columns can be ignored; missing required identity or history fields disable that feature. Database busy, temporarily inconsistent projections or partial transcript lines cause a delayed retry, not a destructive repair.

Prefer structured history when the verified version supports it. If supporting legacy transcripts too, detect storage mode per thread; do not assume every transcript is complete or every history database is authoritative during migration. Avoid duplicate items across sources by stable identity and verified projection semantics.

Keep each provider's file locations in the central paths registry. Paths and filenames are discovered/versioned inputs, not fixed universal contracts.

## 9. Session state and event reconciliation

### 9.1 Evidence rules

Authoritative current-runtime state wins over heuristics for the same thread and turn. A late hook must not overwrite a newer terminal state. Persisted history is useful for completion recovery but may lag a live request. File modification time is a last-resort activity hint, not evidence of an outstanding approval or guaranteed idleness.

Use provider sequence numbers where supplied. Otherwise reconcile using thread/turn identity, monotonic local receipt time and fresh snapshots. Wall clocks can differ and events can arrive out of order. Duplicate producer event IDs must be harmless. If two credible sources disagree, show unknown/reconnecting while reconciling rather than selecting whichever event arrived last.

An event reporting a shared session identity must not automatically update every descendant chat. Establish thread identity and parent/subagent mapping from verified fields. Aggregate child activity for display only according to an explicit rule; preserve the child's own state.

### 9.2 State transitions

| Evidence                                                     | Display                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Confirmed active turn                                        | Working.                                                                       |
| Live outstanding user-input or approval request              | Waiting, with request kind.                                                    |
| Confirmed normal terminal turn                               | Idle, with completed outcome.                                                  |
| Confirmed interrupted/failed turn                            | Idle, with interrupted/failed outcome and useful reason.                       |
| Runtime unavailable, no adequate recent evidence             | Unknown; show last observed state/time separately.                             |
| History exists but the runtime does not have the chat loaded | Recent chat; no claim that a live agent is idle or available to receive input. |

Do not mark a long thinking phase idle simply because no tool heartbeat arrived. Connection liveness and task progress are distinct. A stale hook-only working record becomes unknown after its verified freshness window, not falsely completed. Set that window from G0 measurements and record it in the compatibility profile.

### 9.3 Startup and reconciliation

Start from a bounded metadata snapshot, then apply events. Where the provider offers no atomic snapshot/event boundary, buffer events during initial retrieval, merge by identity and perform a final reconciliation read. If a gap cannot be resolved, retain an explicit uncertainty indicator.

Keep archived chats hidden by default. A chat disappearing from a page of results is not a deletion. Full pagination, filters and explicit archive/delete evidence determine removal. Preserve an outstanding operation's identity even if its thread disappears from the visible time window.

### 9.4 Suggested refresh budgets

These are engineering targets, not measurements: coalesce hook/event bursts within about 100–250 ms; refresh visible details on demand; refresh metadata every 15–30 seconds when event coverage is insufficient; perform a less frequent reconciliation while connected. Reconcile immediately after reconnect or a relevant user action. Cap concurrency and keep one refresh per adapter in flight, with one deferred refresh flag.

Avoid scanning all transcripts every second. A collapsed workspace should not require loading all of its messages. Tune fallback polling against measured CPU, I/O and freshness rather than copying Claude's current scan interval.

## 10. Workspaces and detail views

### 10.1 Grouping

Prefer provider project IDs and explicit membership. Resolve worktrees to their assigned project using provider metadata; use Git ancestry only as a labelled fallback. Canonicalize Windows paths for comparisons while preserving display spelling. Do not use path strings to merge distinct provider projects.

Unassigned chats belong in an explicit Ungrouped category. A non-Git project remains a valid workspace. Fork relationships and subagent relationships are distinct; do not nest every fork as though it were a running child agent.

Preserve per-provider expanded workspace IDs, chosen workspace and list mode. Only show Follow current workspace when a supported source establishes the user's current desktop selection. Last updated chat is not equivalent to currently selected chat. If that source is unavailable, use a fixed chosen workspace and explain the limitation.

### 10.2 Detail content

Read recent public messages and plan state only when a row is expanded or needed for matching. Keep a bounded cache keyed by provider/thread and content revision. Clear or invalidate on relevant events, storage migration and reconnect.

Scope plans to the turn that produced them. Do not revive an old completed plan as a current task after a new turn begins. Preserve the distinction between a proposed plan document and an execution checklist.

Display context usage only when both the relevant usage and denominator are known and semantically compatible. Cumulative billed tokens are not context occupancy. Show no ring rather than a fabricated percentage.

Diff totals retain Threadlight's existing meaning: changes in the working folder. They are not necessarily changes authored by that chat when several agents share a checkout. Label them accordingly. PR badges require a reliable attached-PR source; they are optional when that source is unavailable.

## 11. Settings, switching and dot behaviour

### 11.1 Settings surface

Add a labelled segmented choice, **Assistant: Claude | Codex**, rather than an ambiguous on/off switch. Beneath it show connection health in plain language, such as Connected, Monitoring only, Needs setup, Reconnecting or Unsupported version. Technical details belong behind Diagnostics.

The first selection of Codex runs read-only discovery. If setup is required, show the exact missing step. The selection itself must not install hooks, change provider transport, trust code, start a second runtime or send a test prompt.

Retain global hotkey, talk mode, countdown, voice-hold, appearance, position and autostart preferences. Store workspace/list preferences separately per provider. Display the provider in the panel header and composer destination, especially when chat titles match across applications.

### 11.2 Switch transaction

When the selected provider changes:

1. Freeze the current UI target and preserve its draft under its original thread reference.
2. Stop any active recording; retain captured audio in memory long enough to finish transcription if viable. Never automatically send its result.
3. Cancel any unsent voice countdown. A transcription already running remains bound to its original capture identity and becomes a held draft.
4. Change the visible provider and restore its workspace/list preferences.
5. Leave already submitted operations bound to their original provider and continue tracking their outcomes.
6. Retain pending request cards in their provider store; switching does not approve, decline or discard them. Claude's existing hold timeout/release semantics still apply.
7. Announce the selected provider and relevant connection status accessibly.

If recording cannot be transcribed after interruption, show a specific failure and keep existing text intact. Do not mix audio from two provider selections.

### 11.3 Dot and visibility

The dot represents the selected provider. Preserve the existing working appearance, add a distinguishable waiting indication and an unknown/disconnected indication. Status must be conveyed through tooltip/accessibility text and animation/shape as well as colour. Respect reduced motion.

On first-release parity settings, hide the dot when the selected desktop application is closed and no Threadlight operation is pending. Keep the tray available for setup and switching. If a submitted operation remains unresolved after the desktop closes, retain a visible disconnected/pending indication until the user dismisses it or reconciliation succeeds; do not show green success.

Do not switch providers automatically when the foreground app changes. Background activity from the unselected provider must not steal focus or change the visible list. It can be available through a compact provider attention indicator and tray entry.

## 12. Message delivery and draft preservation

### 12.1 Separate submission from execution

A message operation has its own lifecycle; a thread's activity state is not a delivery receipt. Proposed states are:

| State            | Meaning                                                                                         | User action                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Draft            | No submission attempted.                                                                        | Edit or discard.                                               |
| Queued locally   | Threadlight is waiting for a known safe opportunity; provider has not accepted it.              | Edit/cancel.                                                   |
| Submitting       | One write attempt is in progress.                                                               | Wait; cancellation may not prevent acceptance.                 |
| Accepted         | Provider positively acknowledged the input/queue entry.                                         | View acknowledged status.                                      |
| Running          | A correlated turn is consuming the input.                                                       | Observe; interrupt only if explicitly supported and requested. |
| Completed        | Correlated terminal success; optional reply available.                                          | View result.                                                   |
| Failed           | Known rejection or known failed execution, with phase recorded.                                 | Correct/retry when safe.                                       |
| Cancelled        | Known cancellation before acceptance, or acknowledged runtime cancellation with scope recorded. | Start a new operation if desired.                              |
| Delivery unknown | Acceptance may have occurred but cannot be established.                                         | Reconcile or inspect the provider; no automatic retry.         |

Use labels such as Queued, Sending, Accepted, Working, Replied, Finished, Failed and Delivery unknown as appropriate. A process spawning is not delivery. A completed turn without public text is Finished, not an invented reply. Do not use Read unless the provider actually exposes that semantic.

### 12.2 Submission flow

The renderer supplies a registered thread reference, text and an application-generated draft/operation identifier. The main process validates the caller window, resolves identity, checks capabilities and connection epoch, validates size and content, and serializes submissions per thread. Model, working directory and permissions come from the verified thread/runtime, not arbitrary renderer fields.

Persist an operation intent before a potentially accepted external write. Record acknowledgement and provider correlation IDs promptly. Clear the visible composer only when its content is safely retained as an operation/draft and accepted behaviour is known. Failed or rejected messages remain recoverable without retyping.

Use a supported idempotency key only if the provider guarantees its meaning. JSON-RPC request IDs are response correlation, not automatically idempotency keys. A local UUID alone cannot prevent duplicate provider execution.

### 12.3 Busy-thread policy

Default to **Queue after current work** only when the provider's queue semantics and cancellation/recovery are proven. If only a local queue is available, label it Queued in Threadlight, bind it to the connection epoch and revalidate the thread before dispatch. Unsent local queues require confirmation to resume after app restart or provider reconnection.

If a safe queue capability is absent, retain the draft and say the chat is busy. Do not silently steer or interrupt. A future explicit Send now/steer action may be exposed only after its race behaviour is tested; it is not required for the first messaging release.

If a different turn begins between validation and submission, follow the verified provider response. Do not force execution by changing modes or repeatedly retrying. A pending approval/question is a separate condition: answering it uses the request channel, not a queued yes/no message.

### 12.4 Uncertainty and retries

If the connection breaks before any write was possible, the operation can return to a recoverable draft. If bytes may have been accepted, mark Delivery unknown and reconcile using provider IDs, acknowledged queue entries or verified history correlation.

Matching text alone is not sufficient proof when two identical messages could exist. If certainty cannot be recovered, retain the operation and offer explicit inspection and a deliberate resend that warns of possible duplication. Do not implement a blind retry button for unknown delivery.

A transport timeout is not a task timeout. Do not kill the owning runtime when a reply takes a long time. Show elapsed time and available cancel controls instead. Threadlight's own helper timeout must be scoped to that helper, not provider-owned work.

### 12.5 Local persistence

Store drafts and a minimal operation journal under Threadlight's user-data directory. Use atomic replacement or transactional storage, a schema version and bounded retention. Proposed defaults: recoverable drafts retained for seven days; successful operation text removed within 24 hours; unresolved operations retained for seven days with a visible expiry warning. Product review can change these defaults before release.

Do not retain audio by default. Avoid storing full replies/transcripts in the operation journal. Store target references, text needed for recovery, timestamps, status and correlation IDs. Give users a clear Clear saved drafts action and document local retention. Never include message text in routine logs or diagnostic exports.

## 13. Voice targeting

Reuse the current local speech worker, microphone capture, hotkey and countdown. Treat provider selection, thread resolution and submission as separate stages.

Capture an immutable recording ID and provider context when recording starts. Resolve spoken names only within that provider and eligible local chats. Display the provider, workspace and full selected title before countdown. Equal or close matches require selection; never send based on a truncated title or a nearest match without adequate separation.

Provider switching, target changes, text editing, loss of send capability or loss of connection cancels the countdown and preserves a draft. Closing the panel or cancelling with the hotkey follows the existing explicit cancel semantics. A stale transcription callback cannot reopen a composer for the wrong provider.

Voice countdown does not run while a card requires approval, the target is ambiguous, the chat is unsupported, or the operation would have unknown busy-thread semantics. Voice Hold continues to require an explicit Send. First release does not infer provider switching from words inside a dictation; the Settings selection defines scope.

Test transcription completion after cancellation, two rapid recordings, capture-limit expiry, focus changes, IME input in the composer, and collisions between manual Send and the final countdown tick. Exactly one application operation may result from a single submission gesture.

## 14. Questions, approvals and follow-up suggestions

### 14.1 Three distinct interactions

| Interaction                             | Required channel                        | Behaviour                                                     |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Structured question                     | Original outstanding user-input request | Return validated answers under the original request identity. |
| Permission approval                     | Original approval request               | Return a supported decision with exactly the selected scope.  |
| Suggested next step in a finished reply | Ordinary message submission             | Only an explicit user action creates a new message.           |

A parsed question mark or suggested next step is not an approval request. Assistant text, hook payload text and tool output cannot authorize execution. Preserve the user's deliberate choice through a typed action.

### 14.2 Request identity and lifecycle

Represent a request by provider/thread reference, turn ID, item ID when present, opaque provider request ID, request kind, connection epoch and local presentation revision. Include creation time, any provider deadline and supported response options. An opaque string and numeric request ID remain distinct.

Proposed states: pending, submitting, resolved, expired, superseded and unavailable. Only pending requests with current verified authority can be answered. An incoming revised question increments the presentation revision and invalidates stale selections as appropriate.

When the desktop answers first, mark the card resolved and remove its controls. When the turn ends, is interrupted or replaces the request, invalidate the card. If a response races with resolution, show Already answered or No longer pending rather than retrying against a fresh request.

During reconnect, do not reuse an old transport response handle. Rehydrate a pending request through a supported mechanism or show Open in Codex. If the provider cannot safely share or hand over request ownership, Threadlight remains display-only for that request family.

### 14.3 Question presentation

Preserve original question wording, option labels, multi-select rules, free-text support and required/optional semantics. Retain per-question draft answers while the request remains valid. Do not reinterpret unknown schema features as a simpler form that might change the answer.

A recommended option may be visibly preselected only if the underlying request provides that meaning. Preselection is not submission. Require an explicit Submit action; keyboard submission applies only to the focused, visible card. Hidden cards and cards under Settings must not react to a global Enter handler.

Where provider deadlines exist, show remaining availability and disable late submission. Do not invent a universal 60-second Codex hold based on Claude's current implementation. Where a question cannot be represented faithfully, present a readable summary and Open in Codex.

### 14.4 Approval presentation

Show the action, its target, working directory where relevant, requested access and decision scope. Render only supported choices. Distinguish approve once, session-level permission and persistent policy changes; omit broad grants from the first release unless specifically designed and verified.

Default selection must not be an approval. Voice countdown, suggested answers, missing options, timeout and disconnect cannot grant permission. An approval action is bound to the exact card revision and is validated again in the main process.

Start with the smallest validated approval families. Shell execution, file changes, network access, filesystem permissions and connector elicitations can have different response schemas and routing. Unsupported families stay display-only. Authentication and external web authorization flows remain in the provider's normal UI.

### 14.5 Disconnect and shutdown

G0 must prove that closing Threadlight leaves pending requests answerable in the desktop. Merely dropping a socket is not assumed safe. If Threadlight is the sole request owner and no supported handoff exists, do not enable interactive cards in the first release.

Claude's existing holds remain provider-owned and release through their existing semantics. Codex requests do not inherit those timers or release bodies. Neither switching the visible provider nor closing Settings constitutes approval, denial or cancellation of underlying work.

## 15. Background execution and computer use

The Threadlight integration layer must run without desktop input injection. No SendKeys, mouse automation, clipboard pasting into Codex, hidden terminal typing or debugging-port UI injection is part of this design. An explicit Open action may navigate/focus the provider, and normal user setup may require interaction.

This guarantee covers Threadlight's own operations. A Codex task can independently invoke foreground tools. Current official guidance says Windows Computer Use operates on the active desktop; a separate VM is one possible isolation route. [Computer Use documentation](https://learn.chatgpt.com/docs/computer-use)

Do not label a chat Background only unless an enforceable provider capability/policy prevents foreground computer interaction for that chat. Prompt instructions alone are not an enforcement mechanism. If a future strict mode cannot be enforced without changing the user's existing session, mark it unavailable rather than silently mutating permissions.

No new computer-use implementation is required for monitoring or messaging. Defer isolated Windows sessions, virtual machines, browser isolation and cross-app task arbitration to a separate specification.

## 16. Settings migration and compatibility

Introduce settings schema version 2 while preserving global preferences. Store `selectedProvider`, provider installation references and per-provider list/workspace preferences separately. Shared voice controls and appearance remain global. Connection capabilities and outstanding request handles are runtime state, not persisted user settings.

Migration from version 1:

1. Read and validate the original file without overwriting it.
2. Copy existing list mode, chosen workspace, time window and maximum sessions into Claude preferences.
3. Set selected provider to Claude. Initialize Codex preferences with defaults, disabled until discovery/setup.
4. Preserve hotkeys, countdown, voice hold, open-on-hover, autostart and position.
5. Atomically save version 2 and retain a single pre-migration backup.
6. Verify the converted settings before using them; retain the old file on failure.

Missing/invalid individual fields may fall back safely, but an unknown newer schema version must not be silently rewritten by an older application. Add migration and downgrade detection rather than relying on the current parser's unknown-key omission.

Rollback restores the known version-1 configuration or uses a documented downgrade conversion that preserves the user's current Claude/global preferences. Inform the user that Codex-only preferences and recovery drafts are retained separately. Never downgrade provider databases or alter their metadata during rollback.

## 17. Setup, diagnostics, disable and uninstall

### 17.1 Setup flow

Selecting Codex first displays discovery results and available capability levels. If a plugin/hook installation is needed, describe what will be added and where, then follow the existing setup approval/trust flow. Remember prior authorization where applicable; do not add repetitive confirmations for read-only checks.

Use supported install/configuration mechanisms where available. Avoid editing provider settings by hand when a provider installer can own the change. If configuration merging is unavoidable, preserve unrelated fields, back up the original and record exactly what Threadlight owns.

Keep a provider-specific install manifest containing installation identity, files/settings created, versions/hashes and ownership. Do not remove pre-existing or subsequently user-modified configuration during uninstall. Detect drift and report what was retained.

Do not test setup by sending into an arbitrary existing chat. Offer an explicit synthetic test-chat procedure when implementation has been authorized. Discovery and hook trust checks can run independently of that test.

### 17.2 Diagnostics

Expose Check connection in Settings and the tray. It reports application presence, selected installation, runtime compatibility, connection state, hooks configured/trusted/observed, observation freshness and each unavailable capability with a useful next action.

Distinguish Missing application, Needs setup, Hooks need review, No events observed, Unsupported version, Connection refused, Signed out, Read access unavailable and Monitoring only. An absence of hook events alone does not prove hook misconfiguration if no activity occurred.

An exported diagnostic bundle is opt-in and contains versions, reason codes, timing summaries and sanitized schema/capability information. Exclude authentication material, prompts, replies, microphone audio, full filesystem paths, project/chat names and raw tool payloads by default. Preview what will be exported.

### 17.3 Disable and uninstall

Switching the visible provider is not uninstalling it. Lightweight observation may continue for enabled providers, while detail retrieval follows the selected view. A separate Disconnect/disable action stops new work and monitoring for that provider.

Before disabling with pending operations, show their state and distinguish unsent drafts from provider-accepted work. Cancel only unsent local queues by default. Provider-owned work continues unless the user explicitly requests a supported interruption.

Uninstall removes only Threadlight-owned integration artifacts and autostart entries. Retain user data unless removal is explicitly requested. Removing Threadlight cannot delete Codex/Claude chats, credentials, project records or application installations. Release Claude holds and detach Codex request subscriptions according to verified lifecycle behaviour.

## 18. Error handling and reliability

Use a bounded set of main-process reason codes translated into user-facing text. Preserve raw technical errors only in sanitized local diagnostic records where appropriate.

| Failure                                 | Required response                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Provider app absent/closed              | Keep tray/settings available; explain provider availability.                             |
| Unsupported runtime or schema           | Disable affected capability; preserve readable features and drafts.                      |
| Connection lost                         | Mark state stale/unknown; reconcile; do not replay writes.                               |
| Read-only store temporarily busy        | Retry with backoff; use labelled last snapshot.                                          |
| Session archived or removed during send | Known rejection or uncertain delivery as evidence dictates; preserve text.               |
| Provider account/home changes           | Disconnect, invalidate registry/capabilities and require correct installation selection. |
| Hook event duplicated/out of order      | Deduplicate/reconcile; do not regress terminal state.                                    |
| Provider request already resolved       | Dismiss controls; do not send a replacement message.                                     |
| Threadlight crashes after submission    | Recover journal and reconcile before offering retry.                                     |
| Speech model or microphone failure      | Preserve typed text; leave other provider features usable.                               |
| Local endpoint port conflict            | Show degraded monitoring; do not silently pick a port hooks do not know.                 |
| Runtime upgrade mid-connection          | New epoch and compatibility negotiation; disable unverified writes.                      |

Do not allow malformed provider data to crash the whole application. Bound payload sizes, recursion depth, text rendering, history pages and queued events. Isolate slow file/SQLite work from the UI and avoid blocking Electron's main event loop with large synchronous reads.

## 19. Privacy, permissions and public documentation

Retain Electron context isolation, sandboxed renderers and navigation restrictions. Restrict IPC to Threadlight's own known web contents and validate every incoming action against the main-process registry. Use fixed supported executable routes and argument arrays, never shell-built commands containing user text.

Provider paths and executable identities must be validated before use; a transcript must not choose an executable or redirect Threadlight to an arbitrary database. External deep links must be constructed from validated provider identities, not raw model-generated URLs.

Update the product's privacy wording accurately: speech transcription and Threadlight coordination remain local, while provider agents communicate with their own services when processing messages. Do not claim that sending through Codex/Claude keeps the entire inference process offline. Threadlight adds no telemetry or separate message server in this design.

Publish a compatibility table with the app version, runtime version, transport, enabled capability families and date tested. Document experimental dependencies and partial modes clearly. Include synthetic examples for hook trust, reconnect and delivery-unknown recovery. Keep real installation paths, chats, screen captures and diagnostic data out of the repository.

## 20. Verification strategy

### 20.1 Test layers

Use synthetic fixtures and a fake provider transport for deterministic failures. Add real-caller tests across preload, IPC, coordinator and adapter so matching unit implementations cannot hide an incorrectly wired route. Renderer tests should exercise behaviour, not duplicate internal implementation details.

Keep unit/contract tests offline. Live desktop smoke tests use dedicated synthetic chats and an authorized test run; they are separate from ordinary CI because they require an installed, authenticated app and real user-request routing.

### 20.2 Required acceptance scenarios

| Test ID | Scenario                                                                        | Requirement/evidence                                                                     |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| T01     | Claude and Codex have the same thread ID/title/folder                           | R01/R08: lists, drafts, sends and cards never collide.                                   |
| T02     | Existing desktop chat receives one synthetic message                            | R02: same history and tool context; exactly one input.                                   |
| T03     | Desktop is minimized while another app has focus                                | R03: monitoring/sending/replies cause no focus or pointer change.                        |
| T04     | Fallback reader is exercised against WAL and migrated schemas                   | R04/R06: read-only operation and correct degradation.                                    |
| T05     | Disconnect at each boundary before write, after write and after acknowledgement | R05: recoverable draft or Delivery unknown, never automatic duplicate.                   |
| T06     | Runtime method/capability is absent or changes                                  | R06/R12: only affected controls disabled, with reason.                                   |
| T07     | Desktop and Threadlight answer the same request concurrently                    | R07: one accepted answer, other card resolves safely.                                    |
| T08     | Provider switch while recording, transcribing or counting down                  | R08: no cross-provider send; original draft retained.                                    |
| T09     | Version-1 settings migrate and downgrade                                        | R09: Claude/global preferences preserved.                                                |
| T10     | Fixture and evidence scan                                                       | R10: synthetic content only.                                                             |
| T11     | Browse hundreds of historical threads                                           | R11: bounded reads and no mass runtime attachment.                                       |
| T12     | Capabilities change after reconnect                                             | R12: old request handles and write eligibility invalidated.                              |
| T13     | Late Stop/tool events follow a newer active turn                                | Correct thread/turn state; no regression.                                                |
| T14     | Long thinking phase has no tool heartbeat                                       | Working remains authoritative, or unknown if evidence expires; never false completion.   |
| T15     | Two rapid Send gestures or countdown/manual-send collision                      | One operation per gesture intent and per-thread serialization.                           |
| T16     | Different workspace selection and worktree execution roots                      | Actual project membership; no accidental folder-based merge.                             |
| T17     | Archived/unloaded/deleted chat during an operation                              | Stable target identity, honest outcome, preserved recovery text.                         |
| T18     | Question revision, expiry, interruption and reconnect                           | Stale response rejected; current answers only.                                           |
| T19     | Unknown approval family or scope                                                | Display-only fallback; no guessed allow response.                                        |
| T20     | Failed send after composer submission                                           | Message remains recoverable without retyping.                                            |
| T21     | User edits/cancels local queue before dispatch                                  | No provider write; journal records correct local disposition.                            |
| T22     | Threadlight quits with accepted work and pending cards                          | Provider continues; questions remain answerable; no owner process killed.                |
| T23     | Endpoint malformed/flooded/wrong provider or credential                         | Bounded failure; no action execution; UI remains responsive.                             |
| T24     | Hook install/trust/update/uninstall with user-modified config                   | Reversible ownership; unrelated hooks preserved.                                         |
| T25     | Accessibility and keyboard-only operation                                       | Labelled provider/status, focused-card submission, no hidden-card actions.               |
| T26     | Claude regression set                                                           | Existing workspaces, relay guard, holds, mic, hotkeys and tray remain usable.            |
| T27     | Setup with multiple binaries and aliased data-home paths                        | Correct canonical installation identity; no duplicate providers or silent selection.     |
| T28     | Unknown delivery followed by an identical later message                         | Text similarity alone cannot falsely acknowledge the older operation.                    |
| T29     | Restart with unsent local queue                                                 | Queue does not dispatch automatically after restart.                                     |
| T30     | Background tool started by a provider task                                      | Threadlight's quiet transport guarantee remains distinct from task foreground behaviour. |

### 20.3 Performance and usability targets

These are proposed acceptance targets to measure on a recorded reference Windows machine, excluding provider inference and speech-model loading:

- Event receipt to visible status update: p95 below 500 ms under normal load.
- Cached provider switch/list interaction: p95 below 250 ms.
- Steady-state monitoring: no sustained one-second full-history scans; target average idle CPU below 1% on the reference machine over five minutes.
- Stress corpus: 1,000 synthetic chats across 50 projects, with 20 simultaneous active chats and event bursts, without unbounded memory growth or loss of UI responsiveness.
- Repeated connect/disconnect and switch cycles release listeners, timers and temporary resources; measure a memory plateau after warm-up.
- Test 100%, 150% and 200% display scaling, screen-edge anchoring, reduced motion and long/localized titles. Important actions remain reachable without precision gestures.

Document measurements and hardware. Revisit an unrealistic target explicitly; do not report an unmeasured target as achieved.

### 20.4 Local preflight before any future PR publication/update

Follow the user's preflight preference: run fast structural, product-evidence and relevant coverage checks first; focused tests for changed behaviour and affected source/real-caller snapshots next; then diff and build checks where relevant. Fix failures before pushing.

Use the repository's lint, TypeScript, test, formatting and build commands. Run `npm run check` before opening a PR as required by CONTRIBUTING; arrange constituent checks to avoid needlessly repeating an already valid result. The final changed tree must have current applicable evidence. CI can run its normal full suite.

If no coverage/product-evidence harness exists, record that fact and supply an explicit scenario-to-evidence matrix rather than inventing a passing check. Do not add broad snapshot churn or unrequested coverage infrastructure solely to satisfy terminology. Re-run broad checks only when a new change or failure warrants them.

## 21. Delivery sequence

The following stages are future implementation work. This specification does not authorize installing integrations, sending live test prompts, publishing a PR or releasing a build. Stage completion requires the stated evidence, not just merged code. Keep changes small enough that each stage can be reviewed independently.

### Stage 0 — Prove desktop attachment

**Depends on:** authorization for the bounded synthetic test run.

**Work:** execute G0 in section 4. Verify read-only discovery first, then explicitly authorized writes in test chats. Evaluate the richest reliable supported route; do not spend the rest of the project implementing against an assumed endpoint. Include canonical path resolution, runtime mismatch, multi-client request routing and preservation of desktop tools.

**Deliver:** sanitized compatibility/feasibility report, selected route, capability matrix, unsupported cases and a decision record. Temporary probes must not become a hidden production dependency.

**Exit:** full-control eligible, monitoring eligible or unsupported is recorded. If full control is unresolved, stages for sending/cards remain blocked even if observation work proceeds.

### Stage 1 — Introduce provider boundaries without changing Claude behaviour

**Depends on:** agreement on the adapter contract; G0 need not block a purely structural Claude-preserving extraction.

**Work:** wrap current Claude tracker, relay and holds; add compound identities and capability descriptions; route existing IPC through the coordinator. Keep implementations in place initially to avoid a large move-only diff. Make Open provider-neutral while retaining the Claude adapter's exact URL/validation rules.

**Deliver:** adapter/coordinator contracts and a Claude-only application using them. Add synthetic collisions and real-caller boundary tests.

**Exit:** existing Claude workflows pass; no Codex controls appear before they are usable; no changes to installed hooks or autostart. T01, T09 boundary coverage and T26 pass as applicable.

### Stage 2 — Add Settings and migration

**Depends on:** Stage 1.

**Work:** version-2 settings, provider chooser, per-provider workspace state, diagnostics view and connection reasons. Add draft/recording context identity before enabling the switch during recording. Preserve existing global settings and rollback data.

**Deliver:** selectable Codex setup/availability state with simulated providers, not falsely connected controls. Validate the UI at supported scales and through keyboard navigation.

**Exit:** migration, downgrade, unknown-version, provider-switch and inaccessible-provider cases pass. A settings change alone never mutates provider configuration.

### Stage 3 — Implement Codex observation

**Depends on:** G0 monitoring eligibility and Stages 1–2.

**Work:** installation discovery, verified read transport or compatible local reader, metadata/project mapping, minimal observation hooks where required, event reconciliation and unknown-state handling. Add bounded pagination and caches. Install hooks only through the authorized setup path.

**Deliver:** monitoring preview with accurate status, workspaces and available details. Unsupported content is omitted or labelled. No send or interactive-card claims.

**Exit:** T03–T04, T06, T10–T14, T16, T23–T24 and T27 pass for monitoring. Hook trust and missing-provider tests pass on a clean profile. Resource targets have initial measurements.

### Stage 4 — Add operation journal and background text sending

**Depends on:** G0 full-control eligibility and Stage 3.

**Work:** thread-bound drafts, validated send routing, per-thread serialization, acknowledgement correlation, operation journal and reconnect reconciliation. Add native/local queue policy only if proven. Correct premature draft clearing and inaccurate send labels in the shared path without broad unrelated redesign.

**Deliver:** typed-message operation lifecycle with faithful status and recovery. Keep advanced steer/interrupt controls hidden unless separately validated.

**Exit:** T02, T05, T15, T17, T20–T22, T28–T29 pass. Desktop-open and desktop-minimized scenarios preserve the same chat, model, permissions and representative tool availability. No blind retries remain.

### Stage 5 — Connect voice to provider-aware sending

**Depends on:** Stage 4.

**Work:** provider-scoped matching, immutable capture context, duplicate-title handling, countdown cancellation and retained transcripts after switching. Keep existing local speech processing and mic behaviour.

**Deliver:** typed and spoken messages share one submission pipeline and operation journal.

**Exit:** T08 and T15 plus microphone/transcription/cancellation failures pass. Demonstrate a voice message to each provider while another application has focus; confirm that only explicit interaction moves focus.

### Stage 6 — Add structured question responses

**Depends on:** validated request routing in G0 and Stage 4.

**Work:** normalize supported question schemas; bind card revisions to request identities; synchronize answers from the desktop; handle expiry/reconnect; preserve multi-question draft answers. Keep follow-up suggestions on the ordinary message path.

**Deliver:** answerable question cards for validated families, with explicit Open fallback elsewhere.

**Exit:** T07, T18, T22 and T25 pass, including simultaneous desktop/Threadlight answers and close-mid-question. If ownership cannot be handed off safely, interactive cards remain unavailable and the release scope is downgraded explicitly.

### Stage 7 — Add selected approval families

**Depends on:** separate per-family G0 approval results and Stage 6 infrastructure.

**Work:** render the original action/access request; expose only validated scopes and decisions; enforce explicit submission and race handling. Do not treat approval data as an ordinary multiple-choice question.

**Deliver:** narrowly supported approvals, with display-only fallback for all other families. Basic message release can precede this stage if described accurately.

**Exit:** T07, T18–T19 and T22 pass for every enabled family. No approval is created by default selection, voice countdown, timeout, hidden keyboard handling or reconnect.

### Stage 8 — Harden installation and recovery

**Depends on:** all enabled feature stages.

**Work:** idempotent setup, hook trust/update behaviour, compatibility rechecks, disable/uninstall, sanitized diagnostics, recovery retention and stress/performance fixes. Exercise clean profile, existing Claude installation, app upgrade and failure mid-migration.

**Deliver:** reversible installation with an explicit compatibility profile and user-facing troubleshooting.

**Exit:** all applicable T01–T30 tests pass; performance results recorded; no personal data in evidence; no unreconciled high-impact failures. Claude remains independently usable if Codex setup fails.

### Stage 9 — Prepare a reviewable release candidate

**Depends on:** Stage 8.

**Work:** update README, CHANGELOG, PRIVACY, SECURITY, CONTRIBUTING and the original SPEC where the implemented architecture supersedes it. Capture synthetic demo screenshots and record the actual tested matrix. Run local preflight in section 20.4 before any PR publication/update.

**Deliver:** complete review package: feature scope, compatibility table, test results, known limitations, recovery behaviour, installation/uninstallation evidence and rollback instructions. Packaging must include any actual native reader/transport dependencies and be tested in the packaged app; a successful dev run is insufficient.

**Exit:** explicit release readiness review passes. Publishing/installing the release follows the user's authorization for that later action. This planning task ends with the specification, not a deployment.

## 22. Suggested review units and dependencies

Each row is a potential focused PR or equivalent local review unit. Do not publish automatically merely because this sequence names PRs.

| Unit | Scope                                                | Dependency                               |
| ---- | ---------------------------------------------------- | ---------------------------------------- |
| A    | Feasibility evidence and compatibility decision      | Stage 0.                                 |
| B    | Shared identities, adapter wrapper and Claude parity | Contract agreed; no new provider writes. |
| C    | Versioned settings, selection and setup UI           | B.                                       |
| D    | Codex discovery, metadata and workspace reader       | A monitoring result + C.                 |
| E    | Hooks/live status and reconciliation                 | D.                                       |
| F    | Draft journal and acknowledged text delivery         | A full-control result + E.               |
| G    | Voice routing and switch-race handling               | F.                                       |
| H    | Question-card response lifecycle                     | A request result + F.                    |
| I    | Selected approval families                           | H + per-family proof.                    |
| J    | Recovery, packaging, docs and release evidence       | All features enabled for the candidate.  |

Prefer contract changes and their actual callers in the same review unit. Do not land a renderer button before its main-process capability validation. Separate unrelated polish findings from this integration unless they directly affect message integrity, truthfulness or provider switching.

## 23. Compatibility and release acceptance

### 23.1 Required matrix

Test Windows versions supported by Threadlight and the selected runtime; record any narrower Codex requirement rather than inheriting Claude's minimum uncritically. Include the shipping desktop/runtime pair and at least one documented unsupported/mismatched pair for graceful degradation.

Cover: only Claude installed; only Codex installed; both installed; neither running; several CLI versions; canonical path aliases; missing hook trust; signed-out provider; limited read access; worktree projects; non-Git folders; many archived chats; minimized desktop; disconnected endpoint; and upgrade after prior successful setup.

Also test fresh installation and upgrade from current Threadlight. Verify that new native dependencies, helper executables, hook scripts and model assets resolve correctly in packaged paths containing spaces and non-ASCII characters.

### 23.2 Monitoring preview acceptance

Monitoring preview is acceptable only if identities, projects, stale-state handling, background behaviour and reversible setup pass. UI and release notes must say Monitoring only. It must not offer functioning-looking Send/Answer controls or claim full integration. This milestone does not close R02, R05 or interactive R07 for the intended product.

### 23.3 Background messaging acceptance

Background messaging requires G0 ownership proof and all applicable operation, recovery, voice and focus tests. The same desktop chat must display the submitted input and outcome. Rich features that remain unavailable must be identified explicitly. A reply from an independent runtime does not count.

### 23.4 Full intended first release acceptance

All R01–R12 requirements are satisfied for the declared scope; typed and voice messages work; supported question cards are answered correctly; approvals are either validated per family or clearly display-only; installation/upgrade/uninstall and Claude regression evidence are complete. Any excluded capability is visible in the compatibility matrix.

No release candidate may contain a hidden fallback that bypasses the owning runtime, alters permissions, opens a foreground automation flow or rewrites provider storage. Outstanding correctness failures in identity, duplicate delivery or approval targeting block release.

## 24. Rollout and rollback

Start with an opt-in local preview. Keep Claude as the migration default and enable Codex features only for an explicitly tested compatibility profile. Capability checks still run at runtime; a recorded version match is not sufficient on its own.

Validate monitoring first, then a controlled messaging trial, then question cards and selected approvals. Broader availability follows demonstrated stability across restarts and app updates. Do not claim universal Windows/Codex compatibility from one machine.

Provide a local switch to disable Codex control while retaining monitoring, and a complete disconnect option. If a runtime update breaks control, automatically disable new writes, preserve drafts and reconcile in-flight operations; do not disable safety checks to restore apparent functionality.

Rollback procedure: stop new Threadlight submissions, classify outstanding operations, detach without stopping provider work, disable/remove only Threadlight-owned Codex integration artifacts, restore compatible Threadlight settings if downgrading, and verify Claude mode. Keep unresolved delivery records available to avoid accidental resends after rollback.

Do not introduce telemetry or a hosted kill switch as part of compatibility management. An updated packaged compatibility policy may narrow capabilities, but must never silently broaden permissions or trust new hook definitions.

## 25. Decisions and remaining engineering questions

### 25.1 Decisions fixed by this specification

- One shared UI and two provider adapters; no provider-specific fork of the entire application.
- Settings selects Claude or Codex; no automatic provider switching.
- Local Codex desktop chats first; cloud/remote/WSL routes require later design.
- Owning-runtime integrity takes precedence over a shortcut that merely produces a response.
- Observation and control are independent capabilities with independent failure states.
- No UI automation, private storage writes or arbitrary second-runtime fallback.
- Questions, approvals and suggested follow-ups use distinct semantics.
- Unknown delivery is visible and never blindly retried.
- Runtime/version capability checks gate all controls.
- Computer-use isolation is separate from background integration.

### 25.2 Questions resolved by evidence before dependent implementation

| Question                                                                         | Required answer/evidence                                                   | Blocks                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| Which external connection reaches the existing desktop runtime?                  | Supported discovery/authentication contract and G0 results.                | Full sending/cards.                           |
| Does a second client receive relevant status events without taking ownership?    | Measured attach/subscription lifecycle and desktop-tool parity.            | Event-driven observation strategy.            |
| How is a queued input acknowledged and reconciled?                               | Native operation/queue IDs or another verified correlation contract.       | Reliable queued sends and automatic recovery. |
| How are approvals and user-input requests assigned between clients?              | Per-family ownership, response and disconnect tests.                       | Interactive cards.                            |
| Can current workspace selection be obtained reliably?                            | Explicit desktop selection source; otherwise fixed workspace mode.         | Follow current workspace.                     |
| Which project/history API exists in the actual runtime?                          | Installed-version contract; otherwise versioned reader support.            | Exact data-source choice.                     |
| Which hooks run in the desktop execution paths used here?                        | Synthetic lifecycle/tool coverage test, including failures and interrupts. | Hook-only freshness claims.                   |
| What survives a runtime upgrade or account/home switch?                          | Restart/migration/canonical-path test.                                     | Automatic reconnect and upgrade support.      |
| Can background-only task execution be enforced without changing the user's chat? | Verified per-thread tool policy/isolation capability.                      | Any future Background only label.             |

### 25.3 Optional expansion after a stable first release

Possible later work includes an All providers view, remote host adapters, explicit steering/interruption, creating chats, richer plan/diff displays, provider-specific usage information and isolated computer-use execution. Each must reuse compound identity and capability gating. Their appearance in the underlying protocol is not permission to add them to this release.

## 26. Implementation handoff checklist

- [ ] Read this specification, the current repository instructions and actual current source.
- [ ] Establish the G0 result before committing to a control transport.
- [ ] Record supported installations and capability families without private user data.
- [ ] Preserve Claude parity through the adapter extraction.
- [ ] Implement migration and provider identity before enabling switching and writes.
- [ ] Establish observation correctness and explicit unknown/degraded state.
- [ ] Complete acknowledged sending and recovery before attaching voice automation.
- [ ] Verify request ownership before enabling interactive cards.
- [ ] Keep foreground computer-use behaviour outside the quiet-transport guarantee.
- [ ] Complete scenario evidence, packaged-app checks and local preflight.
- [ ] Update user documentation to match shipped capabilities.
- [ ] Obtain the appropriate later authorization for live installation/publication/release actions.

## 27. Source and maintenance notes

The official references in section 2 describe available surfaces as inspected on 25 October 2026. Installed-version behaviour and the G0 evidence govern what Threadlight actually enables. Recheck references when implementation begins or the runtime changes; do not copy a current protocol example into an older runtime without checking compatibility.

The architecture, state machines, thresholds, retention defaults, milestones and acceptance tests in this document are proposed Threadlight design decisions. They are not claims that Codex supplies those policies automatically. Update this specification when a gate changes the chosen route, keeping the unresolved capability visible until evidence closes it.
