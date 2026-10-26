# Checklist file diff interaction

## Problem and existing behavior

Expanded checklist steps (`StepView.tsx`) show transcript edit counts as plain
text. Thread counters (`SessionRow.tsx`, `GitCount`) already use `Tip` for an
immediate hover summary and a clickable diff target. `ChangesView.tsx` already
renders full file diffs through `FileDiffView` and the read-only Changes IPC.

## Behavior

- A changed file's nonzero `+ / −` counts form one button using the existing `Tip`,
  colors, spacing and hover treatment. Planned, untouched files remain plain rows.
- Hovering immediately identifies the full file path, approximate additions and
  removals recorded on this step, and the click action. Existing tooltip dismissal
  and window-edge positioning apply.
- Click, Enter or Space toggles the existing full file diff viewer beneath that
  file. Only one file per expanded checklist step is open. Neither the checklist
  step nor its thread collapses. The button exposes its expanded state.
- Diff reads happen only after opening. The viewer shows the current uncommitted
  diff against HEAD, with the existing context lines, colors, line numbers,
  scrolling, size limits and Open action. The counts remain the step's approximate
  transcript totals; they are not a historical Git diff.
- Resolve transcript paths against the repository root, including Windows paths,
  nested working directories and Git's canonical filename casing. Retain the
  existing main-process validation of session and changed-file membership.
- Binary and oversized files retain the existing fallback. Missing Git state,
  outside-repository files, already committed files and failed reads show the
  existing unavailable message. Do not substitute another file or fabricate a
  historical diff. Offer Open only when a repository file was resolved.
- Activity updates refresh an open diff. Closing the step closes its viewer.

## Validation

Focused path tests cover nested folders, Windows separators/case and paths outside
the repository. Browser evidence exercises the real thread → checklist → counter
flow, immediate hover, click and keyboard toggling, canonical IPC targeting,
refresh, fallback states, unchanged planned rows and the existing Changes caller.
