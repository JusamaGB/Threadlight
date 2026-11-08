# Purpose routing and saver provenance validation

29 October 2026. Implemented in the primary checkout; no push, PR, regular-app
restart, installed-plugin refresh or writes into a real user space.

## Contract and compatibility

See [the specification](../specs/NOTE-PURPOSE-SPEC.md). Explicit `note` saves project
to Notes and export to notes/; `work_context` exports to handoffs/; `result` exports
to results/ and retains submission/resolution/item-acceptance steps. Old callers
omitting purpose and historical records retain legacy routing and subscriptions.
No keyword or authorship migration runs. A deliberate revision can correct purpose
without copying the item, losing history, or rewriting immutable files. Submitted
results cannot be refiled. Existing discussion links survive a correction and can
still be saved; retries of the original discussion creation remain idempotent.

MemoryStore remains authoritative for plugin records. SpacesStore exposes a
read-through view and rejects attempts to persist that projection as a second
local record. Human Notes retains its existing store/composer. New human captures
and edits record human provenance; plugin revisions record the server-authenticated
provider, approved source chat, enrollment/grant IDs and server time. Caller-supplied
saver/author fields are rejected. Unlinked identities do not invent a chat. Source
chat is a button in note details when an available native app identity exists,
otherwise the saved chat ID is shown. This describes the saver, not idea ownership.

## Automated evidence

- `npm run plugins:check`: passes; both committed plugin packages match the
  canonical protocol and skill. The existing approval-wait bridge is preserved.
- Focused ESLint and Prettier checks on changed source/tests: pass after fixing a
  fixture-only unused global and line-ending formatting. `git diff --check`: passes.
- `npx vitest run test/memory.test.ts test/memoryPlugins.test.ts test/memorySecurity.test.ts test/spaces.test.ts test/spaceContext.test.ts`: 94 tests pass.
- Final added discussion-link correction assertions: both packaged-provider cases
  pass again (`test/memoryPlugins.test.ts -t "routes purpose"`).
- `npm run typecheck`: Node and renderer pass. A SQLite fixture typing issue found
  in preflight was corrected to use the persisted string ID.
- `npm run build`: production main, preload and renderer build passes.
- `THREADLIGHT_UI_FOCUS=notes-purpose node test/ui/providers.smoke.mjs` with
  `THREADLIGHT_PLAYWRIGHT=C:/tools/node_modules/playwright`: passes on the final
  built renderer. Screenshot inspected: compact human/Codex/Claude rows each show
  their appropriate saver label.

Packaged tests spawn the actual Claude `scripts/memory-bridge.mjs` and Codex
`codex-plugin/scripts/memory-bridge.mjs` stdio interfaces against isolated
authenticated servers. They verify stable operation retry receipts, rejected saver
spoofing, exact native-chat/provider binding, read-only and foreign-project denial,
original persisted revisions, exported file contents/paths, Notes projection with
no corresponding local ideas row, human edit attribution, optimistic conflicts,
explicit refiling, immutable original snapshots, database reopen, historical reads
through discussion context, stable linked IDs and actual result submission.

Store regressions exercise automatic subscriptions with all three explicit purposes:
saves/revisions create no tasks/messages, while the legacy subscription tests retain
their behavior. Submitted result restrictions and separate human acceptance pass.
Historical records with purpose/saver absent remain unchanged after reopen and can
be explicitly refiled while retaining their old revision bytes. Backup validation
was updated for the new optional fields; the backup/restore regression passes.
All 29 Spaces checks include the preserved idempotent shutdown/revocation regression.

Renderer proof uses real Memory/Spaces services and isolated authenticated saver
fixtures, with synthetic provider/IPC boundaries. It verifies human and both plugin
notes, immediate updates, Notes exclusion for checkpoints, actual notes/ Markdown,
no implicit dispatch or inference, reload without duplicates, source-chat detail,
context-menu Rename preserving body/ID and prior provenance, and Discuss linking
the same note without creating a copy or starting inference.

## Limits and activation

This is local implementation and isolated verification, not live model behavior or
an installed-plugin test. Existing native plugin caches and the regular app were
left untouched. A source chat no longer exposed by the host remains a visible ID
rather than a broken launch button. Notes are text up to 8000 characters; larger
context remains work_context. Historical titles/provenance not previously stored
are not invented. Existing local human notes are not migrated into MemoryStore.

When the ongoing live test permits: launch the rebuilt primary Threadlight app,
refresh the installed Claude Threadlight and Codex threadlight-codex plugins using
their supported plugin managers, reconnect MCP tools, then request fresh approved
enrollments. Confirm the purpose parameter is present. Restarting the app alone
does not refresh either provider's cached plugin. Continue the existing Brainstorm
live test with one human note, one user idea saved by each provider, and a work
checkpoint; no separate test project or note-folder migration was created.

## Concurrent enrollment integration checkpoint

Project-selection enrollment changes arrived in the shared checkout after the
94-test routing preflight. The purpose fixtures were updated to pass their exact
isolated spaceId. Duplicate declarations/fields introduced during concurrent edits
were removed without changing enrollment behavior. Both packaged purpose cases,
the Notes-purpose renderer proof, typechecks, production build and plugin
consistency passed again with the new enrollment path. The 94-test total above
refers to the earlier routing preflight; it does not claim validation of all newly
added project-selection cases owned by the coordinating chat.
