# Live expanded thread view

Implemented 28 October 2026 on the existing `ui-work` checkout, following the
approved interactive preview. Other in-progress checkout changes are preserved.

## Behaviour

- Expanded ordinary threads show chronological messages and expandable native
  tool activity. Existing question/approval cards retain their response controls.
- Codex uses its desktop coordination pipe as a follower: owner discovery v1,
  following-change v1, stream-state-change v11. It receives snapshots and applies
  revision-checked patches. It never claims ownership, resumes a thread, starts a
  turn or sends a user message.
- The installed build uses canonical `turnHistory` islands, not just the legacy
  `turns` array. Island entry order and native item IDs are preserved.
- Only normalized visible records reach Electron's renderer. Private reasoning bodies,
  generated instruction envelopes and raw native conversation state do not. Only
  the short heading of a native public activity summary is projected.
- Existing Codex/Claude read adapters supply earlier history. Claude shows
  `History` and polls saved records every 1.5 seconds; it does not claim a live
  desktop subscription. Codex falls back to these reads while reconnecting.
- Reading older messages holds an item-and-offset scroll anchor. New/updated
  entries show a jump-to-live control. Collapse/reopen restores position, with a
  bounded in-memory history cache, rather than a second persistent transcript.
- The main process restricts requests to the panel's main frame and currently
  monitored sessions. Last-subscriber close, disabled monitoring, renderer
  reload/crash and shutdown terminate observations. Frame/patch and retained
  message limits are bounded; the UI explicitly reports the history limit.

## Verification

Focused tests in `test/threadStream.test.ts` and `test/threadTimeline.test.ts`
cover canonical order, immutable text patches, array changes, unsafe paths,
owner/thread/version validation, revision gaps, socket loss, close races,
reconnect snapshots, history merging, pagination failures, stale/empty fallback
reads, multiple subscriptions and provider disabling. Existing native question
and native message tests cover the shared desktop transport's request behaviour.

`THREADLIGHT_UI_FOCUS=thread-timeline` in `test/ui/providers.smoke.mjs` exercises
the built renderer's production component: in-place updates, reading anchors,
new-update counts, jump-to-live, tool expansion, retained content while offline,
earlier history and collapse/reopen. The older mock fixtures explicitly retain
their legacy summary API; this focus installs the new timeline API and tests it.

The opt-in `test/live/thread-timeline.proof.mjs` observed this active local chat
through the production `followCodexThread` implementation for 25 seconds. On
Codex desktop 26.1023.6123.0 it produced 7 live publications, 82 visible items,
unique IDs, one observed existing-message text update and zero recovery attempts.
It unsubscribed and closed afterward, retaining only counters and role names.

Run the live observer only with an explicitly selected chat:

```powershell
$env:THREADLIGHT_OBSERVE_THREAD = '<native-chat-uuid>'
node test/live/thread-timeline.proof.mjs
```

## Compatibility boundary

The Codex desktop protocol is internal and build-specific. Unsupported versions,
gaps or unavailable owners preserve displayed content and use saved-history
fallback while retrying with bounded backoff. Native history currently loaded by
the owner is supplemented by the existing local history reader, not by a forced
resume or full-history mutation in the desktop. Claude token-level desktop
streaming is outside this implementation.

## Native activity presentation

The expanded view groups adjacent actions within one turn, ending groups at
messages and compaction events. Current native activity headings and MCP title
arguments are retained; completed groups summarize their typed native events
(for example, “Loaded a tool, edited files, ran commands”). These are deterministic
labels, not new AI summaries. Commands retain bounded plain-text output inside
the nested disclosure. Group identity remains stable as actions arrive, preserving
its expanded state. Commentary no longer repeats provider/timestamp headings.

This is Threadlight rendering the native data, not embedding a Codex widget;
unsupported native item types and custom rich tool views are not reproduced.
Public summary extraction accepts only the short leading bold heading and drops
the body and raw content. Existing history readers retain their limited fallback
metadata when the desktop feed is unavailable.

Validation: 17 focused tests passed across grouping, stream projection and timeline
service, plus lint, typecheck and production build. The built renderer smoke test
covers collapsed/expanded action lists, output disclosure, changing active labels
without closing groups, compaction, scroll anchoring and reopen behaviour. A live
25-second production observer received 192 visible items with unique IDs, 8 live
publications, one text update and zero recoveries, including all seven supported
activity categories except search (no search event in this sample).

## Per-edit file cards

Native fileChange events now render as standalone cards between activity groups.
Every event retains its native ID, file paths, per-file and total added/removed
counts, and a bounded preview of that event's recorded diff. View changes expands
these historical previews; later edits to the same file remain separate cards.
Missing counts are explicitly unavailable rather than zero. Failed/declined edits
are not labelled as successful. Binary and shortened previews are identified.
Undo remains in Codex; this card only reads the recorded event.

Validation: 21 focused tests passed across file projection, activity grouping,
live stream and timeline service. The built renderer smoke test verifies the
+1/-15 two-file example, expanding both diffs, changing counts without closing
previews, and retaining the first card after another edit to the same file.
Lint, typecheck, production build and scoped diff checks passed.

## Inline thread composer

The live footer now uses the existing persisted per-thread draft and sendMessage
API. Scrolling into history hides the mounted composer and shows Reading history
with Jump to live; returning to the bottom restores the same draft. Expanding a
thread does not steal keyboard focus. Enter sends, Shift+Enter inserts a newline,
and IME composition does not send. Delivery failures retain text; acceptance only
clears the submitted text if the user has not typed a different draft meanwhile.
The existing relay status remains visible above the footer.

Validation: 23 focused messaging/draft/native-delivery tests passed, plus built
renderer checks for hiding/restoring drafts, collapse/reopen, exact target ID,
multiline input, IME, double-submit protection, failure retention and typing during
an in-flight send. Lint, typecheck, production build and scoped diff checks passed.
All sends in UI checks used the isolated mock provider; no test message was sent
to a user's real chat.

## Shared composer and context menu

The inline footer renders the existing Composer component with its rounded input,
send control, microphone, waveform, download prompt and delivery feedback. The
embedded view omits the To line, thread name, close button and provider gradient;
a gray border separates it from the conversation. Per-thread drafts remain shared with the docked composer. Microphone
transcripts are scoped to the thread where recording began.

Compose is omitted from the expanded row's context menu while the inline composer
is visible. In history it returns to the menu and jumps to live, restores the draft
and focuses the existing inline input. Collapsed rows retain the docked composer.
Opening a row with its docked composer visible moves composition into the row.
A consumed Compose request does not override history when the row is reopened.

Validation: the built renderer check compares the actual input class in both
locations, verifies one composer, menu visibility and focus, scroll/reopen draft
retention, mocked send outcomes, and dictation with synthetic audio. The separate
native-message renderer smoke check also passes for the docked composer. The 23
focused messaging and native-delivery tests, scoped lint, typecheck and production
build pass. UI checks use mock sends and generated audio, without sending messages
to real chats or opening a physical microphone.

The conversation viewport and footer share a fixed height. Hiding the composer
gives its space to history without resizing the card. Returning to live and changes
to the draft height keep the latest content pinned. Built renderer assertions verify
identical card heights, a larger history viewport, no embedded heading or gradient,
and the existing draft, focus, send and microphone interactions.

## Compact running commands

Active command groups use a single-line Running command disclosure rather than
repeating command text in the collapsed summary. Expanding the group retains the
full recorded command and nested output. Active labels have a subtle text shimmer;
completion and reduced-motion preferences disable it. Other active labels also
stay on one line with their full text available in details.

Validation: seven focused activity tests pass. The built timeline UI check verifies
a long command stays under 25px high, clicking reveals its full text, shimmer runs
only while active, and reduced motion disables animation. Existing timeline,
composer, scrolling and microphone checks continue to pass. Scoped lint, typecheck,
production build and diff checks pass.

## Viewed-image galleries

Image activity entries now display the actual local PNG/JPEG/WebP instead of its
path. Images in the same native activity group share one gallery with Previous,
Next and a position count. The preview fits the thread width and available height
without cropping, and captions show only the filename. Files load on expansion,
with a stable placeholder for loading and unavailable images. Live scrolling tracks
content growth so the opened gallery remains visible; reading history stays anchored.

A dedicated IPC request accepts only a thread ID and recorded item ID. The main
process resolves the image from an actively subscribed, allowed timeline and uses
the existing bounded raster reader. It does not accept renderer-supplied file paths
or fetch remote URLs. Missing, unsupported or over-5-MiB files show an unavailable
message. Closing the view invalidates outstanding responses.

Validation: 16 focused timeline, image-reader and activity tests pass. Built UI
checks cover landscape/portrait fit, lazy loading, next/previous boundaries, image
counts, missing files, no raw-path output, and first-preview visibility. Existing
scrolling, composer and microphone checks pass. Scoped lint, typecheck, production
build and diff checks pass.

## Composer attachments for local Codex chats

The shared composer accepts pasted images/files, dropped files and a native file
picker. Attached-file chips support removal. Attachment-only messages are valid;
preparation disables Send, and failures preserve the text and attachments. The
per-thread attachment manifest survives closing/reopening and application restart.
Accepted sends clear only the submitted attachment IDs. Owned file copies remain
readable by native conversation history, even if the original file moves.

The desktop owner receives localImage inputs for raster images, native attachment
metadata and the native-style file-context preamble for documents. Idle and steering
sends use the existing follower protocol, inherit the chat's settings, and retain
client-message receipt recovery. Receipt identity includes attachment IDs, paths and
sizes so a different attachment is not treated as the same pending message.

Compatibility boundary: this implements local Codex attachments, not ChatGPT's
cloud Files uploader. Inspection of the installed 26.1023.6123.0 desktop bundle
confirmed localImage inputs and attachment context in follower start/steer requests.
Its cloud composer uses account metadata for size/count/quota admission; those
metadata and upload endpoints are not exposed by the IPC integration used here.
Threadlight currently enforces the observed absolute 512 MiB per-file ceiling,
not account-specific ChatGPT quotas, and does not claim exact cloud-upload parity.
No API keys or authentication data are extracted. Claude attachments are unchanged.

Validation: 27 focused messaging, native delivery and attachment-store tests pass.
Built UI checks exercise synthetic paste/drop files, file selection, removal,
attachment-only sends, rejection/retry, collapse/reopen retention and partial picker
failure. The separate native-message UI check preserves existing text sends and
Claude behavior. Scoped lint, typecheck, production build and diff checks pass.
Native delivery assertions use a mock desktop owner; no test file or test message
was submitted to a real chat or cloud uploader.

## Inspect a viewed image in Artifacts

Right-clicking a loaded tool image opens an Image actions menu with Inspect image.
The selected gallery item opens directly in the existing Artifacts view. Its
original local file is linked to that thread's catalog when needed, without
copying the image or creating duplicate references on repeated inspection.

The renderer sends only the thread ID and recorded image item ID. The timeline
service resolves and validates the image through the active subscription before
the main process registers its artifact reference. Missing files leave the thread
open with an inline error. Escape dismisses the menu; the thread's Compose menu
does not appear over it. Back to threads uses the existing navigation.

Validation: nine focused artifact-inspection and timeline tests pass. The built
timeline UI check covers inspecting the second gallery image, exact artifact
selection and image content, Escape dismissal, failure/retry, return navigation,
and balanced feed subscriptions. Existing composer, attachment, history, footer
and user-message checks pass in the same isolated run. Scoped lint, typecheck,
production build and diff checks pass. No message was sent to a real chat.
