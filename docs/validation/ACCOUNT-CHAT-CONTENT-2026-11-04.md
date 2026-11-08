# Compact ordinary-chat content — 4 November 2026

Implemented and built in the primary checkout. The regular application was not
restarted; this is build and isolated UI evidence, not live UI acceptance.

## Behavior

- Both providers display Markdown answers, HTTPS links, tables within the narrow
  transcript and initially collapsed code blocks. User messages remain literal.
  No raw HTML is executed, remote image fetched or provider widget instantiated.
- Perplexity's existing read response projects bounded, deduplicated sources,
  explicit plan-goal states and suggested follow-ups. Unrecognised optional fields
  are ignored and private response metadata is not forwarded.
- Sources, Steps and Follow-ups are collapsed inside the expanded conversation.
  They add nothing to collapsed thread rows or Settings. Goal states never drive
  Active; a final plan block does not mean its goals completed.
- Suggestions fill and focus an empty composer. Drafts, dictation, sending and
  uncertain delivery prevent replacement. Choosing a suggestion never sends.
- Open disclosures, history and drafts survive ordinary background polling.
  Native task controls, scheduled-task cards and provider widgets remain deferred.

## Evidence

- Read-only production-adapter sampling of four existing Perplexity chats returned
  15 sources, six plan goals and three follow-ups. No prompts were sent, no tasks
  started and no credits spent. Only aggregate counts were recorded.
- `test/accountChats.test.ts`: 20 passed, including real parser projection,
  credential stripping, invalid URLs, optional-data tolerance, caps, repeated
  goals and explicit state handling.
- `test/accountChatAdapters.test.ts` and `test/accountChatsIntegration.test.ts`:
  four passed, covering the existing native send and restricted IPC boundary.
- Isolated `account-chat-replies` UI proof passed: both provider renderers,
  formatting, keyboard disclosures, retained open sections, draft focus and no
  automatic send, disabled suggestion replacement, table containment, inert
  HTML/images and HTTPS link targets. Existing send/recovery checks also passed.
- Isolated `account-chats` regression passed: empty/busy/error views, filters,
  compact rows, history, context menus and retained navigation.
- Screenshots of both providers and expanded Perplexity details were inspected
  at the narrow panel width. These use synthetic provider IPC, not live accounts.
- Focused ESLint, renderer TypeScript and production build passed.
- Main-project TypeScript still fails on the existing audio DOM type/include and
  Kimi preview test include issues. No new account-chat diagnostics appeared.

No regular-app restart, live-provider send, release, commit or push was performed.

## Reader consistency follow-up

The user reported a sent draft remaining after closing/reopening, a narrow
composer, pulsing controls and redundant Refresh/Older buttons. The draft cache
was tied to React state updates in the old view; background polls also toggled
disabled styles. Cleanup now runs from chat-owned delivery state and notifies any
mounted reader. It clears only the same draft snapshot that was submitted.

- Removed duplicate title and inline Refresh; Refresh remains in the context menu.
- Full-column composer keeps the standard shared margin, without transcript indent.
- Extracted the existing `EarlierMessages` boundary for both code and account chats.
- Foreground actions wait behind background reads; polls neither dim controls nor
  set visible loading status. Earlier-history loading keeps its own busy state.
- Extended isolated reply UI proof passes with a held poll, queued history request,
  queued send, delayed acknowledgement, close/reopen before delivery, empty saved
  and visible draft after acceptance, one send only, later reopening, stable control
  styling and composer width within 20 pixels of the thread width.
- Existing account-chat regression and code-thread reading smoke tests pass.
- Renderer TypeScript, focused lint and production build pass. Narrow-panel
  screenshots were inspected. No new live messages were sent or regular app restarted.
