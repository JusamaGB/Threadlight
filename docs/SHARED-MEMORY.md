# Shared Spaces: collaboration and handoffs

**Settings → Shared Spaces → Add to .gitignore** enables a per-space checkbox in
the creation form. Both the setting and each new space's checkbox default off.
Checking it appends `/shared-spaces/<space-folder>/` to the chosen workspace's
`.gitignore`, creating the file if needed, including before Git is initialized.
It does not ignore sibling spaces, change existing rules, untrack committed files
or apply to existing spaces. Disabling the setting removes no ignore rules.
If the ignore write fails after space creation, the form keeps the request for
retry; fix the reported file problem and retry to finish the same space.

Reusable processes now share a versioned graph between agent tools and the Workflow
editor. Individual durable runs appear in Handoffs, with separate evidence and
acceptance states. See [workflows](WORKFLOWS.md) for exact-version authorization,
supported steps/triggers, compatibility and recovery. Existing roles and assignment
policy remain authoritative; creating a graph never grants execution.

Threadlight connects work across Claude and Codex through explicit shared context,
decisions, assignments and handoffs. Provider-native memory remains with each provider.
Spaces are sharing boundaries; folders organise material that collaborators need.
The `memory_*` tool names, plugin identifiers and existing storage paths are retained
for compatibility. Hooks report activity; scoped tools and supported relays carry
context and assignments. Discussion entries do not imply live delivery to another chat.

Hosted Brainstorm uses a separate project-scoped tool server for both providers.
It can save/revise requested notes with authenticated saver attribution, draft
workflows, and invoke only human-authorized revisions under automatic project
policy. Comparison projects stay read-only. See the
[Brainstorm operating guide](BRAINSTORM-OPERATING-GUIDE.md) for tool usage, retry
rules, capability limitations and the distinction from external plugin access.

Shared Spaces opens a project on Brainstorm, using the ordinary Threadlight
`AgentView` conversation UI. Enter sends; End starts a fresh discussion; Earlier
and Continue read and resume saved discussions. The first message creates a
discussion. Opening the page or its history starts no inference. The last project,
discussion and separate drafts are remembered locally; the session also retains
cursor positions. Creation retries reuse the same discussion ID. Project details,
sources and planning controls remain below the shared conversation.

Notes use the shared compact composer with dictation, Enter to save and Shift+Enter
for a new line. A failed save keeps the draft. Notes are saved locally without inference.
New notes use the first sentence as their initial title, within the existing
80-character title limit, retaining the entire body. List titles use a single-line
gradient fade; opening a note shows its full title and text. Right-click a list
note (or press Shift+F10 while focused) for **Rename** or **Discuss**. Rename keeps
the body and checks the record revision; Escape cancels it.
**Discuss in Brainstorm** links a note
to a discussion. Discussion details, plans and assignments remain available in
expandable sections. Sending starts or resumes that discussion's
Agent conversation; existing discussions retain their original provider/model.
The ordinary Agent conversation is separate. Only one Brainstorm turn runs at a time.

**Ctrl+Alt+B** opens Brainstorm in the current or last available project and
toggles its open microphone. If no project can be chosen safely, the library asks
the user to open one. The shortcut uses the selected voice mode independently of
the general talk shortcut's destination or hold setting: local STT sends completed
sentences to the discussion; GPT Live uses native Codex audio from the first turn.
GPT Live retains the existing Codex sign-in/provider requirement. A new native
voice session reads only the chosen project and creates its discussion on the
first completed human transcript. Empty or cancelled mic sessions create no
discussion. Follow-ups use that discussion and its scoped evidence tools.
Both shortcuts enter the same talk IPC and the same Panel voice controller.
Brainstorm supplies a project-bound Agent client to the existing recording and
native-audio paths; it has no separate voice hook or view-settings startup gate.
The composer shortcut, keyboard shortcut and floating indicator stop the mic.
Voice settings changes close it as they do for the ordinary Agent. Each destination
keeps its own backend conversation; only one microphone owner is active.

Review the mini plan, add assignments and choose exact Claude/Codex chats and a shared
output folder. Preparation pins the plan and saves unsent tasks atomically. Retries
reuse operation IDs. Review and authorise individual tasks in Handoffs; dependency
ordering is manual in this first version. Prepared plans are frozen. Capture a new
idea for a revised plan. Automatic decomposition, workflow profiles, new worker creation
and automatic dependent handoffs remain in the coordination roadmap.

## Workspace setup and document mapping

Before the tabs open, select a workspace and choose **Create Shared Spaces**. In
the setup screen, the page sizes to its content. The drive selector next to
**Workspace** filters project folders already known to Threadlight; **All drives**
shows them together. It does not scan arbitrary folders or create anything until
**Create Shared Spaces** is selected. The copy explains the project context and
document destination before setup. In
Workspace view the selection follows the thread view, with no second workspace picker.
Other views require an explicit workspace selection. The document location is always
`<workspace>/shared-spaces/`, containing `ideas/`, `plans/`, `handoffs/` and `results/`.
There is no folder override. Setup is repeatable and preserves existing files.

Each registered workspace has a stable UUID and a canonical filesystem root. Ideas,
discussion links, shared spaces and tasks retain that ownership across view changes
and restarts. Only chats in the same workspace can receive assignments. Setup, mapping
and document checks run before brainstorming, preparation, authorization and dispatch,
including direct tool calls. Missing or redirected directories block work; restore the
original directories or retry setup. No substitute directory is chosen automatically.

Documents are readable, immutable Markdown snapshots named with a stable document ID
and a content hash. Renaming an idea does not change its ID; editing it creates another
snapshot. The registry tracks the latest file and brainstorm prompts name the current
idea/plan files. Earlier snapshots remain historical. Handoffs include shared notes,
task briefs and discussions; results include provider replies and saved task outputs.
Attachments remain managed by Threadlight, with a reference in the Markdown snapshot.

Existing user files are never overwritten. If a tracked snapshot is edited externally,
the save is rejected and the file path is shown. Preserve that edit separately, restore
the tracked snapshot, then copy the changes into the app to publish a new version.
External Markdown edits are not automatically imported. A failed multi-file write can
leave harmless snapshots on disk; retry reuses identical content without overwriting it.

Older ideas and shared material remain **Unassigned**. Use **Assign existing material**
to select a configured workspace and the records to move. **Preview migration** shows
destination files and conflicts; **Confirm migration** checks that preview again before
writing. Existing IDs, revisions, permissions and conversation links are retained.
Prepared ideas must include their associated shared material. Running brainstorms,
queued tasks and uncertain deliveries must be stopped or resolved first. Existing
workspace-owned material cannot silently be reassigned.

Private application data remains separate: ideas, workspace bindings and document heads
live in the app-data `shared-spaces/ideas.sqlite`; brainstorm metadata lives in app-data
`shared-spaces/conversations.json`. Handoffs retain app-data `shared-memory/memory.sqlite`.
The previous Ideas database is backed up before its workspace schema upgrade.
Export/restore in Handoffs covers shared material and assignments across **all** workspaces,
not workspace bindings, the Ideas board, provider histories or the workspace document
directories. Back up those separately. Restored material without a known ownership
mapping remains Unassigned until explicitly migrated.

## Human workflow

1. Shared Spaces (the brain icon in the panel header) → choose workspace → Create Shared Spaces → Handoffs.
2. Create folders with descriptions. Choose Map or List; open a folder to publish a
   note, decision draft, scratchpad, reference or managed attachment.
3. Open an item to inspect versions, author/source, discuss it, accept a version or
   request review. Edits retain their starting revision and fail on a concurrent change.
   An accepted version remains accepted when someone proposes a newer version.
4. Install the provider plugin and ask the chat to connect to Threadlight memory.
   Match its verification code in Agent access → Review connection; select scope,
   permissions and optionally the enrolled native chat. Read-only is the default.
   Folder creation and automatic follow-up delegation are separate permissions.
   Background assignments receive temporary tools automatically. Manual enrollment
   and copied stdio MCP configuration remain available as an advanced fallback;
   that configuration must be regenerated after restarting Threadlight.
5. Delegate: choose recipient, exact input versions, objective/acceptance criteria and
   output folder. Authorise the draft, then permit dispatch under Coordination.
6. Review the submitted output versions and Accept result. A provider saying it has
   finished is not enough to resolve a task without saved output.

Folders have stable UUIDs. `ensure_folder` reuses an existing sibling after NFKC,
whitespace and case normalisation. Names cannot be paths. Limits are six levels,
2,000 folders per space and 20 agent-created folders per capability label/minute.
Only the human can rename, move, merge or archive folders. Moves/merges require
revoking active subtree grants first so they cannot silently broaden access.
Output-folder changes block unsent assignments and mark in-flight outcomes uncertain.

New folders update quietly in place. The compact map shows six at a level, then More;
List shows the rest. Drafts are stored by item/task/form destination. Native thread
composer drafts and provider toggles retain their existing behaviour.

## Project participants and capability reports

A Shared Space is a project area. After creating it and connecting chats, open
**Chats** to see participants, connection status and capability reports. Each
platform keeps its own tools, skills and plugins; the project gives Brainstorm
context for suggesting which native chat should do a task.

Ask a connected chat with project-wide publishing access to use
`memory_report_capabilities` to report its actual tools, skills, plugins and roles.
You can also record a separate manual report. Reports are timestamped claims.
Use **Record verification** to record what you tested or inspected; only the
human can add this evidence. New reports start unverified. Reports over seven
days old are flagged for rechecking. No credentials or private configuration
should be included in a report.

Brainstorm receives its project's current participant directory each turn.
Assignment drafts offer **Suggested chats**, with matching capabilities and
rationale. Selecting one changes the draft. Save the plan, prepare assignments
and review them in Handoffs before authorizing dispatch. Capability reports do
not grant permissions or establish that a native destination can currently send.
Reload updated provider plugin tools to make the reporting tool available.

See [the participant specification](specs/PROJECT-PARTICIPANTS-SPEC.md).

## Plugin setup

The [source setup skill](../skills/setup/SKILL.md) can install Threadlight and both
coding plugins with `node scripts/install.mjs --providers claude,codex` from the
checkout. After installation, review hook trust, open a new provider chat and
approve its connection to the intended space. For plugin-only setup, use the
commands below.

Use Node 22.16+ on PATH and a Threadlight build that includes the memory bridge.
Install the plugin for each application you use. These commands are explicit setup
steps; Threadlight does not run them or edit global provider settings on your behalf.
From the repository folder, install Claude's local plugin:

```powershell
claude plugin marketplace add .
claude plugin install threadlight@threadlight
```

For an existing Claude installation, update the local marketplace then run
`claude plugin update threadlight@threadlight`. Reopen the provider conversation or
reconnect its tools so the updated MCP server and skill are loaded.
For Codex, follow [its plugin setup](../codex-plugin/README.md). Both packages include
the same shared-memory skill and MCP initialization guidance. Hook trust is separate
from memory access. Refresh the app and both plugin packages together: hooks and
memory connections require authenticated transport, with no plaintext fallback.

Ask: **“Connect this chat to Threadlight shared memory, then read its briefing.”**
The chat returns a verification code. In Threadlight, open the project → Chats and
select its request under **Requests (count)**. Waiting requests appear automatically;
otherwise the tab shows connected chats or a short empty state. The request carries the project selected from pre-enrollment discovery; only that
project can approve it. Match the code and approve access to read the space's notes
and files and publish shared notes. Publishing is included in this approval;
there are no publishing or decision-card setup checkboxes. Approval returns to
Chats, and the header back control leaves a request without approving it.
When the request supplies its native `chatId`, the available provider chat
is shown directly. Older requests offer a searchable list across working folders.
If no chat is available, open it in its provider with monitoring enabled and return.
Existing workflow settings are preserved. Advanced read-only and folder-scoped grants remain
available under Agent access. An updated chat with a native ID can call
`memory_wait_for_approval` after showing the code. Each call waits up to 50 seconds
and can be repeated while the same five-minute request remains pending. Approval
returns to the original tool caller, with one continuation signal per connection;
the chat checks that same connection ID and reads the scoped briefing. The grant
must be bound to that exact native ID. A lost response is recoverable through
status; it does not authorize a duplicate continuation. This is an active-call
fallback, not an unsolicited notification: idle/closed chats and older requests
still need the human to tell them to check. No workflow permission is required.
There is no token to paste. A plugin connection's native-chat association is optional
and declared by the human; it is not authenticated by the provider.

The connection ID is public routing metadata. Every tool call must name it, so a
provider sharing one MCP process across chats does not implicitly change their target.
Approved project/chat links persist until explicitly disconnected or revoked. The app
stores a hash of the pairing secret; the plugin keeps its credential in the private
account-scoped memory-auth directory, never in workspace documents or tool results.
A current bridge can restore the same native-chat/project pairing after restart.
A missing, changed or revoked pairing needs fresh approval; legacy transient grants
are not automatically promoted. The separate server key is read from a
Windows-protected bootstrap file. Restart the bridge when that key changes.
Pending requests expire after five minutes. Resuming an approved link does not
wake idle chats or send them messages. Opening a chat does not revoke its access.

An installed plugin teaches the workflow but does not force a model to use it or
make every existing chat aware of new tools instantly. Invoke the shared-memory skill
when needed. During work, agents read exact input versions, publish attributed
findings, check changes at task boundaries and submit saved outputs for human review.
These are shared records, not automatic synchronization of private chat histories.

If tools are missing, check plugin/MCP enablement and Node availability, then reconnect
the provider's tools. If the app is offline, start Threadlight. If access was revoked,
do not re-request until the human directs it. Keep unsaved output in the current chat;
never claim it was shared. The service does not bypass native provider permissions.

## Storage, retrieval and attachments

The authoritative database is `shared-memory/memory.sqlite` under Electron's
`userData` directory. SQLite WAL and `BEGIN IMMEDIATE` serialize mutations. Immutable
revisions include hashes and provenance; optimistic revision checks prevent lost
updates. Mutating tools require operation UUIDs. Reusing an ID with different input
fails; a matching retry does not duplicate work. Purged receipts become tombstones.

Search returns authorised folders, text items, tasks and task discussions. It is
literal search, without embeddings or generated summaries. Tasks pin input and output
versions. A changed/missing input is visible and blocks an unsent assignment.

Attachments are managed copies inside the database, up to 10 MiB each: PNG, JPEG,
WebP, PDF, UTF-8 text and Markdown. Native file import uses a file picker; agent import
accepts base64 bytes, never an arbitrary local path. Image responses include original
image blocks, PDFs are embedded MCP resources and text is returned as text. Client
support for displaying a PDF resource varies; no OCR or PDF-text extraction is claimed.
Small UTF-8 Python, JavaScript and TypeScript attachments support [Brainstorm file review](BRAINSTORM-OPERATING-GUIDE.md#explain-a-shared-file). Their managed copies retain the original bytes and are excluded from workspace Markdown publication.
The renderer treats notes as text and does not execute embedded HTML or scripts.

## Agent protocol and boundaries

Both plugins expose stdio MCP to their provider. Their local connection to Threadlight
uses authenticated encryption at `http://127.0.0.1:47618/secure-memory`; enrollment,
capabilities, runtime credentials and memory contents are encrypted, and replies
must prove possession of the protected server key. Plain HTTP MCP/bearer clients
are no longer accepted. Browser requests and unexpected Hosts are rejected.
Capabilities remain scoped, stored as hashes and checked for revocation before
execution. Same-account hostile code is outside this boundary; see
[local IPC security](security/LOCAL-IPC.md).

Tools: briefing, snapshot, read, search, changes, ensure_folder, create_item, revise_item,
import_attachment, create_task, submit_result and post_message, prefixed `memory_`.
Plugin bridges additionally expose memory_connect and memory_disconnect; these do not grant access.
Their schemas declare required arguments. Changes include a cursor and a resnapshot
signal if the bounded event window no longer covers the caller. Metadata, content,
search results and counts are filtered by scope before they leave the store.

An enrollment label/recipient is a declared identity, not proof that the caller is
that particular native chat. Task-launch credentials are additionally bound to the
assignment, inherit the enrolled scope, restrict writes to its output subtree and
expire after 35 minutes. Revoking the parent revokes its temporary credentials too.
No tool exposes human acceptance, grant administration, restore or destructive purge.

Claude and Codex receive invocation-only stdio MCP configurations with the same
scoped tools and provider approval policy as before. The proxy authenticates the
Threadlight server; credentials stay in protected files removed when the caller
closes, outside command arguments and task prompts. Manual enrollment uses the same
proxy; its displayed configuration works only until Threadlight restarts. Restart
and reconnect updated plugins together, then request fresh human-approved pairing.
Other provider settings and tool permissions are retained.
Provider-native permissions still govern filesystem/other work during a delegated turn.

## Coordination and recovery

- Manual: explicit task authorization. Assisted: change subscriptions prepare drafts
  for review. Automatic: explicitly permitted agent follow-ups and human-created
  subscriptions can queue work inside their authorised scope.
- Defaults: ten dispatches, a 30-minute window, two occupied destinations globally,
  and one writer per destination shared with normal composer sends. Unknown outcomes
  retain a slot until reviewed. Counters survive restart; new windows require human action.
- A chain cannot revisit a recipient and stops after four predecessor tasks. Equivalent
  active assignments are rejected. Unsent updates to the same subscribed item coalesce.
  An agent's own publication does not notify itself; discussion does not wake a chat.
- Live/busy chats wait. Disabled providers and unavailable enrollment block dispatch.
  The final relay rechecks native writer ownership. Provider receipts are correlated
  with assignment IDs rather than inferring acknowledgement from file activity.
- On restart queued tasks pause; interrupted dispatches become outcome unknown.
  Unknown sends are never automatically retried. Open the native chat, inspect it,
  then Record native-chat outcome. Discarding the assignment does not stop a running
  native turn; stop that in its provider. A fresh assignment is a separate reviewed action.
- Completion of a provider turn and submission/acceptance of saved outputs are separate.
  Submitting early retains the delivery slot; native receipts are persisted immediately
  before a later composer send can replace the provider's displayed status. Restarting
  with a submitted result and an unfinished delivery still requires native-chat review.
  Closed tasks do not reopen when a late result arrives; the agent can record a late
  discussion message. Pausing coordination does not interrupt already running work.

## Backup, restore and deletion

Export backup uses SQLite's online backup API and includes corresponding blobs.
Restore validates the backup and hashes, creates a recovery backup first, then replaces
the store in one transaction. Failed validation leaves the current store intact.
Restoring revokes all capabilities and pauses coordination; reconnect participants
explicitly. Restore is blocked while an assignment is running or its delivery is uncertain.

Archive hides material without erasing history. Purge removes the item's versions,
managed blobs, item discussion and related drafts; retry receipts become tombstones.
Task references become visibly unavailable. Exported/recovery backups and copies
already sent to native provider transcripts are separate copies and remain outside
this deletion. No claim of forensic erasure of previously written storage is made.

## Verification

`test/memoryPlugins.test.ts` exercises both actual packaged stdio bridges, explicit
connection IDs, approval, wrong secrets, scope isolation, conflicts, expiry, restart,
restore and revocation. Plugin asset drift is checked before lint/tests. The UI smoke
suite tests a real pending request → read-only approval → connected → revoke flow
using synthetic IPC in the compact panel.

`test/live/memory-plugins.proof.mjs` is an explicit opt-in proof
(`THREADLIGHT_MEMORY_LIVE=1`). On 2026-10-25, fresh Claude and Codex chats both read
a scoped briefing and pinned input, created a permitted folder and saved a verified
note. Claude loaded the native plugin via --plugin-dir. Codex used the packaged bridge
through invocation-only MCP configuration; native Codex marketplace installation,
skill discovery and tool discovery were verified separately in an isolated CODEX_HOME.
No installed user plugins, global provider settings or existing chats were changed.

`test/memory.test.ts` covers authority, scopes, stale writes, idempotency, reorganisation,
restore rollback, subscriptions, budgets, delivery correlation and uncertain outcomes.
`test/ui/memory.smoke.mjs`, called by the provider UI smoke suite, uses the real store
with synthetic IPC and checks the compact map, navigation, saved drafts, conflicting
edits, tasks, short panels and absence of accidental sends.

Explicit opt-in real-client proofs are `test/live/memory.proof.mjs` and
`test/live/memory-delegation.proof.mjs` (`THREADLIGHT_MEMORY_LIVE=1`). They use isolated
test stores and fresh disposable chats only. On 2026-10-25 both installed clients
passed exact-version read → folder creation → attributed publication → fresh-chat
recall. Both also passed saved input → background resume → result submission → human
acceptance through the actual relay implementations. Test tokens are not logged.

The shared-engine/live-desktop messaging upgrade remains separate. This implementation
does not claim that live chats can safely receive background resume writes. Semantic
retrieval, generated summaries, OCR and native-memory imports remain optional later work.

Protocol references: [MCP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp),
[Claude Code MCP configuration](https://code.claude.com/docs/en/mcp).

### Save notes by purpose

Both Codex and Claude plugins accept `purpose: note | work_context | result`.
User-requested notes and ideas appear in the project's Notes and `notes/`, with
server-recorded saver, source chat and time. Notes edits use the same memory item
and revision history; discussing a note links it without copying. Checkpoints use
Handoffs/`handoffs/`; deliverables use `results/` and separate submission/acceptance.
Explicit-purpose saves never create assignments or send messages. Existing access
scopes still apply. Old callers omitting purpose and historical records retain
legacy routing; no author/keyword migration occurs. See
[the purpose contract](specs/NOTE-PURPOSE-SPEC.md) for compatibility details.
Activation requires the rebuilt app plus refreshing/reconnecting each installed
provider plugin; rebuilding alone does not replace an installed plugin cache.

## Project discovery before enrollment (29 October 2026)

Both packaged providers now expose `memory_list_projects` before chat enrollment
through the existing authenticated local transport. It returns only eligible
Threadlight Shared Space `{id, name}` identities. Eligibility uses the same
registered workspace/space location checks as Shared Spaces; unassigned legacy
spaces and unavailable locations are omitted. Workflow pause/budget controls govern
dispatch, not whether a human can connect a chat.

The chat matches the project named by the user and sends `memory_connect` its
stable `spaceId`, label and native `chatId` when known. Duplicate names, no match or
ambiguous intent need a short clarification using names/IDs. Names are untrusted
data; foreground state, chat title, filesystem paths and Codex project IDs never
choose the destination. Supported project-launched callers may carry an already
known Shared Space ID; this adds no launch or automatic enrollment mechanism.

Requests bind the destination immutably. Chats → Requests shows only requests for
that project. Review displays the requested project without a second project
picker. The backend rejects a different project or a different supplied native
chat, even if renderer inputs change. Human code matching and approval remain
required. Status and approval-wait responses carry the same space ID and current
name; rename preserves identity, while deleted/unavailable targets fail closed.
Discovery never returns notes, filenames, paths, assignments, credentials or briefs.
Post-approval access remains limited by the granted project/folder permissions.

Compatibility: older clients without `spaceId` receive an actionable error and
must update, discover and request afresh. Destinationless pending requests cannot
be approved or silently retargeted. Requests are process-local and app restart
expires them and revokes their ephemeral grants. A missing native chat ID still
allows explicit human chat selection; a supplied native ID cannot be substituted.
Changing destination requires a new request, not a retry of an existing ID.

This supersedes earlier guidance that approval uses whichever project is open.
The primary checkout implementation is not an installed-plugin reload or release.

## Visual Handoffs

The objective canvas is a read-only projection of saved tasks and assignments.
Prepared discussions group only their explicit `prepared.taskIds`; workflow
assignment proposals may include `objective: { id, title }` as a project-local
association. It grants no authority and does not change dependencies or scheduling.
Old records remain valid under Ungrouped. Solid arrows lead from an explicitly
required assignment to the dependent assignment; dashed arrows lead from an
origin task to its delegated task. Neither folders nor matching titles imply edges.

Node details retain exact input/output revisions and existing authorization,
reconciliation and review actions. A submitted result is not accepted completion;
a finished native turn is not accepted output. Navigation starts no agent and sends
no message. Folders, archived material, policy and access controls remain in
**Folders & controls**. Project messages remain in their collapsible section.
See [canvas spec](specs/HANDOFFS-CANVAS-SPEC.md) and
[isolated validation](validation/HANDOFFS-CANVAS-2026-10-29.md).
