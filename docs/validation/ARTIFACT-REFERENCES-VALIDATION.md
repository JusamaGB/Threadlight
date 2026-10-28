# Artifact reference validation

Validated locally on Windows on 2026-10-28, from the primary checkout.

## Codex inline visualization regression

The scanner now recognizes the native `visualize` marker's JSON path in visible
Codex assistant messages. The real mockup reply used that marker rather than a
Markdown link, so the previous scanner found only the older findings JSON and
input screenshot. A read-only replay of the original transcript now discovers the
HTML mockup first, followed by those two older references. The original remains
in its visualization directory; no transcript changes are needed.

- Four new regression tests failed before the change and pass afterward. They
  cover the real response shape, incremental UTF-8 appends, duplicate references,
  mixed link ordering, malformed markers, excluded examples/tool/reasoning content,
  and existing local path boundaries. The three focused artifact suites pass all
  24 tests.
- The native Electron smoke now appends a visualization marker. It passes automatic
  discovery, selection, working Play control, and the existing viewer isolation,
  refresh, copy and navigation checks.
- The actual user's mockup was also loaded in an isolated native viewer. Play
  updates its messages, and Disconnect displays its offline state.
- Focused lint, formatting, discovery-module typecheck and diff checks pass. The
  native fixture bundles the changed discovery code successfully. The full project
  typecheck currently fails in concurrent live-thread work (`threadStream.ts`,
  possibly undefined `revision`); no full app build/restart is claimed here.
- The original mockup was explicitly linked to its owning chat through ArtifactStore
  so the existing running build can discover it now. This stores reference metadata
  only. Automatic marker discovery takes effect with the next app build/restart.

## Automated evidence

- `test/artifactReferences.test.ts` and `test/artifacts.test.ts`: 13 tests pass.
  Covers Claude and Codex records, repeated links, thread-specific IDs, partial
  UTF-8 records, append/replacement/truncation, oversized records, the 200-reference
  limit, excluded tool/reasoning content, transcript and file path containment,
  junction escapes, metadata-only linking, updated originals and explicit copies.
- `test/codex.test.ts` and `test/tracker.test.ts`: 36 tests pass. The Codex tracker
  exposes the exact registered rollout only through its provider-qualified ID.
- `THREADLIGHT_UI_FOCUS=artifacts node test/ui/providers.smoke.mjs`: passes.
  Covers checker-strip updates, unchanged row height, overflow, keyboard/click
  selection, dual-width square previews, prior-layout restoration, thread isolation,
  HTML sandboxing/network blocking and readable errors.
- `node test/ui/artifacts-native.smoke.mjs`: passes with real Electron preload,
  IPC, discovery, storage and renderer, using an isolated temporary profile.
  Automatic discovery creates no artifact directory; manually linking writes only
  `index.json`. Editing the original is visible on Refresh. Keep a copy selects the
  new saved copy, which survives deleting the original and reloading. A deleted
  initial selection shows its error while keeping other artifacts selectable.
  A reference ID is refused when requested through a different known thread.
  The fixture now uses a Windows namespaced workspace. While the artifact view
  stays open, an appended Codex final reply adds a new HTML chip within the polling
  window, preserves the currently open artifact, and opens a working interactive
  preview when selected. No Link or Refresh action is used for the new file.
- Typecheck, focused ESLint and Prettier checks, production build and
  `git diff --check`: pass.

## Real provider evidence

The live storyboard check exposed a Windows path mismatch: Codex recorded this
chat's workspace as `\\?\Z:\General`, while the presented HTML link used the ordinary
drive path. The lexical containment check rejected that file before resolving it.
The corrected comparison normalizes local drive prefixes from provider paths;
transcript-supplied device/UNC links and junction escapes remain rejected.
The Windows regression fails before the fix and passes afterward. A read-only
probe using the actual Codex database row and the production scanner found eight
references, including `threadlight-advert-storyboard.html`, after four bounded
scan batches, without a warning or saved copy.

A read-only probe of this chat's registered Codex rollout discovered the three
existing screenshot attachments. All three resolved to existing original files,
with no scan warning. The probe used the production discovery implementation and
did not write provider records or create saved artifact copies.

## Scope and limits

This validates local Claude Code/Codex transcript references, not cloud-hosted
artifact retrieval. Claude parsing uses synthetic records; the real-provider probe
used Codex. PDF, Office and media references are discoverable but are not yet
previewable. Original files can disappear when their owning application clears
temporary storage; only an explicit Keep a copy preserves a snapshot. No full
repository test suite or external CI run was claimed for this focused change.

The regular application was restarted from the primary checkout after checking for
active Agent workers and isolated live tests. Its local status endpoint responded
successfully after restart. User-profile artifact discovery was checked through the
read-only probe above; interactive viewer actions were exercised in the isolated
Electron fixture.
