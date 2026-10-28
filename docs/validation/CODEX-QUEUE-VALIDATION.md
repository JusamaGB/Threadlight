# Codex composer queue — 28 October 2026

The human composer defaults to native queue submission. Pending messages appear
above the entry box with Edit and Remove. Steer appears on a queued message when
hovered or keyboard-focused (always visible on touch devices). There is no timing
dropdown. Steer retains the native queue client message ID and full input, uses
the desktop owner, then removes the accepted entry from the queue. Unknown steer
results are journaled and reconciled before any repeat. Claude uses its existing route.

The adapter opens a short-lived Codex app-server connection for `thread/queue/list`,
`add`, `update`, and `delete` only. It never resumes a thread, starts a turn,
or replaces the whole queue. Codex owns queue storage, ordering and execution.
Visible composers refresh the queue every three seconds and after submissions.
Individual updates retain non-text inputs and attachment context. Queue reads
include entries created outside Threadlight. Unknown writes retain a durable
receipt; retry reconciliation uses the exact client message ID in the queue or
native history. Invalid request/parameter RPC errors retain the draft but release
the rejected receipt so the input can be corrected.

## Live proof

User-authorized disposable chat: `01a183da-45b7-77c0-8254-8dfac1b2a374`.

- Added a message during an active wait. Queue listing showed it persisted while
  native history had no accepted user message with that client ID.
- Updated the message in place; queue ID and client message ID were retained.
- Added and removed another entry without changing the retained entry.
- Released the active turn. The edited message executed in a subsequent turn,
  which returned `QUEUED_PROOF_EDITED`; the queue then became empty.
- Repeated through the production adapter with a real PNG attachment. Recreated
  the adapter between operations to check queue persistence. Edited the text and
  removed a second message. The retained entry still had its image and executed
  in a later turn, returning `QUEUED_IMAGE_EDITED`.
- An invalid PNG was explicitly rejected by Codex. This exposed and prompted
  correction of the rejected-input receipt handling.

## Automated checks

38 focused tests pass across queue, direct native messaging, message coordination
and attachments. Coverage includes multiple entries, attachment-preserving edits,
single-entry removal, restart reconciliation, lost acknowledgements, explicit
rejection, consumed entries and input validation. Isolated browser checks cover
queue rendering, editing, removal, composer clearing, explicit Steer and narrow
layout. Production build and focused lint pass.

The full repository typecheck has unrelated existing errors in artifactMessage
and stackedDiff tests. Application-only main/preload/shared and renderer checks
are run separately. The running application is not restarted by this change.

This uses the installed Codex queue protocol; future Codex incompatibilities
must surface as retained drafts and queue errors rather than a fallback send.

## Queued Steer follow-up

Live proof on the same disposable chat queued an image message, then invoked
the production queue `steer` action. Native history confirmed the existing
client message ID in the active turn `01a183ea-2b39-7270-8f5f-ee7b5af18ea7`,
which returned `QUEUED_STEER_PROOF`. The queue was empty afterward.
Focused tests cover identity/input preservation, other queued entries, uncertain
steering across restart, reconciliation and a turn finishing before the click.
The UI smoke test checks no dropdown, hover/focus visibility, and dispatching
the selected queue entry by ID without sending the composer draft.
