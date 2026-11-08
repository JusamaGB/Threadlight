# Purpose-based shared notes

Implemented contract, 29 October 2026.

| Purpose      | Surface and export                    | Lifecycle                                                         |
| ------------ | ------------------------------------- | ----------------------------------------------------------------- |
| note         | Project Notes; notes/                 | Editable text, 1–8000 characters; linked Brainstorm discussions   |
| work_context | Handoffs; handoffs/                   | Checkpoint/continuation; no assignment implied                    |
| result       | Results export; existing task outputs | Explicit submission and separate human resolution/item acceptance |

Purpose is independent of `kind` (note, decision, reference, scratchpad) and author.
The API accepts optional purpose on create/revise. Both packaged tool descriptions
and skills require agents to choose it from user intent, clarifying only material
ambiguity. The server validates and routes it. Explicit-purpose saves bypass
subscriptions; legacy callers retain the existing subscription contract.

MemoryStore is authoritative for plugin notes. SpacesStore exposes a read-through
projection using the original item UUID, not a duplicate record. Notes edits call
revise_item with optimistic revision checks. Discussion noteIds link that UUID.
Brainstorm catalogues these once as item:UUID, classifies by purpose, and can read
exact historical revisions. Access still uses the item's original space/folder;
purpose never moves content across a security boundary. Human UI access remains
local-owner access. Task inputs remain pinned to original item/revision pairs.

Every new memory revision captures title, purpose and saver provenance. The saver
comes from the authenticated grant/enrollment, including the approved source chat,
connection/grant IDs and server time. Inputs cannot supply saver or author. An
unlinked enrollment records provider when available but does not invent a source
chat; legacy unbound capabilities are marked unknown. Human edits record human
provenance without changing earlier revisions. Saver identity says who captured
the material, not who originated the idea. Source chat is clickable in note details
when the host still exposes that chat's application identity; otherwise its saved
ID remains visible. Revocation does not erase historical attribution.

Omitted purpose preserves historical Handoffs routing, except existing task output
IDs remain Results. No heuristic migration occurs. A deliberate revise_item purpose
change preserves the UUID, old bodies, provenance, task references and immutable
Markdown snapshots, while updating the current file mapping. Submitted result
purpose cannot change. Notes/work_context must be explicitly revised to result
before submission. Existing untyped task outputs retain their lifecycle.

Existing local human notes remain Spaces records; there is no destructive merge.
They display Saved by you, and new revisions record human saver time. Plugin notes
are not copied into that table. Unsupported direct store mutation of a projected
record fails rather than silently duplicating it. The Notes composer and Spaces
shutdown callback ownership are preserved.

Activation: launch the rebuilt app when the live test permits, refresh Claude's
Threadlight plugin and Codex's threadlight-codex plugin through their supported
managers, reconnect their MCP tools, then obtain fresh approved enrollments. Old
plugin caches still omit purpose. No installed cache is changed by packaging.
