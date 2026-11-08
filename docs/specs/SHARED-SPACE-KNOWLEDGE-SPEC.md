# Shared Space knowledge structure and agent contract

Date: 2026-10-29. Status: proposed implementation specification.
Branch: `workflow-tab-followup`. No runtime or migration changes are implemented by this document.

## Outcome

Creating a Shared Space produces a useful, described folder structure immediately.
Notes, Claude and Codex participants, Brainstorm, and the ordinary Threadlight Agent
see the same authorised folders, documents, revisions and relationships. A document
saved through one surface is immediately discoverable through the others. The user
can develop an idea in Brainstorm, save research, record a decision, prepare a plan,
send authorised work, and review its result without copying content between stores.

The project tabs have distinct responsibilities:

| Tab        | Responsibility                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Notes      | Browse, search, create and maintain the project's saved knowledge and files.                         |
| Brainstorm | Develop ideas using that knowledge and connected conversations; save useful material when requested. |
| Workflow   | Configure participants' roles, coordination, review and execution rules.                             |
| Handoffs   | Operate assignments, messages, dependencies, dispatch and result review.                             |
| Chats      | Manage membership, connection readiness and effective access.                                        |

This spec completes knowledge organisation and agent access to it. Conversational
chat enrollment remains covered by `PROJECT-CHAT-ENROLLMENT-SPEC.md`. Workflow
execution continues to use the existing assignment and communication services.

## Current implementation and gaps

- `src/main/spaces/service.ts` creates shared-memory folders Plans, Handoffs and
  Results. Their descriptions currently only name the folder and project.
- `src/main/spaces/documents.ts` creates notes, plans, handoffs and results on disk.
  Its `memoryDocuments` projection sends shared items to handoffs unless they are
  registered task outputs; it does not reproduce their shared-memory folder tree.
- Notes and discussions are `SpaceIdea` records in the Spaces store. Shared items
  and revisions live in the memory store. Plans are also embedded in idea records.
- `MemoryItem` already provides stable identity, revisions, an accepted revision
  and folder membership. Keep this machinery and extend it.
- The external Claude skill at `skills/shared-memory/SKILL.md` is the canonical
  source for the packaged Codex copy. It teaches discovery and publishing, but no
  standard folder taxonomy. Installed plugin caches may lag repository packages.
- Brainstorm's common instructions in `src/shared/spaceContext.ts` are used by both
  provider runners. Its current tools read project context and transcripts; they
  cannot save knowledge. Its overview does not expose a complete folder contract.

## Standard folder structure

Notes opens with a project overview and the following folders. Every folder has a
stable ID, a stable semantic role, a description and allowed operations. Titles are
display labels, never identifiers. Folder order is the order below.

| Folder / role           | Purpose and content                                                                                      | Filing rule                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Overview / `overview`   | Project brief, desired outcome, scope, constraints, vocabulary and links to current decisions and plans. | Create a starter Project brief marked draft with empty fields; never invent project facts.           |
| Inbox / `inbox`         | Quick captures, imported notes awaiting classification, and material whose destination is uncertain.     | Default for an unclassified quick note. Agents explain uncertainty rather than inventing a category. |
| Research / `research`   | Findings, experiments, comparisons and investigations, with sources and limitations.                     | Separate observations, source claims and the author's conclusions.                                   |
| Ideas / `ideas`         | Possibilities, alternatives and open questions.                                                          | Ideas remain proposals until an explicit decision records the outcome.                               |
| Decisions / `decisions` | Decisions proposed or adopted, including rationale, alternatives and affected work.                      | Show proposal and accepted revision separately; saving never accepts.                                |
| Plans / `plans`         | Objectives, scope, steps, dependencies, acceptance criteria and proposed assignments.                    | Link to the decisions and evidence used; changed sources mark the plan for review.                   |
| Resources / `resources` | Reference documents, links, images, reusable assets and supporting files.                                | Preserve provenance and managed attachment identity; reference rather than duplicate.                |
| Results / `results`     | Delivered work, validation evidence, review findings and accepted outcomes.                              | Record originating assignment where applicable. Submitted and accepted remain distinct.              |
| Handoffs / `handoffs`   | Saved briefs and references to operational assignments and their pinned inputs.                          | Briefs may be edited as drafts; assignment state is controlled by the Handoffs service.              |

The Overview and Inbox solve two different needs: orientation and quick capture.
Resources contains source material; Research contains findings derived from it.
Folder role is the default filing guide, while document category remains explicit.
A plan stored in a custom topic folder is still a plan.

Do not precreate empty topic subfolders. Users and authorised agents may add them
under any root using a description and reason. Preserve the existing maximum
hierarchy depth of six folders including the root. Root roles cannot be deleted,
merged or reassigned by agents. Human display-name changes retain the role and ID.
Custom folders may be renamed or archived with existing conflict and access checks.

Archive is a filtered view, not a physical destination folder. Archiving preserves
IDs, revisions, pinned references and original folder membership. Relationships
cross folder boundaries, so moving an idea into Plans is not the way to approve it:
create and link the resulting plan while preserving the original idea.

## One content model

Use the memory store's versioned item model as the authoritative knowledge store.
Keep Spaces for discussion history, UI drafts, project locations and navigation.
Replace persisted note bodies and embedded plan bodies in `SpaceIdea` with item
references after migration. A compatibility adapter serves old callers until they
are converted; it must not permit competing writes to the old body and new item.

Extend, rather than replace, the current model:

| Field              | Contract                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder role        | Optional enum for standard roots; exactly one active root per role per space. Custom descendants have no root role.                                                           |
| Structure version  | Version of the space taxonomy and its migration state. Independent of provider or plugin version.                                                                             |
| Category           | `overview`, `note`, `research`, `idea`, `decision`, `plan`, `resource`, `result`, `handoff`; separate from text/image/document media kind.                                    |
| Content revision   | Immutable title, body, category, attribution, source references, attachment references and content relationships. Existing bodies remain readable at their original revision. |
| Placement revision | Optimistic concurrency version for folder placement and archive metadata, so moves cannot silently overwrite each other.                                                      |
| Acceptance         | Existing `acceptedRevision`, plus accepting actor, time and evidence. Acceptance never silently advances when a new draft is saved.                                           |
| Relationships      | Typed links such as derived-from, supports, supersedes, implements, output-of and discussed-in. Pin item revisions when they form a decision, plan or assignment's evidence.  |
| Provenance         | Human/agent identity, provider where relevant, originating chat/discussion, operation ID and timestamp. Never store hidden reasoning or credentials.                          |

Use current item revision for content edits and placement revision for moves.
The storage transaction must validate both when an operation changes both. Preserve
current acceptance semantics and exact assignment input versions. Display a newer
draft alongside the accepted revision instead of implying that the draft is approved.

Discussions are conversations, not automatically saved knowledge. Linking a note to
a discussion does not convert or delete it. A user request such as “save that finding”
creates an item with a discussion reference; subsequent discussion remains separate.
An extracted plan is a linked plan item. Operational assignments, workflow settings
and messages retain their own services and IDs; Notes shows linked views of them.
Never maintain editable copies of an assignment's status in a Markdown note.

## Files and storage

Keep the database authoritative for revision history, access, relationships and
operational state. Workspace files are a readable, regenerable projection with
an explicit import path for external edits. They are not a second writable store.

```text
<workspace>/shared-spaces/<space-slug>/
  space.json
  README.md
  overview/
  inbox/
  research/
  ideas/
  decisions/
  plans/
  resources/
  results/
  handoffs/
  .threadlight/
    manifest.json
    history/<item-id>/r<revision>.md
```

Each visible item has a current snapshot named `<readable-slug>--<full-item-id>.md`
inside its folder. Custom folder paths include their stable folder ID. Root paths
use the semantic role and do not change when a display title changes. The manifest
maps IDs, placements, current and accepted revisions, hashes and projection version.
Binary originals remain in managed blob storage; Markdown records link attachments
by managed identity. A separate explicit portable export may include originals.

New database writes append a projection job in the same transaction. A durable
worker writes files atomically, then acknowledges the projected revision. On failure,
the save receipt says “saved; file sync pending”; retries resume after restart. The
UI and tools expose this state and never claim a disk write succeeded prematurely.
Projection jobs use current placement and monotonic revisions so stale jobs cannot
restore an old path or overwrite newer content. Existing unmanaged files are never
overwritten. Changed generated files are flagged for compare/import; import creates
a proposed new revision. External edits cannot approve content or change grants.

Retain existing path containment, real-folder and symlink checks. Keep old immutable
snapshots and their reference mappings available after migration. Remove an obsolete
current projection only after its hash matches the recorded generated content and
the new path is durable; otherwise report a conflict. History remains intact.

File projection is a local workspace feature, not a per-agent permission boundary.
An agent's memory grant does not give it filesystem access. Restricted external
participants use tools; exports must not be sent to them as a shortcut around grants.

## Notes experience

Notes becomes the folder browser for all authorised saved knowledge. It uses one
tree/list navigation pattern with breadcrumbs, folder descriptions, item counts,
search and a document detail view. Keep the compact panel layout; entering a folder
replaces the list rather than adding a permanent wide sidebar.

- Landing view: Project brief link, standard folders, recent changes and Inbox count.
- Folder view: child folders and items with category, author, update time and
  draft/accepted/newer-draft indicators. Empty folders explain what belongs there.
- Quick capture: defaults to Inbox, or the selected folder when created inside it.
- Detail view: body/attachment preview, sources, linked discussion, version history,
  accepted revision and relationships. “Discuss in Brainstorm” uses the same item.
- Search: across permitted current content with folder, category and status filters;
  historical search is explicit. Search receipts state scope and coverage.
- Handoff references open the corresponding operational card in Handoffs. Result
  documents remain in Notes and are referenced from that card. Workflow stays in its tab.
- Loading, missing access, unavailable content and an empty folder are distinct states.
  A restricted caller must not learn hidden folder names, counts or links.

A Notes save, external `memory_create_item`, and Brainstorm save must all update the
same event stream. Every relevant surface refreshes from that stream, preserving
unsaved editor drafts and presenting revision conflicts rather than overwriting.

## Shared tool contract

Implement one knowledge service behind the human UI, external memory MCP tools and
Threadlight's project tools. These are adapters with different authenticated actors,
not separate storage implementations. The server resolves permissions on every call.

Extend the existing external tools compatibly:

| Capability          | External API                                               | Threadlight project API                                                  |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Orientation         | Extend `memory_briefing`                                   | Extend `threadlight_get_space_context`                                   |
| Folder/item listing | Add paginated `memory_list_folder`                         | Add `threadlight_list_space_folder`                                      |
| Search              | Extend `memory_search` with category/status/folder filters | Extend `threadlight_search_space` identically                            |
| Exact read          | Extend `memory_read` metadata                              | Extend `threadlight_read_space_source`                                   |
| Create/reuse folder | Existing `memory_ensure_folder`                            | Add `threadlight_ensure_space_folder`                                    |
| Create/revise item  | Existing `memory_create_item`, `memory_revise_item`        | Add `threadlight_create_space_item`, `threadlight_revise_space_item`     |
| Move/archive item   | Add `memory_move_item`, `memory_archive_item`              | Matching `threadlight_move_space_item`, `threadlight_archive_space_item` |
| Attachment import   | Existing `memory_import_attachment`                        | Add managed-attachment import using the existing attachment path         |
| Changes             | Existing `memory_changes`                                  | Add `threadlight_get_space_changes`                                      |

New names above are proposed, not currently available. Keep existing valid payloads
working through defaults; advertise the new contract version and capability flags.
Create/revise accepts category, provenance and typed references. Do not overload the
existing media `kind` enum with folder meanings. Moves validate source and destination
permissions and placement revision. Archive supports restoration within the same
permission model. Folder operations reuse existing human UI paths; do not add general
agent rename/merge/delete powers as part of this change.

Every orientation response includes space identity, structure/contract versions,
authorised root IDs and roles, folder purposes, allowed operations, relevant accepted
decisions, current plans, pending drafts and a change cursor. Return bounded metadata
with pagination and coverage; the agent reads actual item revisions separately.
The ordinary Threadlight Agent must explicitly resolve a requested space. Brainstorm
uses its bound discussion space. Changing the visible page never changes that binding.
Comparison spaces are read-only unless separately authorised as a write target.

Mutations require an operation UUID and return item/folder ID, revision, author,
placement, acceptance state and projection state. Repeated identical operation IDs
return the same outcome; changed payloads with the same ID fail. Conflicts return
current metadata and a recoverable reason. Unknown outcomes are reconciled by
operation ID before retrying. Implement typed errors for not found, access denied,
conflict, invalid destination, unsupported contract and unavailable storage.

## Agent behaviour and authority

External Claude and Codex use the same canonical shared-memory skill and runtime
contract. Both Threadlight provider runners and typed, STT and native Live paths use
the same project instructions and knowledge service. Do not create separate voice
behaviour or a second Brainstorm conversation interface.

Replace Brainstorm's blanket “read, track and propose only” instruction with scoped
knowledge editing. A direct request to save, revise, file or organise content can be
fulfilled within the caller's effective write permissions without a second approval.
Ordinary brainstorming does not automatically publish every response. Creating or
editing a proposal does not accept it, submit it as a result or dispatch work.

| Caller                     | Knowledge behaviour                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human UI                   | Uses the human's project access and existing acceptance controls.                                                                                               |
| External participant       | Reads/writes only under its connection's live grants; folder creation remains a separate permission.                                                            |
| Task-scoped worker         | Reads pinned inputs and writes only to its approved output destination. No implicit write access to all Results.                                                |
| Brainstorm                 | Reads its bound space; writes requested knowledge through a host-bound project actor with explicit effective capabilities. No unrestricted human impersonation. |
| Ordinary Threadlight Agent | Resolves an explicit project and uses its granted capabilities. Cross-project ambiguity requires clarification.                                                 |

Introduce explicit capabilities for knowledge create/revise, move/archive and folder
creation in the project actor. Acceptance, grant changes, cross-space moves, workflow
configuration and dispatch remain separate existing authorities. Do not infer them
from a writable folder. Moving content must not broaden its audience silently: when
the destination has broader visibility, require an explicit sharing instruction or
present the affected destination/audience for confirmation. Task grants remain tied
to their original constraints after content moves.

The common skill teaches this sequence:

1. Read orientation and effective capabilities; recover after compaction or reconnect.
2. Search and read relevant exact revisions; report incomplete coverage.
3. Choose a destination using role and purpose, not a guessed label or disk path.
4. Reuse existing material where appropriate; preserve evidence and provenance.
5. Save through the service, inspect the returned receipt, and link the saved item.
6. Check changes at task boundaries; reconcile newer evidence and conflicts.
7. Keep draft, accepted, superseded, submitted and operational task states distinct.

Include concrete examples: research goes into Research with source links; an
undecided option goes into Ideas; “we decided X” can be recorded as a decision but
acceptance follows the authorised acceptance operation; a build plan links accepted
decisions; a worker result links its assignment and verification. Agents must never
claim a skill is installed or a tool exists merely because the source package lists it.

Generate a short folder-purpose reference and tool capability descriptions from one
shared definition, proposed as `src/shared/spaceKnowledge.ts`. Package that reference
into both provider skills and include it in Threadlight's runtime orientation. Keep
provider setup guidance separate. Extend `scripts/package-memory-plugins.mjs --check`
to detect stale copies. Advertise runtime and skill contract versions so incompatible
old installations show an update-needed state while compatible old tools keep working.
Refreshing running plugin caches/sessions is a release step, not implied by editing
the repository's skill file.

## Creation and migration

New creation is idempotent: create the space, all nine role folders, the draft Project
brief and projection jobs as one logical operation. Do not report a complete structure
if some roots failed. Existing duplicate-name checks remain, and an interrupted
creation resumes by operation ID without duplicate folders or starter documents.

For existing spaces, run a versioned, resumable migration with a manifest and recovery
checkpoint. Do not run it merely because an agent opens a briefing.

1. Inventory Spaces notes/discussions, memory folders/items, accepted revisions,
   task inputs/outputs, grants and current file mappings. Back up databases and manifest.
2. Match Plans/Handoffs/Results only when provenance and purpose establish that they
   are the standard roots. A custom folder with the same name is not automatically
   claimed. Report collisions and request a one-time mapping choice when ambiguous.
3. Create missing roots with useful descriptions. Preserve custom hierarchy and IDs.
4. Convert legacy Notes records to canonical items, preserving IDs where possible;
   otherwise record durable old-to-new aliases. Preserve every historical revision,
   timestamps and origin. Unclassified notes go to Inbox, with no speculative AI sorting.
5. Convert embedded saved plans into linked plan items. Preserve original discussion
   history and source revision mappings. Existing memory items keep their IDs and
   folders; attach categories only where evidence is unambiguous.
6. Preserve acceptance and task pins exactly. A legacy saved plan is not automatically
   accepted. Existing Results outputs retain submitted versus accepted status.
7. Preserve grant scopes. Do not widen folder-limited grants to cover new roots or
   migrate notes into a broader audience without an explicit policy/mapping decision.
   Preview visibility changes before committing them.
8. Switch adapters to canonical reads/writes only after record/reference checks pass.
   Generate the new projection and preserve old snapshot links through aliases.
9. Record the completed structure version and counts; expose unresolved conflicts.

Freeze affected writes during final conversion and switch-over; finish or hold
in-flight submissions explicitly. A failed migration resumes or restores its checkpoint
before new-schema writes are enabled. Once new writes exist, recovery must preserve
them rather than blindly restoring a stale backup. Retain compatibility readers until
all persisted references and supported clients have a verified path to the new model.

## Delivery sequence

1. **Contract and persistence:** shared root definitions, categories, relationships,
   placement revision, capability contract, projection journal and migration planner.
2. **Canonicalisation:** migration, legacy aliases, note/plan adapters and new-space
   creation. Verify old assignments, grants and snapshots before switching writes.
3. **Notes:** folder navigation, document detail, search, history and operational links.
4. **Tools and agents:** common service adapters, scoped Brainstorm/ordinary Agent
   writes, both provider runners and all voice paths.
5. **Skills and rollout:** generate/package matching references, detect stale clients,
   install/update supported plugin packages and verify actual connected sessions.

Each phase is independently reviewable, but the feature is complete only when all
surfaces agree. Keep the current app usable during intermediate commits.

## Acceptance and focused verification

- A new space has exactly one root per role and one draft Project brief. Retrying
  creation after each injected failure produces no duplicates or missing roots.
- Save research through Notes; both provider tools and Brainstorm find the same ID,
  revision and sources. Revise through an authorised agent; Notes shows that revision.
- Brainstorm saves a requested idea through typed, recorded speech and native Live
  paths with equivalent receipts and project binding. Tests use controlled providers;
  release evidence includes actual Claude and Codex connected-session checks.
- A newer decision draft does not replace its accepted version. Plans and handoffs
  retain pinned evidence and signal changed sources without silently repinning.
- Moving/archiving preserves identity and history; conflicting edits fail safely.
  Restricted actors cannot infer or access hidden material, broaden audiences, accept
  content or dispatch by embedding instructions in titles or document bodies.
- Task workers cannot publish outside their output scope. Grants revoked while a
  call is in flight are rechecked before committing the write.
- Notes, Handoffs and Workflow show one underlying item/operation. Editing knowledge
  never manufactures a successful task, message delivery or workflow transition.
- Migration fixtures cover legacy notes/plans, custom and same-name folders, archived
  content, renamed roots, accepted drafts, task pins, restrictive grants, duplicate
  operations, crashes and externally edited snapshots. Compare counts and references.
- Projection failure leaves a durable pending job; restart catches up in order.
  External modifications and path escapes are detected without destroying user files.
- Package checks verify generated references and tool schemas for both providers.
  Runtime orientation exposes actual capabilities and version mismatches honestly.
- Compact UI checks cover all standard folders, long/custom names, navigation,
  empty/error/restricted states, attachments, draft preservation and linked discussions.

Run structural/schema/package checks first, then focused storage/migration/service
tests, real-caller adapter and UI tests, followed by formatting, diff and build checks.
Avoid the broad suite unless a changed shared component or discovered failure warrants it.

## Completion evidence

The implementation handoff must include migration results, the capability/version
matrix for the two external plugins and both Threadlight provider paths, representative
Notes/agent/file receipts for the same item revision, and any remaining release-only
verification. Passing mocked tests alone does not establish installed plugin readiness.
