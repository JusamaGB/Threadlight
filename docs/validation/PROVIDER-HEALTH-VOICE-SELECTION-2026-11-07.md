# Provider health, voice and Smart Thread copy acceptance — 7 November 2026

The combined `threadlight-provider-health-voice-selection.patch` was applied to
the primary checkout, preserving its existing uncommitted work. Patch SHA-256:
`de112629dc7f504b4f74ec1765e690e46abc9941fcf46b451f8652201ba0479f`.
All 36 patch paths applied without conflicts. A backup of their original files
and a hash manifest were saved outside the checkout. Every pre-existing file
outside the patch remained byte-identical at the preservation check; the index
was not changed. No commit, push, PR or extra worktree was created.

## Running regular app

The production build from the primary checkout was launched with the regular
Threadlight profile. No pending hosted Agent conversation or active live-test
process was found before restart; the observer pointer was from an older run.
Native desktop capture/input failed, so restart used process replacement and
the live automated checks used a temporary local debugging connection.

- **GPT discovery: passed.** The regular panel's production account-chat API
  returned 30 ChatGPT chats, `hasMore: true`, and `repliesAvailable: true`.
  The panel had no provider-error footer at that observation. This proves
  discovery and advertised reply support, not sending to an ordinary GPT chat.
- **Ctrl+Alt+Q with Local STT: passed, human confirmed.** The app reported
  `voiceMode: local-stt`, `agentProvider: codex`, and the saved
  `Control+Alt+Q` binding. The current run's voice trace recorded hotkey,
  request, microphone-requested and listening at 10:48 UTC. The user answered
  “Yes it works!” to the combined live check for an audible short greeting,
  waveform opening the panel and square Stop closing capture. This is human
  confirmation of real microphone/speaker behavior, not a generated-tone test.
- **Floating waveform and Stop: passed, human confirmed.** The same live
  acceptance covered both controls. A later production-state read confirmed
  `live: null` and an indicator of `{ live: false, level: 0 }`.
- **Smart Thread copying: passed, live automated check.** A real assistant
  message discovered in the current Codex transcript supplied `🙂`, `🙁`, and
  a two-line indented code fragment. Mouse selection followed by Ctrl+C and
  Ctrl+V preserved each fragment exactly, including indentation and newlines.
  Pasting used a temporary test textarea that was removed afterward; no chat
  message was sent. The prior clipboard text was restored. Initial attempts
  had unstable pointer geometry while the live panel moved; the completed
  check passed all three comparisons. Native physical pointer input was not
  independently observed by the capture helper.

Live copy results and screenshots were saved in the supplied external reports
folder as `threadlight-live-copy-results.json` and
`threadlight-live-copy-passed.png`. The regular app and the user's conversations
were retained after verification.

## Local checks and limits

- Passed: 113 tests across `accountChats`, `accountChatCommunication`,
  `liveVoice`, `micIndicator`, `settings` and `windows`.
- Passed: all three TypeScript projects and the production Electron build.
- Passed: isolated `provider-health` UI smoke check with installed Chromium:
  first-load discovery in Code view, footer errors with help off, empty-list
  recovery and zero sends. This uses synthetic provider IPC.
- The isolated `thread-timeline` check passed its composer, layout, scroll-boundary,
  grouping and diff checks, then timed out waiting for **Reading history** at
  `test/ui/thread-timeline.smoke.mjs:865`. It did not reach its later copy
  assertions. The full fixture is not recorded as passing; the separate regular
  app copy check above provides the acceptance evidence for this request.
- The Windows capture helper returned `window capture timed out: timed out
waiting on channel`; an indexed click also failed because coordinate geometry
  was unavailable. These failures are separate from the human voice acceptance
  and the live Chromium-driven copy check.

The patch also updates `CHANGELOG.md` under Unreleased, `README.md`,
`docs/ACCOUNT-CHATS.md`, and `docs/FEATURES.md`.

## Selected-text Copy menu follow-up

Smart Thread now uses the existing shared `ContextMenu` for selected history
text. Right-click exposes **Copy** only when both selection endpoints belong to
that conversation. The selected string is captured before menu focus changes,
preserving emoji, whitespace and code. **Shift+F10** or the context-menu key
opens the same action; **Enter** copies and **Escape** dismisses it and returns
focus to history. Ctrl+C remains available.

Passed the focused `THREADLIGHT_UI_FOCUS=thread-copy` isolated UI check for
Codex and Claude: right-click, exact emoji and indented multiline code, captured
selection after focus changes, keyboard copying, Escape/focus recovery, menu
bounds and no Copy action for an empty selection. Screenshots confirmed the
existing compact menu styling. This fixture uses synthetic provider IPC.
Focused lint, all TypeScript projects, production build and diff checks passed.
The unrelated longer history fixture was not rerun for this follow-up.

After checking the hosted Agent, Spaces Agent, microphone, relays and live-test
observer were idle, the regular primary app was gracefully restarted through
its existing restart action. A real discovered Codex transcript was selected,
its new right-click **Copy** item was activated, and the system clipboard matched
the selection exactly. Browser clipboard readback was denied, so readback used
the operating system clipboard instead; the Copy operation itself succeeded.
The live screenshot and result are saved in the external reports folder under
`threadlight-copy-menu/regular-app-copy-menu.png` and `regular-app-result.json`.

The follow-up updates the existing Unreleased changelog entry, README usage
instructions, and `test/ui/README.md`. Existing uncommitted changes were retained.

## Account-chat refresh during a Live call, 8 November

The regular panel recorded a successful ChatGPT chat-list refresh at 16:03:10 UTC and a Discovery rate-limit issue at 16:04:10 UTC while Agent Live was active. The user had observed an earlier warning clear on its own. At 16:09 UTC the same process still had Live active, the account list had refreshed successfully at 16:08:14 UTC, and the panel reported zero ChatGPT issues and no warning. Neither sample forced a refresh. The sampled health state establishes the affected operation. It does not identify which upstream request originally triggered the account-reader cooldown. The native adapter recognizes the desktop response “Too many requests”. During the cooldown, subsequent account-reader operations can also report the same category locally. Live has a separate transport.

The revised footer labels this condition **ChatGPT · Chat list**, uses an amber indicator and identifies automatic refresh. A successful list poll clears the issue. The service test exercises the bounded cooldown, retained catalog and successful recovery using a simulated reader. No extra request to the user’s account or live microphone was needed.

### Recurring limits

A bounded, passive observation of the running desktop bridge recorded naturally scheduled chat-list calls. At 16:12:19 and 16:18:24 UTC, `list_threads` returned an unsuccessful response with the exact detail “Too many requests”. Neither error body contained a retry hint. At 16:16:23 Threadlight rejected a list request locally during its cooldown. At 16:17:24 a native list request succeeded. The following minute’s failure came from a fresh desktop response. The panel was visible in the Agent view, with the Code-only filter selected and Live active. No overlapping native requests appeared in these samples. The desktop response does not identify the upstream quota or an account entitlement.

The old scheduler polled even when the user was not viewing account chats. With the Code filter it requested the list every minute. With chats enabled it could request every five seconds regardless of which panel page was on screen. A single success restored the normal cadence; every limit got the same one-minute cooldown. A retained open chat could also continue polling behind another page.

The new scheduler retains initial discovery and retries outstanding issues. Healthy ChatGPT discovery pauses away from its list and runs at most once a minute on the list. Hidden readers stop their history timer. Concurrent equivalent head polls share a single native request. Repeat rate limits within thirty minutes of cooldown expiry double the fallback up to fifteen minutes; a longer retry hint in the response body wins. The service returns the actual deadline so background reads can wait without another IPC or native call. These changes cannot establish or control the desktop service’s quota.

Thirty focused account-chat adapter, service and integration tests passed. Isolated panel checks covered startup discovery, recovery, idle discovery away from the chat list, minute-spaced visible refresh, retained conversation state and zero background history requests from the covered reader while Settings was open. Type checking, focused lint and the production build passed. The regular app stayed on its earlier build throughout the call.
