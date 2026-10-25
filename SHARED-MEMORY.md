# Shared memory

Threadlight owns a local shared-memory store. It does not edit Codex's generated
memory, Claude's auto-memory, provider databases or their global configuration.
Spaces are explicit sharing boundaries; folders organise material within a space.
The Settings entry is provisional and does not require a larger window.

## Human workflow

1. Settings → Shared memory → Open → Create memory space.
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
   and copied MCP configuration remain available as an advanced fallback.
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

## Plugin setup

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
For Codex, follow [its plugin setup](codex-plugin/README.md). Both packages include
the same shared-memory skill and MCP initialization guidance. Hook trust is separate
from memory access; the existing activity/held-card hooks are unchanged.

Ask: **“Connect this chat to Threadlight shared memory, then read its briefing.”**
The chat returns a verification code. In Threadlight, open Shared memory, select or
create a space, open Agent access, match the code and choose Review connection.
Approve only the intended folder subtree and contribution permissions. Tell the chat
it is approved; it checks that connection ID once and reads the scoped briefing.
There is no token to paste. A plugin connection's native-chat association is optional
and declared by the human; it is not authenticated by the provider.

The connection ID is public routing metadata. Every tool call must name it, so a
provider sharing one MCP process across chats does not implicitly change their target.
Private secrets stay in the bridge/app processes. Access lasts eight hours, can be
revoked in Agent access and ends when the bridge disconnects or Threadlight exits.
A crash, restart or expiry requires a fresh request and explicit human approval.
Pending requests expire after five minutes. No automatic reconnection or polling
occurs. Opening a chat in its provider does not revoke memory access.

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
The renderer treats notes as text and does not execute embedded HTML or scripts.

## Agent protocol and boundaries

The stateless Streamable HTTP MCP endpoint is `http://127.0.0.1:47618/mcp`. Every
request requires a bearer capability. Browser Origins and unexpected Hosts are
rejected; it is not exposed on network interfaces. Tokens are shown once, stored
as hashes and checked for revocation on each operation. Local applications running
as the same OS user remain inside the machine's trust boundary.

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

Claude receives an invocation-only HTTP MCP configuration and allowance for these
scoped memory tools. Codex receives invocation-only MCP URL/auth and `approve` tool
configuration for this server. Tokens travel in the child environment, not command
arguments or task prompts. Other provider settings and tool permissions are retained.
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
