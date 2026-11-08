# Project discovery and bound enrollment validation

29 October 2026. Primary checkout implementation, isolated fixtures only; not a
release, installed-plugin reload or live-provider/model acceptance test.

## Contract and security boundary

Both actual packaged stdio interfaces (`scripts/memory-bridge.mjs --provider
claude` and `codex-plugin/scripts/memory-bridge.mjs --provider codex`) expose
`memory_list_projects`. It uses the authenticated/encrypted app/plugin transport
without an approved enrollment. The server projects only `{id, name}`; no content,
paths, filenames, credentials, assignments or briefing data. Shared Spaces wires
eligibility through its existing registered location/manifest/folder checks.
Unassigned legacy spaces and unavailable locations are excluded; pause and dispatch
budgets do not hide otherwise eligible projects. A standalone MemoryStore defaults
to no discovery until the availability provider is wired.

New connection requests require a stable Shared Space `spaceId`. Stored target,
provider, label and supplied native chat identity cannot change on a request retry.
Bridge status checks reject changed destination/identity arguments. Backend approval
rejects wrong project or wrong supplied native chat before creating a grant. Scoped
access revalidates target availability and grant identity. Request lists in Chats
and Agent access filter by project; review names the target with no project picker.
Rename uses the same stable ID and updated display name. Deleted/unavailable targets
fail status/wait/access and cannot be substituted. A supported project-originated
caller may supply the known ID directly; no launch or auto-enrollment was added.

Compatibility: old clients lacking `spaceId` receive a discover/update/new-request
error. Historical destinationless pending records cannot be approved. Requests are
process-local; restart expires them and revokes ephemeral grants. Native `chatId`
remains optional when unavailable from the host, with explicit human selection;
when supplied, only that exact native chat can be approved. Human verification-code
matching and approval remain mandatory. Returned names are data, not instructions;
both skills require clarification for duplicate names, no match or ambiguous intent
and forbid guessing from foreground state, chat title, paths or Codex project IDs.

## Executed evidence

- `npm run plugins:check`: canonical and both packaged assets match.
- `npx vitest run test/memoryPlugins.test.ts test/spaces.test.ts
test/connectionSetup.test.ts`: **58 passed**. Includes both real packaged bridges
  with authenticated isolated real MemoryStore/MemoryServer fixtures; minimal
  pre-enrollment discovery, duplicate-name guidance, unknown/deleted target,
  immutable retry, wrong-project/native-chat approval rejection, pre-approval
  content denial, status/wait consistency, rename, scoped post-approval access,
  legacy request rejection, unavailable folder discovery and shutdown cleanup.
  Existing purpose/provenance tests pass through both packaged interfaces too.
- Isolated Chromium renderer checks passed with
  `THREADLIGHT_PLAYWRIGHT=C:/tools/node_modules/playwright` and
  `node test/ui/providers.smoke.mjs`, separately for
  `THREADLIGHT_UI_FOCUS=connection-setup`, `project-participants`, `memory-security`.
  The connection check creates two isolated real projects, checks per-project
  request counts/visibility, requested-project review, exact chat binding, explicit
  code confirmation, lost-response retry, scoped grant creation and expiry.
- Narrow-panel `connection-identified.local.png` inspected: project name, code,
  confirmation and approval action visible without a redundant project picker.
  Screenshots: ongoing test outputs `project-discovery-proof/`.
- Focused ESLint, Node/renderer TypeScript, production build and diff checks pass.
  Modified sources decode as UTF-8. No native Electron test process was launched.
- Explicit-opt-in live proof scripts were updated for the new discovery contract
  but **not run**. Installed plugin/model behavior is a later human-led checkpoint.

Preflight corrected outdated assertions/fixtures and a TypeScript nullability
issue. A temporary lock on generated protocol output cleared on packaging retry.
The first browser attempt found an older Playwright package with no matching
browser; the existing installed package/browser above ran all renderer checks.
No live requests, real-project synthetic notes, self-approval, borrowed connection,
push, PR, app restart or installed-plugin refresh occurred.

## Later activation (after the ongoing live test permits it)

1. Restart Threadlight from the rebuilt **primary checkout**. This loads the new
   server contract and invalidates previous ephemeral enrollments.
2. Claude: refresh the local `threadlight` marketplace pointing at this checkout,
   then run `claude plugin update threadlight@threadlight`. Reconnect the chat's
   tools or reopen its conversation so the new bridge and skill load.
3. Codex: keep `threadlight-local` registered to this checkout. Refresh the cached
   package with the installed manager; the documented supported CLI path is
   `codex plugin remove threadlight-codex@threadlight-local` followed by
   `codex plugin add threadlight-codex@threadlight-local`. Reconnect tools or reopen
   the conversation after its writer is released. Review hook trust if requested.
4. Confirm **both** tool inventories expose `memory_list_projects` and
   `memory_connect.spaceId`. Ask each chat to connect to the intended project.
   Discovery must precede a fresh targeted request; show its project and code, then
   the human approves in that project's Chats → Requests. Check status and briefing
   with that same connection ID. Do not reuse an old or coordinating chat's ID.

An app restart alone does not refresh cached provider plugins. Native/model behavior,
Brainstorm launch identity propagation and automatic enrollment remain separate
live-test/release checkpoints; this change only permits a supported caller to carry
known project identity.
