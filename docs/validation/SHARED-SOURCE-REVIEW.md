# Shared Spaces file review

Verified on Windows on 8 November 2026 using disposable files and Space databases.

## Signed-in Codex text

The production Brainstorm service received an imported 83-line Python attachment. A misleading first-line comment claimed missing dates were accepted. The decisive branch was on the second page. The Agent read all 83 lines, cited lines 81–82 for the exact missing-date return value, explained that line 83 calls an external reservation function, and distinguished that call from the external implementation it had never read. It identified the comment discrepancy and reported that no code or tests had run.

A second attachment had the same filename and a different return value. A follow-up in the original discussion returned the original value and cited the original line. The test verified that the synthetic source on disk retained its original CRLF text.

The file picker supplied a disposable path. The model, Agent, scoped tool calls and storage were real. The signed-in test used text only. Claude and physical audio were outside this check.

## Isolated regression checks

- The import action names the destination and sharing scope, handles cancellation without creating an item, preserves nested indentation and CRLF, and enforces UTF-8 and size limits. Empty source files can be imported and read.
- The reader records a contiguous prefix for the pinned item, revision and hash. Closing its scope after page one leaves partial coverage. Opening a source line in the UI does not count as an Agent read. A reopened scope can continue from the next line.
- Same-name imports have distinct identities. Natural file requests can bind an unambiguous source. Ambiguous names require an explicit selection. A different Space, an external grant for a sibling folder, and an archived item cannot read the source through the tested paths. The pinned review cannot save a note through its scoped tool server. Import and review did not publish the source or file discussion as workspace Markdown.
- The headless browser exercised the built Handoffs attachment view, **Explain this file**, the Brainstorm reading-status display, and opening and closing a cited two-line excerpt by keyboard. This check used real disposable stores and synthetic provider output.

## Reproduction

Run the focused Spaces, Space context and memory tests. The signed-in test is opt-in: set `THREADLIGHT_SOURCE_REVIEW_CLI` to a signed-in native Codex executable, then run `npx --no-install vitest run test/spaces.test.ts -t "both source pages"`. It uses its own temporary Agent workspace and encrypted tool endpoint.

After a build, use `THREADLIGHT_UI_FOCUS=source-review` with `node test/ui/providers.smoke.mjs` for the browser check. Set `THREADLIGHT_PLAYWRIGHT` to a local Playwright installation when needed.
