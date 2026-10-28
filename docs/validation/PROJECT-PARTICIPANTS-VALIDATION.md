# Project participants validation — 28 October 2026

Implemented in the primary checkout, preserving existing concurrent changes.
No user project, enrollment or native chat was created by validation.

## Focused checks

- Plugin packaging and drift check passed for both providers.
- `test/projectParticipants.test.ts`: eight tests passed, covering attribution,
  idempotent retries, impersonation and scope denial, manual/verified provenance,
  scope-filtered metadata/events, backup/restore, connection expiry/revocation,
  matching without provider stereotypes, withdrawn reports and bounded context.
- Relevant `memory`, `memoryPlugins`, `spaces` and `connectionSetup` tests passed.
  Both actual packaged stdio bridges exercised the new reporting tool against a
  temporary local server. No provider CLI or user-native conversation was used.
- The new Spaces service test confirms current project evidence reaches Brainstorm
  and reviewed rationale reaches an unsent handoff. The provider send boundary is
  synthetic; no claim is made of a live-model round trip.
- The isolated `project-participants` renderer check passed at the normal 238px
  width: both participants, all four capability categories, human verification,
  manual reports, a lost save response and operation-preserving retry, Brainstorm
  context, suggested destination/rationale, draft preparation and revoked status.
- Existing `connection-setup` and `spaces-library` renderer checks passed.
- Focused ESLint, TypeScript, formatting, diff checks and production build passed.

Renderer checks use headless Playwright with temporary stores, synthetic IPC and
a synthetic provider boundary. They do not navigate, create or focus a chat in the
user's Codex/Claude window. Screenshots of participants, verification, manual
reports, suggestions, reviewed handoffs and reconnection were inspected.

The regular app was not restarted as part of these checks. Source and production
assets are ready for its next launch. Cached provider plugins need their normal
update/tool reload before `memory_report_capabilities` becomes available.
