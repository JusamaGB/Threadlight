# Notes composer validation — 29 October 2026

Notes now reuses the shared composer input and panel dictation through the reusable
composer used for typed answers. It supplies note-specific draft/save behavior,
placeholder and spacing. The empty view contains the composer and “No notes yet.”
instead of introductory paragraphs and a separate save button. Enter saves,
Shift+Enter adds a line, and the inline save control is labelled “Save note”.

The composer sits below the empty state or saved notes. Long note lists scroll in
their own area while the composer remains visible at the bottom. The isolated
`spaces-library` check verifies this with a populated list and confirms scrolling
does not move the composer; `notes-composer` also passes after this layout change.
Empty and long-list screenshots were visually inspected.

The existing per-space draft state and stable create ID are retained. Saves are
guarded against overlapping submissions, and failure keeps the draft. Dictation
fills the draft without automatically saving or starting Brainstorm. Existing
answer-composer callers keep their defaults.

Validation: focused ESLint, renderer TypeScript check, production build and
`git diff --check` passed. The isolated `notes-composer` UI check passed against
the real Spaces service/store and renderer, covering compact geometry, multiline
input, draft retention across tabs, failed-save retry, button/Enter saves,
dictation, Markdown contents under `notes/`, persistence after renderer reload,
and zero Agent calls. Empty and saved-note screenshots were visually inspected.
Provider IPC and microphone audio were synthetic; the live app was not restarted.

Storage inspection found two current paths: UI Notes uses Spaces records and
`ideaDocuments` to publish under `notes/`; plugin shared-memory items use
`memoryDocuments` to publish under `handoffs/`, or `results/` for task outputs.
The Notes list currently displays Spaces notes, not plugin memory items. This
change does not unify those stores. The user's live note and a subsequent
agent-published note remain separate acceptance checkpoints in the ongoing test.

## First-sentence titles and note actions

New UI captures derive a first-sentence title locally using sentence segmentation,
within the existing 80-character title limit. The complete original body is kept.
Existing titles are not rewritten. Note rows now use a single nonwrapping title
with the app gradient fade. Opening the note exposes its full stored title/body.

The shared context menu supplies Rename and Discuss; Shift+F10 also opens it.
Rename uses the original revision, preserves body/plan/assignments, retains any
same-revision editor body draft, and checks concurrency through the save API.
Escape cancels rename without triggering the parent Spaces back action. Prepared
notes retain their existing editing restriction. Discuss opens a linked discussion
without inference. The visible per-row discussion button was removed.

The focused notes-composer regression passed with the real renderer/service/store:
first sentence vs full body, Escape cancellation, mouse and keyboard context menu,
rename persistence, nonwrapping overflow and gradient, opened full title/body,
and linked discussion with zero Agent calls. Screenshots of the menu and faded
row were inspected. Focused lint, renderer typecheck, formatting and build checks
were run. The running application was not restarted.

The storage distinction recorded above describes the composer-only checkpoint.
The subsequent [purpose-routing implementation](NOTE-PURPOSE-2026-10-29.md) now
projects explicit-purpose plugin notes into Notes without copying their records.
