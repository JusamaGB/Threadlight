# Account chats

Hover or focus the header group beside Apps and the workspace. Click its
**Threads**, **Chat** or **Code** control to choose **Chat** or **All**. The
applications filter then chooses ChatGPT, Perplexity or both. **All** also retains
the existing coding-provider choices; its chat-source entries independently show
or hide each chat source. The saved default remains **Code & Computer**.

Ordinary chats use the existing thread-row layout with a provider color and no
code-only controls. **Active** requires explicitly reported activity; unknown or
idle chats are hidden. **Recent** uses the saved time window and count; **All**
shows loaded history. Single-column Recent interleaves coding and account chats
by their ordering timestamps, using one shared count with existing active-work
retention. Provider names in secondary lines distinguish ChatGPT from Codex and
Perplexity. Ordinary account chats have no verified filesystem workspace
and are absent from **Workspace**. **Code & Computer** retains the existing
work-session view. The separate Perplexity Computer preview and its task controls
remain in **Settings → Providers shown → Perplexity**.

Right-click a ChatGPT or Perplexity row, or focus it and press **Shift+F10**, for
Read/Close, Refresh and the existing layout actions. Escape returns focus to the
row. Opening the menu does not read or send anything. Code-only actions are absent;
Triple/Quad remain planning-only, and existing Dual view still splits Claude/Codex.

Open conversations refresh every two seconds while visible. Threadlight checks enabled chat sources once at startup. The ChatGPT list refreshes at most once a minute while its rows are on screen. Other pages reuse the last successful list. Perplexity checks its visible list every five seconds. List polling preserves the open reader and its older-message cursor. Updates
retain drafts, older messages and reading position. Activity comes from provider
status, never timestamps. These are automatic snapshot updates, not Codex-style
token streaming; ChatGPT can report working before its new messages become readable.

The shared composer sends a typed follow-up into the selected existing conversation.
Its draft is saved locally across navigation and restart, and clears only after
delivery is acknowledged. A reply in progress must finish before another send.
Sending is never retried automatically. If delivery is uncertain, inspect the native
chat and choose **I checked ChatGPT/Perplexity** before sending again. A durable
receipt records operation identity and a prompt digest, without storing prompt text
or provider credentials. A reply capability must be available before the composer
appears. Questions, approvals, attachments and cancellation still use the native app.

## ChatGPT

1. Open the supported Codex desktop app, signed into the intended account.
2. Choose **Chat** or **All**, then the **Recent** or **All** thread view.
3. Discovery uses an existing local Codex chat as the desktop routing context.
   Select a conversation row to read it; scroll to the top of loaded history and
   choose **Load earlier messages** to read older turns.
4. The row menu offers **Load older chats** when more provider history is available.
   The panel footer shows provider errors across views. A discovery failure keeps the last list and shows its update time. A temporary rate limit shows an amber **Chat list** light. Automatic discovery can retry an outstanding failure while the panel is visible, then clears the light after a successful refresh. Recurring limits within half an hour of the previous cooldown use intervals of one, two, four, eight and up to fifteen minutes. A longer retry time supplied by the desktop response takes precedence. Agent Live uses a separate connection. **Copy diagnostics** copies the operation, failure category and timestamps.
   Settings shows errors and **Retry** below the chat provider choices only when
   a connection fails. No connection cards occupy the thread list.

The connection resolves known local Codex chat metadata automatically. Its context is
validated again for every operation; Threadlight does not invent a caller chat ID,
create a helper chat, send automatically, or rely on an inherited build-process ID.
The context is temporary and is resolved again on a fresh list request. It is
routing context for the private desktop interface,
not an independent scoped authorization token. A compatible desktop app and a
known local Codex chat are required; this is not a standalone ChatGPT cloud API.

The native connection was validated against desktop package 26.1027.3384.0. It
checks package/executable/user identity, advertised list/read/send capabilities and
response schemas. Private desktop changes may require an adapter update.

## Perplexity

Open the signed-in Perplexity Windows app and choose **Chat** or **All** in
Threadlight. Recent conversations appear as ordinary cyan-accented rows in the
appropriate thread view. Select one to read its latest question and answer.
**Load earlier messages** at the history boundary reads another entry from that
same conversation. Refresh is
available in the chat's menu; connection errors and Retry appear in Settings only
when needed. Choose
ChatGPT and Perplexity independently under **Chat providers shown**, or use **All**
to select or clear both. These choices are independent of the work-provider row.

This uses the app's native connection with Computer tasks excluded
from the recent list. It does not require Computer OAuth or generate a Computer
task. Tested package: 2026.10.37378.0, native server **26.10.3**. Unsupported native
versions are refused. The list is recent history, not a complete archive/search
index. Computer credit restrictions are separate from these ordinary chats.
Replies use the native follow-up action, the current parent entry and its write
token held only in main-process memory. A successful stream head alone is not
delivery proof: the adapter confirms a new saved entry in the same conversation
with the exact submitted text. Native pending/completed status supplies activity.

## Shared-space messaging

From Agent, ask to start a Claude Code or ordinary Perplexity conversation in a named Shared Space and specify its opening message. Review the provider, role and opening message on the decision card. The space supplies the workspace. An active communication period and available dispatch budget are required. The receipt reports the native destination and whether the participant was added. If membership changed while the provider was responding, use the returned destination to add that same chat. Claude Code follow-up delivery uses the existing enrolled Claude runtime where available. Brainstorm has its own scoped tools. The provider connection is checked before a dispatch is charged. See [Shared Space chat acceptance](validation/SPACE-PROVIDER-CHAT-ACCEPTANCE.md) for the signed-in checks.

Shared-space communication uses the same destination lookup, send, journal,
receipt and inbox tools for Work/Code sessions and ordinary chats. In workflow
configuration, **Find all chats for roles** includes discovered ordinary ChatGPT
and Perplexity chats. Select a chat, give it a role and enable project DMs. Ordinary
chats retain **Current native model**; Threadlight cannot verify or override their
selected model. Enabled native apps and discoverable conversations are required.

An enrolled Work/Code sender can send a bounded brief to such a role using
`threadlight_send_message`, then inspect `threadlight_get_message` or its inbox.
Threadlight matches the exact delivered prompt and collects its subsequent text
reply only after the provider explicitly reports idle. Old, truncated, conflicting
or unconfirmed replies do not count as completion. The sender's inbox contains the
correlated result; no manual transcript copy is required. The sender is not
automatically woken. A lost connection or uncertain result is not retried.
Provider rate limits retain the connection and pause requests for one minute;
they are not reported as a changed response format. Only observation can resume,
never a send with an uncertain outcome.

Ordinary chats are message destinations, not memory-enrolled tool callers. They
cannot initiate arbitrary group messages, coordinate workflows, approve results,
or perform saved-output assignments through this adapter. A Chat-originated send
requires a separately supported tool connection. The same shared messaging
contract is the extension point for future providers; an adapter and live proof
are still required for each. No Kimi or ordinary Claude-chat support is implied.
Messages contain the selected brief only; joining a role does not automatically
share the native transcript, memory store, machine files or provider credentials.
No usage or subscription saving is guaranteed by routing a message.

## Limits and data handling

- The composer spans the thread width. Confirmed delivery clears its unchanged
  draft even when the reader closes before the acknowledgement arrives. Delivery
  and draft state belong to the chat rather than the mounted view.
- Background polling does not disable or dim controls. Explicit sends and history
  requests wait for an in-progress read. Earlier history uses the same boundary
  control as code conversations; Refresh remains in the row context menu.
- Answers support Markdown formatting, HTTPS links, tables that stay within the
  narrow reading area and initially expanded code cards. Each card supports Copy
  and collapse. Labelled languages can show syntax colouring. Remote images are represented by
  their labels; raw HTML is displayed as text, never executed.
- Perplexity sources, plan goals and suggested follow-ups appear only inside an
  expanded conversation, in closed **Sources**, **Steps** and **Follow-ups**
  disclosures. Steps show only explicitly reported goal states; a final plan block
  does not imply that every goal completed or that the chat is active.
- Suggestions fill an empty composer and focus it for review. They cannot replace
  a draft or send a message. Open disclosures survive ordinary conversation polling.
- There is no rename, archive, delete, cancellation,
  connector approval, or arbitrary tool/URL requests are exposed.
- The main process accepts reads and explicit sends only for chats discovered in the current source
  connection. History cursors stay in main; callers cannot supply arbitrary ones.
  ChatGPT response identity and Perplexity conversation context are checked.
- Credentials remain with the provider app. Provider cookies, tokens and other
  private response fields are stripped before returning data to the panel. Chat
  transcripts and connection context are not persisted or automatically shared/enrolled.
  User-authored drafts and delivery receipts are stored locally for recovery.
- Each pipe is verified on the same Windows handle used for I/O. The broader
  native app interfaces are private; Threadlight exposes restricted chat actions.
- Each request has a deadline and size limit. The list is capped at 300 chats;
  the conversation view loads at most ten pages. Refresh restarts the view.
- Attachments, tool details, widgets and other non-text content are not fully rendered. ChatGPT
  message truncation is labeled. Full content remains available in the provider.
- Refresh lists after switching accounts. A failed or interrupted read clears
  the displayed source and invalidates the connection; it never resends a prompt.
  Switching the type filter or visiting Settings preserves an already-open reading
  view when the same row remains available. Discovery refreshes in the background
  while the type filter includes chats, including with an open conversation.
  Hidden windows pause polling; an open context menu pauses discovery reordering.

Claude ordinary chat remains deferred while the account payment issue is resolved.
The existing Claude Code integration is unchanged.

See [initial reader validation](validation/ACCOUNT-CHATS-2026-11-04.md) and
[reply/update validation](validation/ACCOUNT-CHAT-REPLIES-2026-11-04.md). Build and isolated/live
adapter checks are not a release or a reload of the regular running app.
