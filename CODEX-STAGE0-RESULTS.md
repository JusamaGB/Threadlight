# Codex desktop attachment: Stage 0 results

Date: 25 October 2026. Scope: the currently running Windows desktop installation.

## Decision

**Stage 0 did not establish a supported independent connection from Threadlight to the existing desktop runtime. Do not begin the sending, question-card or approval integration on the strength of these tests.**

The desktop's built-in chat-management tools successfully sent synthetic messages to a dedicated desktop chat, received replies, delivered a follow-up during an active turn and preserved a desktop-provided tool. These are positive control tests of an existing trusted app bridge. They are not evidence that a standalone application can call that bridge with its own identity.

An independent client failed to connect to the standard control socket using both installed CLI versions and both equivalent data-home paths. Installed desktop code and the running process configuration explain this result: this Windows runtime uses stdio, and the automatic local shared-daemon branch explicitly excludes Windows.

**Compatibility classification: not eligible in the tested configuration; treat independent attachment as unsupported until a supported route is demonstrated.** This is a scoped result, not a claim that all Codex installations or future versions are incapable of integration. Monitoring is promising but remains unverified as a complete product capability: bounded metadata reads worked; hooks, reconciliation and recovery were not exercised.

## Scope and isolation

- Product baseline: `90d4974`; research branch: `research/codex-stage0`.
- A separate Git worktree was used because the original checkout contains concurrent application edits. No original checkout changes were staged, moved, reverted or overwritten.
- The repository has no configured remote. No fetch, push, pull request or release was performed.
- Only one newly created, projectless synthetic desktop chat received test prompts. Other chats were not sent messages.
- No Threadlight integration code, hooks, provider settings or authentication settings were changed.
- The desktop and its existing app-server process were not restarted, terminated or replaced. No competing app server was started against the existing history.
- No foreground computer control, window activation or simulated typing was used.
- Temporary probes were investigative only. No probe executable, private transport wrapper or raw history dump is part of this change.

This report contains synthetic markers and normalized installation details. Personal filesystem paths, account details, actual chat identifiers and other conversations are intentionally omitted.

## Installation evidence

| Component                             | Observed value                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Desktop package                       | `26.1021.3705.0`, Windows x64                                                                                              |
| Running desktop-managed CLI           | `0.164.0-alpha.11.1`                                                                                                       |
| Separately installed CLI              | `0.157.1`                                                                                                                  |
| Running desktop app-server invocation | `app-server --analytics-default-enabled`; no `--listen` argument                                                           |
| Data-home resolution                  | The user-profile `.codex` location is a junction to the canonical `.codex` directory; both paths refer to the same storage |
| Standard control socket               | Present on disk; connection refused through either path                                                                    |
| TCP listener query                    | No listening TCP endpoints returned for the desktop process or its app-server process                                      |

A socket file existing does not establish that a server is listening. Likewise, the two spellings of the data-home path are not separate installations. Using the desktop's matching CLI did not change the connection outcome, so version mismatch alone does not explain the failure.

### Installed transport inspection

Read-only inspection of the installed application archive located the local transport in `.vite/build/application-network-startup-B4Wezh-6.js` and its caller in `.vite/build/main-BPBEjAxi.js`.

The local stdio transport's `connect` method chooses the shared-daemon branch only when several conditions hold, including a non-Windows platform and an opt-in environment value. Otherwise it constructs the stdio connection. The running Windows process is consistent with that branch selection.

The package also contains WebSocket override handling. Finding an internal override is not proof of a supported desktop configuration, shared ownership, tool routing or safe recovery. No override was set and no app restart was attempted.

The installed `codex-app-tools` bridge uses a private pipe and executor context, including originating thread/turn/call information. Its availability to an executing Codex chat does not establish an external application contract. No executor context was forged or replayed, and the private pipe was not used directly by the independent probes.

These implementation details explain this installation. They must not become hardcoded production discovery rules.

## Independent connection probes

The probes invoked the CLI's `app-server proxy --sock` command and attempted initialization under the distinct client name `threadlight_stage0_probe`. They did not request a daemon startup, resume a chat or send a turn.

| Probe | Binary              | Socket path spelling | Result                                                                      |
| ----- | ------------------- | -------------------- | --------------------------------------------------------------------------- |
| P1    | Standalone CLI      | Canonical data home  | Exit 1; Windows connection refused, error 10061; no initialization response |
| P2    | Standalone CLI      | Junction alias       | Same result                                                                 |
| P3    | Desktop-managed CLI | Canonical data home  | Same result                                                                 |
| P4    | Desktop-managed CLI | Junction alias       | Same result                                                                 |

These are transport failures before protocol negotiation. They do not prove an authorization rejection or an unsupported JSON-RPC method. No independent connection epoch, subscription or request ownership was established.

All four probe processes exited. No retry daemon or persistent background probe was installed.

## Positive controls inside Codex

The dedicated test chat was created through `create_thread`. Subsequent operations targeted that same existing chat using `send_message_to_thread`, `wait_threads` and bounded `read_thread` calls. This avoided the common false positive of creating a new CLI conversation for each message.

| Test                           | Observed result                                                                                                                                      | Limit                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Initial reply                  | `TL_STAGE0_READY_20261025`                                                                                                                           | Confirms desktop chat creation and response                                                                                 |
| Idle-chat follow-up            | `TL_STAGE0_IDLE_SEND_A_20261025` and `ARTIFACT_COUNT=0`                                                                                              | Confirms delivery and successful `list_artifacts` desktop tool call through the built-in bridge                             |
| Initial busy test              | Base marker returned after the requested wait                                                                                                        | Follow-up was not delivered before completion; this attempt is not evidence of busy delivery                                |
| Repeated busy test             | Active state observed, then follow-up sent; both `TL_STAGE0_BUSY_REPEAT_20261025` and `TL_STAGE0_BUSY_FOLLOWUP_B_20261025` returned in the same turn | The requested 45-second wait ended early; observed behavior is active-turn steering/wakeup, not a guaranteed deferred queue |
| Plain-text question and answer | A synthetic blue/green question received a blue answer in a subsequent message                                                                       | Ordinary conversational answering only; not a structured request response                                                   |

### Message semantics matter

The history reader represents these delivered inputs as `functionCallOutput` items for `codex_app.send_message_to_thread`, wrapped as delegated input. They are not ordinary `userMessage` items.

Consequently, even a successful built-in bridge delivery does not pass the specification's requirement for exactly one matching user input through an independent client. The bridge's trust model, delivery receipts and retry semantics would need a separate explicit design if it were ever offered as a supported external integration.

The active-turn test completed normally rather than entering an interrupted terminal state. It nevertheless woke the waiting operation early. Do not label this behavior “queue until idle.” Only one synthetic active-turn scenario was exercised; arbitrary tool calls and long-running work remain untested.

## Read-only metadata evidence

SQLite databases were opened read-only and queries were restricted to the synthetic chat identifier. No database writes or transcript-wide export occurred; read handles were closed afterwards.

- `state_5.sqlite` contained the same stable chat identifier used by the desktop tools.
- Its `name` field held the synthetic display name while `title` was empty. A reader that assumes only `title` would show an incorrect blank label in this case.
- `project_id` was null, consistent with the projectless test. Real project mapping was not tested.
- `source` was `vscode` for this desktop-created chat. It is not a reliable desktop-versus-editor discriminator by itself.
- `history_mode` was `paginated`. The separate history database contained the test turns and items.
- At the snapshot before the later question/answer controls, history contained four completed turns, five delegated-input items, one MCP tool call, two sleep items and seven assistant-message items. These counts agreed with the control sequence.
- The app history reader returned a bounded one-turn page with a continuation cursor. This did not require resuming the chat from an independent CLI.

This establishes that a bounded reader can locate relevant data in this installed schema. It does not establish an authoritative event stream, durable exactly-once delivery, complete project discovery or compatibility with future schema versions. Read-only file access is not an alternative control channel.

## Stage 0 acceptance matrix

The identifiers below correspond to the previously drafted integration specification. A pass through the built-in app bridge is explicitly separated from an independent-client pass.

| Gate                                               | Status                          | Evidence or remaining gap                                                                                                 |
| -------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| G0.1 Installation and endpoint discovery           | Partial                         | Installation, runtime versions and canonical data home resolved. No usable independent endpoint discovered.               |
| G0.2 Independent initialization                    | Failed in current configuration | Four socket probes refused before initialization.                                                                         |
| G0.3 Discover chat and project                     | Partial                         | Same synthetic chat identity found in read-only metadata and desktop tools. Non-null project mapping unverified.          |
| G0.4 Observe desktop-started turn                  | Built-in control only           | Active and completed states correlated through app tools. Independent event subscription unverified.                      |
| G0.5 Bounded recent history                        | Partial                         | App-tool pagination and local paginated history verified. No independent runtime history API connection.                  |
| G0.6 Idle send with exactly one user input         | Not passed                      | Built-in follow-up produced a reply, but its persisted input is delegation/tool output. Independent delivery unavailable. |
| G0.7 Send while working                            | Built-in control only           | Same-turn follow-up observed with early wakeup. External queue/steer/reject behavior unverified.                          |
| G0.8 Open in desktop with external client attached | Unverified                      | No external attachment existed; no focus-changing UI test performed.                                                      |
| G0.9 Structured question in both clients           | Unverified                      | Plain-text Q&A is not a structured response. No independent request channel; no interactive card was created.             |
| G0.10 Harmless approval request                    | Unverified                      | No independent response channel; no approval test initiated.                                                              |
| G0.11 Disconnect around acknowledgement            | Unverified                      | No initialized independent connection or acknowledgement lifecycle.                                                       |
| G0.12 External-client exit during work/request     | Unverified                      | No attached external client. No pending structured request was left behind.                                               |
| G0.13 Desktop restart and reconnect                | Unverified                      | Intentionally deferred because other applications/work are active and no supported attachment route is established.       |
| G0.14 Preserve desktop-provided tools              | Built-in control only           | `list_artifacts` succeeded in the test chat; preservation under external attachment unverified.                           |

Neither the full-control gate nor the monitoring gate is passed. “Unverified” must not be converted to “supported” in settings, delivery labels or release notes.

## Capability decision

| Candidate route                           | Decision for this installation                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Built-in Codex chat tools                 | Working internal control; no demonstrated standalone access contract                |
| Standard shared control socket            | Failed; cannot select as Threadlight's current route                                |
| Independent CLI resuming existing history | Not tested or selected; would not prove attachment to the desktop's live runtime    |
| Private app-tools pipe                    | Not selected; requires a separate supported authorization and lifecycle contract    |
| Internal WebSocket override               | Not selected; existence in code is insufficient; shared desktop behavior unverified |
| Read-only metadata/history                | Feasible research fallback for observation; not yet monitoring-qualified            |
| Hooks                                     | Documented option, not installed or exercised in this run                           |
| Foreground UI automation                  | Outside this background integration scope; not used                                 |

The public [App Server documentation](https://learn.chatgpt.com/docs/app-server) describes stdio as the default, shared-server connection options and experimental WebSocket transport. These protocol capabilities do not establish that an already running Windows desktop exposes a supported external listener. A separate server process sharing a data directory would not satisfy this test's attachment requirement.

The [hooks documentation](https://learn.chatgpt.com/docs/hooks) is relevant to a later bounded monitoring experiment. Hooks were not needed to establish the transport failure and were not installed into the user's active configuration.

## Next feasibility work

1. Establish a documented, independently authorized external connection to the desktop-owned runtime. The required evidence is an initialization response for Threadlight's own client identity, followed by listing and reading the existing synthetic chat without a second writer.
2. If the only candidate requires changing how the desktop starts, test it in a separate disposable environment first. Prove desktop tool ownership, shared subscriptions and same-chat routing there before proposing any change to the active installation. An internal environment override alone is not an acceptance result.
3. Once attachment passes, repeat idle delivery with a real user-input item, then busy delivery, per-family question/approval responses, acknowledgement ambiguity, client exit and desktop restart. Each request response must correlate to its original request and invalidate stale cards in both clients.
4. If independent control remains unavailable, decide separately whether monitoring-only scope is worthwhile. First test hooks or a version-aware read-only observer with reconciliation, stale state, process exits and project mapping. Do not expose Send or Answer controls on the basis of readable history.

The immediate decision is to keep integration implementation paused at this feasibility boundary. More protocol methods do not remove the need for a supported way to reach the actual running desktop session.

## Validation and review scope

This is a documentation-only result. Runtime probes and synthetic control checks above are the behavioral evidence; no product tests were added to mirror investigative code.

Local preflight covers the complete report diff, all 14 acceptance identifiers, synthetic-only content, Markdown formatting and whitespace. Application lint, typecheck, tests and build are not claimed as run for this report; no application sources or dependency files changed. Before any future pull request, the repository's required `npm run check` must be handled under its contribution policy.

No integration was built or released. The test chat is retained for inspection and left idle after the final synthetic answer.
