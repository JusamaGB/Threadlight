# Artifacts from provider records

## Goal and scope

Use each monitored Claude Code or Codex thread's existing transcript to discover
explicit local attachments and presented files. Display originals in Threadlight,
without duplicating their bytes. A native thread ID locates records, not a universal
folder of artifacts. Hosted Claude chat artifacts, remote URLs and provider-only
objects without an accessible local file are outside this first implementation.

## Sources and ownership

- Resolve the exact provider-qualified thread through the existing trackers.
- Read the raw registered JSONL transcript, before display formatting removes links.
- Recognize local Markdown links/images in user and assistant messages, local file
  paths in structured attachment/image blocks, and Codex's user attachment envelope.
- Recognize Codex inline visualization markers in visible assistant messages. Parse
  their JSON path through the same local-file checks, preserve presentation order
  alongside Markdown links, and ignore malformed markers and fenced code examples.
- Do not treat tool output, shell commands, reasoning, or every file edited/read as
  a presented artifact. Do not scan the workspace looking for plausible matches.
- Stable IDs derive from thread ID plus normalized file path. Repeated presentations
  of the same path produce one entry. Identical paths in different threads remain
  separately associated with those threads.

## Storage and refresh

- Discovered references live in a bounded in-memory index; no provider database or
  transcript is changed. Local files remain in their original location.
- Scan JSONL incrementally with bounded reads, line size and concurrency. Continue
  older history over successive refreshes; report incomplete scanning instead of
  claiming a complete catalog. Reset on truncation/replacement and retain partial
  records until their newline arrives.
- Each scan reads at most 2 MiB, skips records over 2 MiB with a notice, and retains
  the newest 200 references per thread. Cache at most 100 threads and serialize scans.
  Visible rows and the viewer check for updates every three seconds.
- Visible thread rows refresh reference metadata periodically; unchanged transcripts
  require only a stat check. Reads of artifact content occur only on selection.
- Manual **Link file…** stores a small reference record, not a file copy.
- Existing saved artifacts continue to work. **Keep a copy** explicitly snapshots a
  selected reference into the existing saved-artifact store; it never deletes or
  migrates existing data automatically.
- Keep the existing limit of 20 explicit saved copies per thread; linked references
  do not consume those slots. The checker strip shows at most 20 tiles, using its
  final tile to open the full selector when there are more artifacts.

## Reading and UI

- Preserve the checker strip, filename hover, direct tile opening, dual-width square
  viewer, and restoration of the previous thread layout.
- Place the strip on a compact third line below the title and Now text, centred in
  the thread row so the group grows evenly outward as tiles are added. Every thread
  reserves this line, including while references load or when there are no attachments,
  so adding or removing artifacts never changes the container height. Tile buttons remain
  separate from the row button so opening an artifact never expands the thread.
- Open the original afresh on selection or Refresh. A missing, oversized, unsupported
  or inaccessible original gets a readable error; never silently substitute a copy.
- Images, UTF-8 text/Markdown and self-contained static HTML retain existing rendering.
  Other recognized document/media attachments remain discoverable but explicitly
  report that this viewer does not yet support their format.
- The original static HTML fallback remains sandboxed with scripts disabled.
  The [interactive extension](INTERACTIVE-CLOUD-ARTIFACTS-DESIGN.md) now permits
  inline scripts in a separate isolated viewer, without external resources.
- No permanent format/size footer or disabled dropdown placeholder.

## Boundaries

- IPC accepts only a known thread and an artifact ID, never a caller-supplied read path.
- Automatically discovered paths must remain inside that thread's workspace or
  known local temporary/generated-file roots after resolving junctions/symlinks.
  Relative links resolve against the thread workspace. Reject traversal outside
  those roots, remote/UNC/device paths, alternate data streams and non-file URLs.
- Explicit native-picker linking grants access only to the chosen local file.
- Read provider transcripts only inside their configured provider transcript roots.
- Discovery failures are shown in the viewer; no content is transmitted externally.

## Acceptance evidence

1. Synthetic raw Claude and Codex transcripts discover their own presented files and
   ignore tool output/reasoning. Links, spaces, Windows paths and duplicate references work.
2. Appends, partial records, large records, replacement and truncation behave correctly.
3. Selecting reads current original bytes; edits appear on Refresh, deletion gives an
   error, and discovery/linking create no artifact-content copies.
4. Cross-thread IDs, traversal, UNC/device paths and symlink escapes are refused.
5. Existing saved copies still display; an explicit snapshot remains readable after
   its original is deleted.
6. Real Electron preload/IPC/store/viewer integration and focused renderer tests cover
   automatic tiles, reference reads, Refresh, Link file, Keep a copy and navigation.
7. Typecheck, focused lint/tests, build and diff checks pass before updating the app.
