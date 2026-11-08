# Native Codex question lifecycle

## Regular conversation, November 8

Read-only inspection found the reported question in both the saved Codex turn and
the owning desktop window’s stream. The async tool had returned an acceptance
receipt when it displayed the question. The turn was still in progress. Voice
transcript segments and later realtime delegations were present. Neither source
contained a committed answer envelope for the question’s item ID at inspection
time. The desktop reader recognizes committed user messages and accepted or
acknowledged steering messages carrying the indexed question reply.

Threadlight previously reconstructed attention from the last 200 thread items
and attached the latest turn ID to a question found in that cross-turn list.
Its answer sender checked for some reply envelopes, but its attention scanner
did not share that check. The question’s × only toggled the expanded thread.
Separately, the recent Agent shortcut treated final punctuation as a pending
decision and restored that flag after restart.

## Isolated checks

- A real tracker over disposable Codex-format databases projects pending questions
  by thread, active turn, item and question index. Receipts remove only the named
  parts. Tests cover partial answers, more than 200 intervening items, interruption,
  a stale waiting hook, concurrent questions and an independent permission request.
- A fixture supplies owner snapshots in the shape used by the installed desktop.
  Pending steers and ordinary spoken text leave the card pending. An acknowledged
  steer or accepted reply with the matching indexed ID clears its part. A terminal
  owner turn clears the card before the saved turn catches up.
- The built renderer’s × leaves the smart thread expanded. It calls the local
  dismissal path, the same card stays hidden on reopen, and a new card appears.
  The main-process checks cover dismissal across rescans and restart, stale clicks,
  changed wording, undo, retention of other pending cards and floating attention.
- A saved recent Agent record with a legacy waiting flag restores a quiet shortcut.
  A current Agent request still signals until it resolves or the Agent ends.

The regular app and microphone were left running as found. No native answer was
sent during this investigation. When the desktop hides its own card without
publishing a matching receipt or ending the turn, Threadlight cannot establish
that the person answered it. The local × handles that case, and **Stop ignoring**
in the thread menu restores the pending card.
