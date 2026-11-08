# Spaces shutdown regression — 29 October 2026

The live restart displayed “database is not open” from SpacesStore.owners via
SpacesService.syncMemory and MemoryConnections.close. The app closes Spaces during
before-quit, then shuts down memory during will-quit. Revoking an approved plugin
connection performs a memory transaction, which still held the Spaces beforeCommit
callback after the Spaces database had closed.

Spaces now releases its owned memory callbacks after the Agent has closed and
flushed, immediately before closing its database. Later memory transactions can
revoke ephemeral grants without exporting through the retired Spaces store.
Execution-context requests fail explicitly when Spaces is closed. Callback identity
checks preserve any replacement owner's bindings. Repeated close calls share the
same shutdown promise.

The regression test in test/spaces.test.ts creates a real approved connection,
saves a note, closes Spaces, then closes the real MemoryServer in the same order
as the app. It checks no exception, persisted grant revocation, repeated-close
behavior, refusal of closed execution contexts and preservation of the saved note
after reopening the database. No native app, provider process or error dialog is
launched for this test. Live restart acceptance remains separate.

The normal workflow and setup are unchanged, so no README/setup-guide change is
needed. The user-visible fix is recorded under Unreleased in CHANGELOG.md.

Validation completed: all 29 Spaces tests passed, including the new shutdown
regression; focused ESLint, Node TypeScript check, production build and diff check
passed. The running app was not restarted or used for destructive testing.
