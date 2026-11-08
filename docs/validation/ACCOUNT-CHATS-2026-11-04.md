# Read-only ChatGPT and Perplexity connections — 4 November 2026

Implemented and built in the primary checkout. This task did not restart the
regular app, publish a release, commit unrelated work, or send a provider message.
Concurrent UI changes were preserved with the user's explicit confirmation:
ordinary thread rows, automatic discovery and connection diagnostics in Settings.

## Delivered behavior

- Saved All / Chat / Code & Computer selection, with separate chat-source choices.
- Ordinary account chats use existing row styling and provider accents; no
  workspace, diff, branch, reply or task-action controls are added to these rows.
- Active requires reported activity. Recent uses the time/count limits; account
  chats without a verified workspace association are absent from Workspace.
- ChatGPT resolves a real discovered local Codex context and revalidates it. No
  invented caller ID, new helper chat, or inherited environment ID is needed by
  the production integration. The live adapter proof uses its actual Codex caller.
- Perplexity lists recent non-Computer chats and reads bounded question/answer
  pages through its existing native read transport. The separate Computer preview
  retains its existing Settings entry point and credit-related acceptance gates.
- Main-frame-only IPC, strict action schemas, independently scoped known-chat IDs,
  private cursor management, server identity verification, deadlines and byte caps.
  Provider headers, tokens and extra metadata are not returned to the renderer.
- ChatGPT reads check the returned chat identity; Perplexity checks each entry's
  conversation context against the discovered list. Errors invalidate the native
  reader. Provider content is displayed as text, not executable HTML.

## Live checks

`node test/live/account-chats.proof.cjs` exercised the production adapters without
launching or restarting Threadlight. No Computer MCP generation was invoked.
The [latest sanitized record](ACCOUNT-CHATS-LIVE-2026-11-04.json) contains only
counts, roles and capability flags; no chat titles, bodies, credentials or IDs.

- ChatGPT listed 30 ordinary chats with a next-page cursor and read ten messages
  (user and assistant) from an existing conversation. The selected five-turn sample
  fit in one read. Older-turn paging is covered by response/service tests; this
  production sample did not exercise a ChatGPT older-turn request.
- Perplexity listed ordinary chats with Computer tasks excluded and returned a
  question plus answer. An earlier run in this session, at 15:05 UTC, listed four
  chats and successfully read another history page: two older messages, different
  message IDs and an advancing cursor. The latest run listed five chats and chose
  a newer sample with no older page. These counts describe the tested account at
  those instants, not a fixed catalogue size.
- An initial live Perplexity read hit the request deadline and closed safely.
  A fresh explicit probe succeeded. No automatic prompt retry or write followed it.

Validated provider versions: Codex desktop package 26.1027.3384.0 and Perplexity
package 2026.10.37378.0 / native server 26.10.3. These are private native interfaces;
public API compatibility and future desktop versions are not promised.

## Local checks

- `npx vitest run test/accountChats.test.ts test/accountChatsIntegration.test.ts
test/settings.test.ts test/perplexity.test.ts`: **56 passing tests**. Coverage
  includes forbidden mutations, arbitrary IDs/cursors, source isolation, genuine
  caller validation and automatic resolution, disconnect races, stale results,
  chronology, context mismatch, metadata stripping, fragmented frames, IPC sender
  restrictions, activity filtering and saved-settings compatibility.
- Isolated renderer smoke, `THREADLIGHT_UI_FOCUS=account-chats`: passed against the
  final ordinary-row layout. Checks empty/unknown/reported-active and workspace
  states, compact row colors, no code controls, keyboard opening, older-message
  order, filter/navigation retention, plain text, loading, failed-read clearing,
  retry and Settings diagnostics. Uses synthetic IPC, not live provider actions.
- `THREADLIGHT_UI_FOCUS=header-menu`: passed, covering existing header/provider
  navigation and keyboard behavior.
- Focused ESLint: passed. Renderer TypeScript check: passed. Production build:
  passed. `git diff --check`: passed (existing CRLF warnings in unrelated files).
- Full node-project TypeScript checking still reports the existing audio DOM type
  and project-inclusion errors in `audioEnergy.ts`, `audioEnergy.test.ts`, and
  `kimiWorkspace.test.ts` / `kimi/preview.ts`. No account-chat errors were reported.

## Remaining boundaries

Ordinary chats remain read-only. No reply parity, full attachment/widget rendering,
complete Perplexity archive/search, Claude ordinary-chat access, or shared-memory
enrollment is claimed. The proof does not establish independent public API support
for either native transport. See [setup and limitations](../ACCOUNT-CHATS.md).
