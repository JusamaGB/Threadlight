# Shared Spaces Notes and space-aware Brainstorm

Date: 2026-10-28. Status: V1 implemented in the primary checkout. Validation is recorded in
[the validation report](../validation/SHARED-SPACES-BRAINSTORM-VALIDATION.md).

## Confirmed product contract

Brainstorm is the Threadlight planning Agent for a named Shared Space, powered by the selected
Claude or Codex provider. It reads, tracks and proposes. The user explicitly chose its own
space by default, other spaces on request, and review before dispatch. These choices apply
to every space, rather than a hardcoded space titled Threadlight.

The spoken request to rename “IDs” is interpreted as **Ideas → Notes**. Stable identifiers
remain unchanged. The main hotkey Agent and Brainstorm use a shared Threadlight identity;
Brainstorm adds a narrower planning role. Provider-store isolation remains a separate unresolved
requirement: this implementation does not guarantee that hosted conversations are invisible
in provider applications.

## Experience

- The space tabs retain their existing order: Handoffs, Chats, Notes, Brainstorm.
- Notes accepts ideas, decisions, observations and constraints without model inference.
- Discuss in Brainstorm creates a separate discussion linked to a note; the note stays in Notes.
- New discussion works without any notes. Multiple saved discussions belong to one exact space.
- Discussions have separate histories, linked notes, editable plans and unsent drafts. Draft
  text, selection ranges and editor scroll are retained across navigation within the app session.
- The existing single-running-Brainstorm-turn constraint remains.
- Space context shows a bounded source catalogue, observation time, limitations and a refresh
  button. Source buttons read evidence through the same scoped service.
- Comparison checkboxes select up to three additional spaces for the next request. They clear
  after submission. The service rotates the scoped connection when the next request changes
  comparison selection; the last request's sources remain inspectable while that connection lives.
- The user saves notes/plans and prepares assignments through explicit controls. Prepared
  assignments remain unsent and require the existing Handoffs review/delivery flow.

## Domain and migration

`SpacesStore` schema version 4 adds note revision snapshots and independent discussion records.
The existing `ideas` table, wire field, `SpaceIdea` type alias and legacy stage values remain
compatibility details. New terminology and APIs use Notes and discussions.

On upgrading versions 1–3, SQLite is checkpointed and a `.before-notes` backup is retained.
The transaction preserves existing notes, IDs, content, timestamps, revisions, prepared handoffs
and conversation bindings. Each old brainstorm-stage record also creates one linked discussion
with its original conversation. Reopening the upgraded store does not repeat the migration.
Historical revisions predating this upgrade are not invented; the migration snapshots the
current saved revision, and later saves retain new revisions.

Legacy material with only a workspace association needs an explicit named-space assignment.
The UI offers that action; the service checks the expected revision, workspace and any prepared
handoff destination. It does not guess a space from the visible page. Assignment preserves the
record's identity, original time and history.

Filesystem migration deliberately performs **no moves or destructive renames**. Existing
`ideas/` folders and tracked historical paths remain valid. New snapshots go to `notes/`.
Existing external-edit and collision checks run before publishing new versions. Therefore no
cross-filesystem move journal is needed. Older binaries are not guaranteed to accept schema 4;
recovery uses the preserved database backup with the application stopped.

## Context service and membership

`src/main/spaces/context.ts` derives evidence from the authoritative Spaces, memory,
communication and native thread-reader services. It does not introduce another task/message
store. The model receives a bounded overview followed by retrieval tools; it is not given every
transcript in each prompt.

A caller's scope contains its exact discussion and primary space plus explicitly selected
comparison spaces. The server binds this scope to a random token. A model-supplied space ID
cannot expand it. Same-workspace spaces remain separate.

Native chat membership requires an existing, non-revoked, unexpired space grant that is not
limited to a single task. Provider availability still follows the existing reader. The membership
predicate is enforced in native discovery and reads, including after provider I/O. Closing the
caller invalidates its token and opaque references. Space/discussion existence and ownership
are rechecked on each call.

Previously displayed or quoted material can remain in the conversation transcript after a grant
is revoked or a comparison scope ends. Revocation prevents future retrieval; it does not erase
past messages or rebuild the model's historical context. References may become unavailable.

Sources include saved notes, saved discussion briefs/plans, memory handoffs/results/tasks,
handoff discussion messages and communication messages/questions/assignments/workflows.
They retain source identity, space, revision or content hash, source time when available,
observation time, and available author/acceptance metadata. Communication JSON preserves its
actual authors and question generations. Discussion transcripts use a separate history read.

Main-Agent conversations, unrelated provider chats, hidden reasoning and arbitrary files are
not silently included. External Markdown edits are preserved as conflicts; they are not
automatically imported as authoritative note content.

## Read tools

Both providers receive the same versioned `threadlight_space` MCP server and eight tools:

| Tool                             | Behaviour                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `threadlight_get_space_context`  | Paginated source catalogue, exact spaces, bounded participant preview, skills, revision hash and coverage |
| `threadlight_search_space`       | Case-insensitive all-word search of source titles/bodies with excerpts and pagination                     |
| `threadlight_read_space_source`  | Source body pages; exact stored note revisions; other changed revisions return conflict                   |
| `threadlight_get_space_activity` | Paged assignment/question/workflow records and participants with last observed native state               |
| `threadlight_find_threads`       | Existing native finder constrained to current enrolled membership                                         |
| `threadlight_read_thread`        | Existing normalized native status/history reader with opaque references and cursors                       |
| `threadlight_search_thread`      | Search one bounded native history page; continue the cursor for older content                             |
| `threadlight_read_discussion`    | Saved Brainstorm discussion history through the existing hosted Agent reader                              |

The loopback endpoint requires its exact Host and bearer token, rejects browser Origin headers,
bounds requests to 32 KiB and reports a read timeout after six seconds. There are no send,
answer, write, enrollment, approval or workflow operations on this endpoint. A timed-out
underlying provider read may finish later; it cannot perform a mutation.

## Runtime authority and skills

`src/shared/spaceContext.ts` is the shared versioned runtime role/skill bundle: orientation,
evidence retrieval, note-to-plan, progress review and handoff proposals. Both adapters explicitly
inject it. No assumption is made that a repository skill file is automatically loaded.

Claude uses strict exclusive MCP configuration, an empty built-in tool list and a foreground
permission allowlist. Shell, Task/worker and unrelated MCP requests are denied. Codex explicitly
disables inherited MCP servers, configures only the eight context tools and verifies their
inventory before inference. Shell, patch, image and web capabilities are disabled in its runtime
configuration, and native action approval requests are declined for this role. Source text is
untrusted evidence; it cannot change permissions or supply user approval.

The hosted Brainstorm Agent does not inherit foreground application-control or communication
write tools. Saving/discussing proposals no longer calls workflow advancement. Existing
independently enabled workflows retain their separate service and review controls.

Skills require evidence for who is doing what, distinguish assigned/running/blocked/submitted/
accepted work, and warn against treating idle as success or capability reports as verified
availability. They instruct the Agent to search older pages before asserting absence.
There is no background polling, scheduled inference, reassignment or automatic dispatch.

## Bounds and evidence navigation

The V1 catalogue is capped at 5,000 sources; exceeding it returns explicit partial coverage.
Catalogue pages contain at most 50 entries. The participant preview contains at most ten
entries and five reported capabilities each; activity pages expose the full available directory.
Source reads return at most 50,000 characters per page. Native content search scans at most
100 visible transcript items per call. Search means substring/all-word matching, not a semantic
index, and no match on one page is not a search of the entire conversation.

The initial serialized overview is bounded to 12,000 characters; larger overviews are replaced
by a compact instruction to retrieve pages. Note/plan/assignment prompt excerpts are also
bounded. Each new user turn gets a fresh overview. There is a revision hash rather than an
incremental event/change cursor or durable per-answer evidence ledger.

Notes cited as `note:<id>@<revision>` open that stored version. Context buttons also pin the
listed version. Other source references without versions open their current available value.
Thread references open a bounded history page while their caller remains active; the UI does
not yet jump to an exact older cited message or persist opaque references across restarts.
Discussion source buttons show saved material; saved conversation history and the dedicated
read-discussion tool provide transcripts. These navigation limits must not be described as
permanent, exact-passage citations.

## Acceptance and remaining work

Implemented checks cover old-store migration, same-workspace space isolation, historical note
revisions, explicit legacy assignment, preserved legacy document paths, revoked chat references,
older transcript search, actual loopback MCP handling, both adapter configurations/denials,
communication reads without sends, and isolated native UI flows. See the validation report for
commands and actual runtime outcomes.

The remaining limitations are catalogue scale beyond 5,000 records, exact persistent chat-passage
navigation, incremental indexing/change cursors, durable evidence receipts, and provider-store
isolation. Live Claude acceptance is blocked by the installed account policy. User-added skills,
automatic monitoring, concurrent Brainstorm turns and dispatch are outside V1.
