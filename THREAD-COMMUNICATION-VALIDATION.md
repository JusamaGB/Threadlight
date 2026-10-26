# Thread communication implementation and validation

Date: 2026-10-26. Local branch: `feat/agent-thread-reading`.

## Release status

The communication service, tools, journal, cards, workflow configuration and scheduler are implemented locally. This is a capability-gated implementation, not a claim that every installed provider can receive an automatic wakeup. The full specification's live acceptance criterion remains open for automatic Claude delivery and a human-operated voice/card session.

The installed Codex binary passed independent concurrent-resume ownership testing. The installed Claude binary did **not**: two competing resumes of the same disposable chat both succeeded. Claude automatic resume is therefore disabled; enrolled Claude participants can read and write the shared inbox from an existing native turn. Native desktop-owned chats are not taken over. Updating either runtime does not silently admit an untested binary.

## Delivered behavior

- Exact native destination discovery through provider catalogues, independently of the visible recent list. Unsupported and busy destinations retain explicit capability reasons. Host support is local only.
- A single persistent SQLite communication journal and writer arbiter for Agent tools, enrolled peers, workflow scheduling, composer delivery and legacy handoff dispatch. Original text, source, recipient set, operation IDs, reply links, per-recipient receipts and events are retained.
- Idempotent sends and answers; separate sender and group replies; incoming history and pagination; native final results recorded separately from task acceptance. Process creation is not a Claude delivery acknowledgement. Codex acceptance requires the matching native thread identity and a turn-start event.
- Project membership and communication/work-request permissions, revoked-access checks, one-off privacy, exact request generations, causal delivery limits, reciprocal-question detection and a shared project execution budget.
- Native hook cards and owned runtime RPC requests use their real response paths. Replacement and expired cards are rejected. Secret owned-runtime questions stay in the private native input control. An Agent voice answer requires a UI-selected live card and fresh trusted human input; peers cannot mint that authority.
- Human-readable project and Agent timelines; role discovery and workflow configuration; question answers, result acceptance, source links, unsent cancellation/resume, and evidence-based reconciliation of uncertain delivery.
- Versioned roles/models, manual/assisted/automatic progression, accepted-result dependencies, pinned inputs, output-folder checks, conservative shared-workspace serialization, pause/expiry/budgets and restart policy.
- Changed ideas hold unsent work until a version-checked plan review. Delivered briefs remain immutable. Explicit amendments use correlated messages. An optional configured native coordinator receives coalesced project events through the same outbox. The event cursor records a queued notification, not proof that the model has assessed it.
- Existing folder subscriptions remain separate explicit rules. Enabling automatic workflow ownership requires resolving active legacy subscriptions first. Their native sends share the arbiter and budget; they are not silently converted into a second review rule.
- Database version 1 migrates to version 2. Backup/restore includes communication records, operation deduplication and event history. Restoring pauses coordination, expires restored question capabilities and revokes hosted communication tokens. Unknown deliveries never retry automatically.
- Both generated plugin protocols and hosted Claude/Codex tool registration are updated. The read-only thread reader remains separate.

## Evidence

Evidence directories are outside the repository; they contain disposable-chat IDs and sanitized results, not authorization tokens.

| Check                                                                                                                | Result                                                                              | Evidence                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Independent competing native writers                                                                                 | Codex rejects a competing writer; Claude permits both                               | `Z:/Temp/threadlight-ownership-R79gH2/ownership.json`                                                             |
| Claude explicit same-session-ID alternative                                                                          | Both attempts reject; not a usable delivery route                                   | `Z:/Temp/threadlight-ownership-Jlxd6V/ownership.json`                                                             |
| Claude → Codex, Codex → Claude, exact direct replies, human question/answer and saved result                         | Passed with explicitly driven isolated native turns; not automatic Claude wakeup    | `Z:/Temp/threadlight-peer-proof-Pmfxmw/communication.json`                                                        |
| Native coordinator planning, background implementation, acceptance gate, native review of saved output               | Passed through production communication service/MCP and admitted Codex resume       | `Z:/Temp/threadlight-workflow-proof-sPfGn8/workflow.json`                                                         |
| Actual renderer workflow setup, full discovery, multiline DM, persisted reload, project question and native response | Passed; transport fixture does not launch providers                                 | `test/ui/communication.smoke.mjs`; screenshots in `Z:/General/threadlight-e2e/communication/`                     |
| Focused communication/recovery contracts                                                                             | 151 focused regression tests passed, including communication and recovery contracts | `test/communication.test.ts`, `test/communicationIntegration.test.ts`, affected native/Agent/memory/Spaces suites |

The workflow proof's first attempt failed because the harness imported the ownership helper from the wrong module. That import was corrected; the successful run above completed both tasks. The relay test's original two-second child-process wait proved too short on this Windows host; it now waits for the asserted condition with a bounded timeout.

## Explicit remaining acceptance and limits

Peer communication currently requires a bound, project-wide writable memory enrollment **and** explicit workflow communication permission. Folder-limited and read-only peer enrollment is not admitted for DM tools in this implementation.

1. **Automatic Claude wakeup is blocked by installed-runtime ownership behavior.** No file locks, transcript editing, copied chats or silent forks are used to bypass it. The UI reports inbox-only availability. Existing composer sends also require admitted delivery capability.
2. **Open native desktop delivery and remote hosts are unsupported.** Queueing does not claim these paths work. Native owner release is required before an admitted CLI resume can run.
3. **A live human voice/card E2E is still required.** Typed UI response routing and service-level trusted-input checks are tested; this is not a claim that speech recognition and conversational selection were exercised with the user's microphone.
4. **Role model changes are not silently applied to native chats.** A mismatch blocks dispatch. Unverified explicit reasoning overrides are blocked. A chat missing fresh model metadata can be discovered and messaged in the inbox, but cannot pass a model-constrained background dispatch gate.
5. **Resource scheduling is conservative.** All assignments claim the configured project workspace in addition to explicit resources. Same-workspace work is serialized; remote/isolated-workspace parallel execution is not inferred from different chat IDs.
6. **Coordinator notifications are durable, not a native subscription API.** Runtime disconnects become uncertainty. A failed or uncertain coordinator turn requires review; it is not blindly repeated. Existing folder subscription rules need an explicit migration decision.

The response-authority rerun passed 40 communication, recovery and hold tests. The final 28-test communication/recovery run passed, including two added cases for cancellation and a competing composer writer while asynchronous discovery is in flight.

The final synthetic voice-routing screen check passed after Chromium was explicitly configured to allow generated audio without a physical activation gesture. The harness reports suspended audio contexts on failure; no microphone behavior was changed for this fix.

Type checks, focused lint, plugin asset consistency, formatting, diff checks and the production build passed.

No changes were pushed, no PR was opened, and the running user application was not restarted by this build.

## Follow-up: Claude existing-runtime inbox investigation

Investigated on 2026-10-26, after the implementation above. **An existing-process delivery path passed a native proof; it is not yet integrated into the production communication service.** The failed concurrent-resume test remains valid. Sending to an already-running inbox is a different capability and should have its own admission gate.

Claude documents a per-session inbox, Windows named-pipe authentication, and hook-exported `CLAUDE_CODE_MESSAGING_SOCKET` / `CLAUDE_CODE_MESSAGING_TOKEN`. The native receiver applies inbound policy. Desktop and non-interactive sessions are included in the messaging documentation. [Official cross-session messaging reference](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).

The installed executable's own debug recipe supplies the message framing: an auth JSON line followed by a `type: "user"` line containing `message: { role: "user", content }`. The proof additionally supplies the exact `session_id` and a UUID. The complete raw wire contract is not a versioned public SDK schema; treat this adapter as runtime-version-specific even though the inbox and hook variables are documented.

### Native evidence

Executable: Claude Code 2.1.308 bundled with Claude Desktop; SHA-256 `c9796ba22a9221586b36371b36f5b66198d66eb4badf6a4cf4a5f7b07becea53`.

Harness: `test/live/claude-runtime-inbox.proof.mjs`. Report: `Z:/Temp/threadlight-runtime-inbox-9V7fkn/proof.json`. An earlier smaller proof also passed in `Z:/Temp/threadlight-runtime-inbox-FcLrut/proof.json`.

All sessions were disposable and tool-free. The harness owned their initial stdin streams, but every wakeup under test went through their native named pipes. It used a test-only SessionStart hook to obtain each process's own exported endpoint and token. No existing user chat received a test message. The resumed process started only after the original process exited. All four tested processes exited successfully.

| Case                                   | Observed result                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Idle process receives message          | New response in the same process and native chat ID                                                             |
| Message arrives during generation      | Follow-up processed by that runtime; original response completed                                                |
| Invalid auth token                     | Probe did not reach the model                                                                                   |
| Wrong `session_id` with valid token    | Native debug log explicitly reports destination mismatch; probe did not reach the model                         |
| Repeated message UUID                  | **Two responses: UUID does not provide native deduplication**                                                   |
| Closed process endpoint                | Connection fails with `ENOENT`                                                                                  |
| Sequential restart of same chat        | New process and token; previous token rejected, fresh token works                                               |
| Explicit `crossSessionInbound: refuse` | No model delivery despite a valid token                                                                         |
| Explicit `crossSessionInbound: hold`   | No model delivery despite a valid token                                                                         |
| Pipe write outcome                     | Empty response and no transport error for both accepted and policy-blocked messages; **not a delivery receipt** |

The probe kept the native token in memory. Its final cleanup redacts test registration credentials from generated debug/settings files and reports. Negative delivery checks used a later successful response as a barrier; hold/refuse barriers used the owned stdin so they did not override the restriction under test.

### Proposed integration against current code

1. **Authenticated runtime registration.** Extend the installed Claude hook/plugin helper to register the native chat ID, process identity/start generation and inbox endpoint with Threadlight. Keep the native token private to the helper or main-process memory. Match registration to an enrolled chat and validate the named-pipe server's actual process identity. The existing unauthenticated `/hook/*` status endpoint is unsuitable for registering send capabilities. Re-register after process or Threadlight restarts; never recover runtime secrets from the communication journal.
2. **Separate transport capabilities.** `CommunicationCatalog` currently requires `!observed.live`, and `index.ts` admits only the tested Codex resume path. Add a separately verified `claude-runtime-inbox` capability. Its generation must identify a particular live process/registration, unlike today's stable `local:provider:chatId` value. Keep Claude concurrent resume disabled. Reject ambiguous registrations when more than one process claims the same native chat; do not choose the newest arbitrarily.
3. **Persist first, then notify.** Keep sender identity, full message, recipient set, task, permissions and audit events in the existing SQLite journal. Send a small notification identifying pending inbox work and its correlation ID. Do not place a raw external request into a wrapper that claims human authority. A hook token carries native own-child privileges; granting this wakeup capability must be explicit, scoped to that enrolled chat, and must never grant permission-approval authority to peers.
4. **Add a transactional claim/acknowledgement.** `read_inbox` currently returns a snapshot without claiming or acknowledging individual deliveries. Add an authenticated, idempotent claim scoped to the recipient, message, attempt and runtime generation. Multiple wakeups must resolve to the same claim, with a clear already-claimed response. Call the production `accepted` callback only on correlated recipient evidence. A successful socket write alone leaves delivery unconfirmed. Expired claims require reconciliation, not automatic replay of potentially executed work.
5. **Correlate completion through existing tools.** Route questions and responses through the current request records; return DMs with `replyTo` and save assignment results through the existing submission flow. A Stop hook means a turn ended, not that a particular assignment succeeded. The current `deliver` promise assumes a fresh CLI invocation returns a final reply; the inbox adapter needs a pending observer resolved by correlated tool/result evidence instead. Keep the persisted human-review history as the authority across Claude and Codex.
6. **Handle lifecycle explicitly.** Revalidate generation, enrollment and policy before dispatch. On disconnect, retain unconfirmed delivery as unknown and inspect the journal before deciding anything further. Coalesce wakeups; do not retry the full task text. A running idle runtime can be woken by this route. A closed runtime has no inbox and still needs a separately proven provider-owned launch path; this proof does not authorize automatic CLI resume of arbitrary Desktop chats.

### Other routes evaluated

- **Channels:** a documented MCP notification mechanism, but custom development channels require interactive startup opt-in and are ignored with `-p`. This does not solve attachment to arbitrary current Desktop chats. [Channels reference](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview).
- **Owned stream-json stdin:** already used by `AgentRun`; appropriate when Threadlight owns the child process. It does not attach to the input stream of another application's existing process.
- **Cloud follow-ups:** `claude -p --cloud <session-id>` queues into an existing cloud session and exits. A possible future remote transport; not validated here and not interchangeable with local native IDs. [Cloud CLI follow-ups](https://code.claude.com/docs/en/claude-code-on-the-web#send-follow-ups-from-the-cli).
- **Background resume:** the installed help explicitly allows copying an already-running session; unsuitable for exact-destination delivery.

### Remaining sign-off

This establishes native transport feasibility, not production readiness. Next acceptance work is authenticated enrollment/registration, transactional claims and receipt recovery, disconnect/revocation races, ambiguous duplicate owners, and an actual Desktop-hosted end-to-end run with visible message history and permission/question cards. The existing Desktop runtime's metadata advertises peer messaging, and Desktop shares the hook configuration, but no message was injected into that user's running chat. [Desktop shared configuration](https://code.claude.com/docs/en/desktop#shared-configuration).

Production admission remains unchanged. This investigation adds the reproducible live probe and this report only.
