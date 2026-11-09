# Threadlight for Codex

Authorized project coordinators can draft versioned processes with
`threadlight_save_process`, inspect them through `threadlight_get_workflow`, and
invoke/control runs under existing human grants. These are the same graphs shown
in Workflow; runs appear in Handoffs. No agent tool grants execution authority or
replays uncertain effects. See [workflow setup and limits](../docs/WORKFLOWS.md).

This plugin reports local Codex activity to Threadlight on `127.0.0.1:47616`.
It does not change Codex's databases or session files. The Claude plugin and its
endpoint on port 47615 are separate.

## Enable

Use a current Windows Codex desktop app and its signed-in native `codex.exe` CLI.
The initial compatibility check used CLI `0.164.0-alpha.11.1`. Threadlight needs
Node 22.16+ on PATH for the plugin bridge and development; its Electron runtime includes SQLite.

From the Threadlight checkout, register and install the local marketplace:

```powershell
codex plugin marketplace add .
codex plugin add threadlight-codex@threadlight-local
```

Review and trust the installed hooks in Codex's hook controls (`/hooks` in the
interactive CLI). Installing alone does not grant hook trust. Do not enable a
global trust bypass. New or resumed sessions load the plugin; already loaded
desktop chats may require reopening after their writer is released. See the
[Codex plugin commands](https://learn.chatgpt.com/docs/developer-commands) and
[hook trust documentation](https://learn.chatgpt.com/docs/hooks).

In Threadlight, enable **Settings → Providers shown → OpenAI**. The Claude and Codex
toggles are independent: both on shows a combined list with blue Codex and orange Claude edge tints;
both off pauses chat monitoring. Upgrading preserves the previous selection;
new installs using the setup script start with the selected providers. Composer drafts are saved in Threadlight's
own local recovery store; question-card drafts remain in memory. Claude, Codex and the combined view each keep
their own workspace selection.

For a first installation from source, ask a local assistant to follow the bundled
setup skill or run `node scripts/install.mjs --providers codex` from the checkout.
It builds Threadlight, registers the marketplace and installs the plugin. Use
`--check --providers codex` to inspect the result. Provider visibility in Settings
is independent of plugin installation.

## Behavior

- State comes from hooks, `state_5.sqlite`, optional `thread_history_1.sqlite`,
  bounded session JSONL tails and desktop activity metadata under `CODEX_HOME`
  (or `~/.codex`). Database connections are read-only and never migrate data.
- Connected local desktop chats receive human messages through their existing
  Codex desktop owner. Automatic submission sends directly to a confirmed idle or
  known-empty chat; a confirmed active turn queues the input in Codex's native
  queue. Queued entries support Edit, Remove and explicit Steer, with attachments
  and native identities retained. Unknown or rejected delivery preserves the
  draft/error and never silently queues, steers or retries through another route.
  See [queue evidence and routing limits](../docs/validation/CODEX-QUEUE-VALIDATION.md).
- Unavailable connections show their reason. **Copy and open Codex**, where
  offered, requires an explicit click and does not submit the pasted draft.
  Unloaded-history CLI continuation remains a separate capability; it is not an
  automatic backup after an uncertain desktop send. No sandbox, approval or
  hook-trust bypass flags are added.
- Expanded chats receive desktop-owned live updates with saved-history fallback.
  Local file/image attachments, inline composition and history scrolling are
  covered in [live thread view validation](../docs/validation/LIVE-THREAD-VIEW-VALIDATION.md).
  This does not implement ChatGPT's cloud Files uploader.
- Permission-request cards can allow once or deny. Stop hooks can hold a final
  paragraph ending in a question mark and continue with the user's answer.
  A card's nonce prevents a stale answer from resolving a different request.
- Holds release after 60 seconds, on exit, when Codex is toggled off, when their client
  disconnects, or when opened from Threadlight. Because there is no reliable
  persisted foreground-chat identifier, bringing the Codex/ChatGPT window forward
  conservatively releases all Codex holds. Release returns no decision, never allow.
- Supported native asynchronous question cards use the separate desktop answer
  path, revalidating the active turn and exact question before submission. They
  do not invent an answer-through-hook contract. Unsupported or expired cards
  retain their unavailable/fallback behavior. Dictation fills an answer draft for
  review; closing the card prevents late transcription from changing a new draft.
- Future questions can use Threadlight-managed cards through `threadlight_ask_question`
  with `audience: "human"`, `answerDelivery: "tool"` and optional `allowOther: true`.
  The human answers on the linked thread; the agent collects the result with
  `threadlight_read_question` on its existing connection. Requires approved linked
  project access and communication permission. See the
  [decision-card specification](../docs/specs/MANAGED-DECISION-CARDS-SPEC.md).
- Open uses `codex://threads/<id>`. Workspace following uses last recorded user
  activity, not a claim about the exact foreground tab. Remote/cloud chats are
  outside this local-file adapter. The separate [hosted Agent](../README.md#hosted-agent)
  supports Claude and Codex and answers its own runtime's questions directly.
  Codex PR badges and background task inventory are not inferred.
- Codex plans include explicit step updates and proposed plan text. Current steps
  appear in the row and plans stay visible above waiting cards. Step activity drill-down
  remains Claude-only; Codex steps do not pretend to have that data. Proposed plans
  are also fetched outside the 200-item history page. Legacy rollout-only plans are
  limited to the bounded recent tail, so older plans may be unavailable after restart.
- A separate weekly usage bar reads Codex's local `token_count.rate_limits` reports,
  identifying the week by its reported duration rather than assuming it is the
  secondary window. Other usage buckets are ignored. Hover shows the observation
  time and reset; expired or absent data is unavailable, not zero. This makes no
  model calls and does not launch another Codex engine. The quota updates only when
  Codex writes a report. The native formats are described in the
  [Codex protocol documentation](https://learn.chatgpt.com/docs/app-server).

Hook POSTs require authenticated encryption using a protected user-scoped key.
The ports bind only to loopback and retain browser-request filtering. Upgrade the
app and both plugin caches together and review/trust the changed hooks; old curl
hooks are rejected. If Threadlight is absent or authentication fails, helpers
return no decision. See [local IPC security](../docs/security/LOCAL-IPC.md) for the
upgrade procedure, same-user limitations and remaining Codex router issues.
Messages sent through Codex use the user's OpenAI account.

## Shared memory

Version 0.3.0 adds authenticated local transport to the shared-memory bridge and
status/card hooks introduced in earlier versions. Both the portable plugin manifest and the installed
client's compatibility manifest point to the bundled tools. Plugin installation does
not authorize any memory access.

Ask the chat to connect to Threadlight shared memory. Match its verification code
in the project's **Chats → Requests**, then approve read-and-publish access to that
space. A current plugin can include this chat's
native ID so the request identifies it automatically. It uses the returned connection ID
on every call. The same skill teaches Claude and Codex how to file research, decisions,
attachments and build outputs, read exact revisions and recover context after compaction.
After showing the code, `memory_wait_for_approval` can wait up to 50 seconds per
call, within the request's five-minute lifetime. Approval returns to that active
caller once; the chat verifies its same connection before reading the briefing.
No separate workflow checkbox is required. This is not an idle-chat wakeup:
closed/idle chats and older identity-free requests still need a human follow-up.
The existing private desktop composer channel is not used for this callback.
The bridge now authenticates Threadlight and encrypts enrollment, credentials and
memory traffic using a Windows-protected account-scoped key. Update the app and
both complete plugin packages (including `memory-transport.mjs`) together. Approved
native-chat/project links can be restored after restart from their private pairing
cache. Missing, changed or revoked pairings require fresh approval; old plaintext
clients are rejected. This does not isolate malicious code running as the same user.
See [the memory guide](../docs/SHARED-MEMORY.md#plugin-setup) for the complete workflow.

For an existing local installation, refresh its cached package using the installed
Codex plugin manager. This CLI version supports remove followed by add:

```powershell
codex plugin remove threadlight-codex@threadlight-local
codex plugin add threadlight-codex@threadlight-local
```

Keep the marketplace registered to the intended updated checkout. Reconnect tools or
reopen the conversation to load the new package; review hook trust again if requested.
Removing/reinstalling is a deliberate setup step, never automatic background behavior.
No PC restart is needed. Memory access is separately approved and lasts until disconnected or revoked;
this does not grant new delivery or approval capabilities.

## Validation and removal

Use only disposable chats when testing sends or answers. Installed-runtime proofs
cover native creation and desktop-owned first/follow-up messages, native queue
editing/removal with image preservation, and explicit Steer. See
[creation/handoff evidence](../docs/validation/HEADER-THREAD-PICKER-VALIDATION.md),
[native message proof](../docs/validation/NEW-CODEX-THREAD-VALIDATION.md) and
[queue validation](../docs/validation/CODEX-QUEUE-VALIDATION.md). The 29 October
automatic idle/active routing correction has focused automated tests; the earlier
live queue proof does not certify that correction. Question/approval checks and
synthetic microphone tests do not establish every live provider or hardware path.

Run `npm run check` and `npm run build` for the local preflight. Tests use generated
databases and fake CLI output rather than personal Codex data. To remove the plugin:

```powershell
codex plugin remove threadlight-codex@threadlight-local
codex plugin marketplace remove threadlight-local
```

Removing the plugin leaves chats and Threadlight settings intact. Turning Codex
off releases its holds; turning Claude on alone does not release Codex cards.

Connection setup now starts in the open project’s **Chats → Connect a chat**.
The optional `chatId` argument identifies the current native chat UUID, removing
the second chat picker when that session is available. Refresh the cached plugin
and reconnect its tools to expose this argument; existing requests remain usable
through the cross-folder searchable picker after the app reloads.

### Save notes by purpose

Both Codex and Claude plugins accept `purpose: note | work_context | result`.
User-requested notes and ideas appear in the project's Notes and `notes/`, with
server-recorded saver, source chat and time. Notes edits use the same memory item
and revision history; discussing a note links it without copying. Checkpoints use
Handoffs/`handoffs/`; deliverables use `results/` and separate submission/acceptance.
Explicit-purpose saves never create assignments or send messages. Existing access
scopes still apply. Old callers omitting purpose and historical records retain
legacy routing; no author/keyword migration occurs. See
[the purpose contract](../docs/specs/NOTE-PURPOSE-SPEC.md) for compatibility details.
Activation requires the rebuilt app plus refreshing/reconnecting each installed
provider plugin; rebuilding alone does not replace an installed plugin cache.

### Connect to a named project

Ask the chat to connect to the intended Threadlight project. The updated Codex and
Claude plugins call `memory_list_projects` before enrollment, match its name and
send the returned stable `spaceId` with the request. Duplicate names or an unclear
match require a short clarification. Only names and IDs are discoverable; access
still needs human code confirmation in that project's **Chats → Requests**.
The open project cannot retarget approval. Older plugins/requests without a target
must be refreshed and recreated; they cannot silently use the open space.

## Shared browser

Version 0.4.0 adds `threadlight_browser`. Version 0.4.4 refreshes the guide for compact YouTube controls. Version 0.4.3 adds media inspection, available caption context and play/pause/seek/skip/speed actions, with paused-video discussion guidance in the existing skill. Update the local plugin and reopen or
refresh the chat’s tools. After enrolling this chat, open **Settings → Agent → Browser access**
in Threadlight and select the connection. The tool requires the connectionId
on every call. Codex, Claude and the human operate the same live page.
See the [shared browser guide](../docs/FEATURES.md#shared-browser).
