# VS Code Live coaching on Windows

## Gutter-only gestures and Python starting line (companion 0.6.17)

An isolated VS Code walkthrough kept the prepared highlight and token through clicks, double-clicks, triple-clicks and a drag in the code. The same test explained a gutter click and a forward or reverse whole-line drag. The browser-driven fixture supplies the rendered cursor type and controlled button state because its synthetic pointer does not move the physical Windows pointer. The production bridge samples the Windows cursor and button state.

A disposable Python buffer with a module docstring, comments and blank lines prepared its first function at line 60. An explicit request for line one still prepared line one. The signed-in file walkthrough fixture uses a similar introductory block and requests the whole file without naming a start line.

## Prepared file walkthrough (companion 0.6.16)

The isolated VS Code test uses the rendered **Auto** and **Start/Next** controls. It checks that preparation is silent, a click on the highlighted gutter number works before Start, and manual playback waits for Next. During a reverse drag from line 80 up to line 77, the test holds the mouse-button probe down while the editor sends intermediate selection changes. Release produces one explanation for lines 77–80. Next continues at line 81. A separate automatic pass visits all 92 lines. The test uses controlled playback acknowledgements and checks cancellation on source edits.

In a signed-in Live run, the editor prepared line 76 without speaking it. Selecting lines 77–79 requested one spoken explanation of how the three statements fit together. Clicking Start let Auto continue at line 80 through line 85, including a second page of notes. The receiver recorded audio and the source was unchanged. Use `scripts/test-editor-coach.ps1 -Walkthrough` for the isolated editor test and add `-Live` for the signed-in check.

## Ghost practice location (companion 0.6.15)

An isolated VS Code test started at line 64 of a saved Python file while the caret was elsewhere. Both location settings placed the caret on the first practice character. The editor applied a 55% opacity decoration to the remaining text and left the preceding context at normal opacity. A matching character triggered the corresponding line explanation; a mismatch kept the caret in place. Enter moved to line 65, and Escape removed the decoration. The original document version and disk contents stayed unchanged in both modes.

A signed-in Live session selected Coach and requested line 64 onwards in a disposable `problem.py`. The same document remained active. The first typed character triggered the explanation and the receiver measured non-silent audio. Run the existing ghost walkthrough checks below with `THREADLIGHT_GHOST_ONLY=1`.

## Spoken ghost walkthroughs (companion 0.6.14)

An isolated window running 0.6.11 reported a connected editor, Trace and inline proposals. It returned the active filename and the exact upgrade commands for unavailable narrated practice. In a separate signed-in session, the Agent selected the Coach skill, checked the 0.6.14 companion and editor context, opened a practice copy, and submitted the line explanations. The first typed character triggered confirmed audio and the source stayed intact.

An isolated desktop VS Code host exercised in-place block tracing, whole-file practice, an exact partial selection, generated text, and a pending replacement. It checked visible ghost text, typing before notes arrived, backward editing, a gutter jump beyond the first eight notes, mute, replay, the persistent Off setting and cancellation of old speech. Accepting a whole suggestion, including a one-character suggestion, stayed quiet. A manually typed one-character row spoke. A bulk insertion, Undo and Redo stayed quiet. The source buffer retained its original contents throughout copy-based practice. With native inline suggestions disabled in the isolated profile, the test inspected the visible practice text, typed its first character, heard one explanation in the controlled playback fixture and verified that the remaining letters were displayed.

In a separate signed-in GPT Live run the Agent opened a whole-file practice tab from a natural-language request, prepared the line notes, and delivered one spoken explanation of `print("lantern")` after the keyboard entered the first letter. The receiver observed non-silent audio. One run took 15 ms from the test sending the key to Threadlight requesting speech. That interval excludes provider playback latency. Tests used a disposable profile, synthetic microphone input and browser audio. A one-character paste can look like typing to VS Code.

Set `THREADLIGHT_GHOST_ONLY=1` and `THREADLIGHT_PLAYWRIGHT` to an installed Playwright module, then run `scripts/test-editor-coach.ps1 -Keyboard`. Add `-Live` with `THREADLIGHT_CODEX_CLI` and Chromium configured for the signed-in check.

## Opt-in coaching skill and learner profile

A signed-in GPT Live test selected Threadlight Coach and spoke the name of a synthetic learner’s course from the profile. A generated voice follow-up changed the learner’s level to week five. The test accepted the named profile decision through the normal Agent response path and checked the saved file and the unchanged teaching preference. It used a disposable profile and browser audio. Set `THREADLIGHT_LIVE_COACH_PROFILE=1` and supply a week-five update WAV with the normal `test/agentLive.live.mjs` configuration to repeat it. No editor connection is required for this check.

The application-control test covers a new chat starting outside coaching, selection and leaving, persistence across service restarts, field-level changes, stale revisions and malformed files.

## Source file walkthrough (companion 0.6.13)

An isolated desktop VS Code window with a 92-line Python buffer started at line 75 while the caret stayed on line 1. Real gutter clicks moved the highlighted explanation to lines 76, 80, 81 and 83 during held narration. The editor ignored a stale explanation and continued to the end from the last click. A separate pass visited all 92 lines in order. Editing the source ended the walkthrough. This test uses controlled playback acknowledgements.

A signed-in Live session then walked a disposable Python file from line 76 through line 85 with the caret still on line 1. The ten spoken explanations finished in sequence. Live requested the next page at line 84, and the receiver recorded non-silent audio. The editor buffer and caret were unchanged.

Run `scripts/test-editor-coach.ps1 -Walkthrough` with the Playwright setup below for the editor check. Add `-Live` with the signed-in Codex executable and Chromium configured for the voice check.

## Pending proposal walkthrough (companion 0.6.12)

The isolated VS Code test in `test/live/proposals.vscode.cjs` opens a tracker proposal, selects the exact rounding expression in the read-only review, revisits it for a follow-up and moves forward and back. It checks the source text and document version before dismissal. A replacement case checks both original and proposed rows, explicit acceptance and Undo. Editing the source invalidates the old walkthrough.

The signed-in text check in `test/live/trace-agent.proof.cjs` verified the agent used the displayed proposal for “next line,” explained the five-minute offset for inputs 6 and 7, and retained the same proposal and row during the follow-up. Set `THREADLIGHT_TRACE_ONLY=1` and `THREADLIGHT_PROPOSAL_WALK_ONLY=1` with the existing `-Keyboard -TraceAgent` setup to reproduce it.

The spoken check used an isolated VS Code window and a generated voice follow-up asking about the first line of a pending Python diff. The real Live agent selected that changed row and returned non-silent audio on the same connection. The proposal remained open and the fixture version and saved contents were unchanged. With the existing `-Keyboard -Proposals -Live` setup, set `THREADLIGHT_LIVE_PROPOSAL=1`, `THREADLIGHT_LIVE_PROPOSAL_WALK=1` and supply the follow-up WAV via `THREADLIGHT_LIVE_TEST_WAV`.

## Compact proposals in companion 0.6.5

An isolated desktop VS Code host opened **Result** and **Why this edit?** on a disposable dirty buffer, scrolled eight pages away and returned. The same proposal token and both open controls survived. While offscreen the status was pending, the explanation was unavailable and Accept left the document version unchanged. Returning restored the original diff and allowed the visible proposal to be accepted and undone.

In a separate overlap check, the real editor bridge queued the shown proposal’s instruction behind an active progress readout. Scrolling the line out of view canceled that queued instruction. Completing the progress playback and returning to the line produced no additional speech request. The voice transport was simulated for this editor check. The seven installed 0.6.5 runtime files matched the checkout.

The extension-host check used a separate VS Code profile and a disposable Python file.
It changed the open buffer without saving, then used the production coaching connection.

- At narration time the CodeLens was present, and the editor reported its line in view.
  The second explanation waited for the first hint's command. The final hint's command
  dismissed the guide.
- The read-only comparison showed the unsaved buffer on the left and the suggested
  replacement on the right. The source buffer stayed dirty, its text was preserved,
  and the on-disk fixture retained its original contents. A request using a snapshot
  taken before a subsequent edit was rejected.
- A signed-in foreground GPT Live session received two generated voice requests.
  The editor acknowledged the highlight on the assignment to `total` before the
  spoken explanation. The follow-up opened a comparison changing its initial value
  from one to two. The native reply confirmed the comparison opened, and the audio
  receiver measured new non-silent audio during that follow-up. The open buffer and
  saved fixture still matched their pre-call contents. This used synthetic microphone
  input and muted browser output. Physical headset playback was not part of the check.

A repeat check with companion 0.6.2 in an isolated desktop VS Code window confirmed the visible highlight before narration, click-to-advance, stale-version rejection and read-only diff with an unsaved source. All six installed companion runtime files matched this checkout.

The installed VS Code companion matched the checkout. After the idle checks,
the regular Threadlight app restarted from the primary checkout and loaded the
rebuilt main process and panel. Local STT was still selected and the mic was closed.

A reported walkthrough read its editor context successfully, then failed guide
validation before the companion received it. The first hint contained 209
characters against the original 120-character limit. The extension-host regression
uses a 209-character hint, verifies its short clickable label and full tooltip, and
advances through the guide. An invalid request identifies its field and asks for
a corrected retry. This check used a disposable file.

Run `scripts/test-editor-coach.ps1` from a Windows checkout with desktop VS Code
and the project dependencies installed. For the signed-in integration, add
`-Live` and provide `THREADLIGHT_CODEX_CLI`, `THREADLIGHT_PLAYWRIGHT` and
`THREADLIGHT_CHROMIUM` for the local test environment. The optional
`THREADLIGHT_LIVE_INITIAL_WAV` and `THREADLIGHT_LIVE_TEST_WAV` inputs exercise
a spoken coaching request and a follow-up diff request using the same Live session.

## Inline selection changes · companion 0.2.0

On Windows, desktop VS Code 1.145.2 displayed an expanded review thread directly
below a struck-through selection in its original editor. VS Code can also open
its Comments panel according to the user's settings. The companion uses stable
comment, decoration and text editor APIs. Copilot-style inline edit rendering
remains a proposed API. [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api)
and [proposed inline completion additions](https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.inlineCompletionsAdditions.d.ts).

- The isolated host used the real named pipe and Playwright keyboard input.
  The replacement was visible inside the editor. Both arrows cycled alternatives,
  Esc dismissed, and Tab accepted the displayed second version. No new tab opened.
- A reversed selection began after an emoji and ended partway through the next
  line. Both LF and CRLF cases preserved the surrounding dirty text and on-disk
  fixture. Preview, cycling and dismissal kept the document version unchanged.
  One ordinary Undo restored the complete prior buffer.
- Changing the buffer, moving the selection away and back, switching editors,
  or disconnecting the session invalidated the proposal. Normal Tab indentation
  and arrow navigation worked after cleanup.
- A separate signed-in foreground GPT Live check sent generated follow-up speech
  requesting an inline correction. The actual companion returned an awaiting-
  acceptance receipt and the receiver measured new non-silent reply audio. The
  dirty source and saved fixture retained their prior contents. Physical microphone
  and headset interaction and coexistence with a signed-in Copilot were untested.

For the keyboard and visible-text checks, supply an installed Playwright module
via `THREADLIGHT_PLAYWRIGHT` and run `scripts/test-editor-coach.ps1 -Keyboard`.
This launches a disposable profile and writes an editor screenshot to the printed
evidence directory. For signed-in inline follow-up coverage, also pass `-Live`,
set `THREADLIGHT_LIVE_INLINE=1`, and provide a generated inline-correction request
in `THREADLIGHT_LIVE_TEST_WAV`.

## Whole-file review · companion 0.3.1

The isolated Windows extension-host check opened a 99-line dirty Python buffer
whose saved file contained only a comment. Starting at the top with no selection,
the production bridge returned the exact unsaved text, including CRLF, an emoji
at a page boundary and an undefined name on line 98. The test supplied a VS Code
diagnostic and observed its severity and line separately from the source text.
Review preserved the dirty buffer and the saved fixture. Switching away and
back, editing between pages and disconnecting each invalidated the continuation.
An empty untitled tab returned complete. A 32,769-unit line returned its size
and zero coverage. The existing guide, inline preview and separate diff also passed.

Eight focused boundary checks exercise the exact 32,768-unit limit, long lines,
CRLF and surrogate pairs across pages, expired tokens, cancellation, unsupported
tabs and refusal before copying oversized source text.

A signed-in foreground GPT Live request reached the actual Agent and editor
through the production tool. It requested both pages and identified the undefined
name beyond the cursor excerpt. Generated speech asking for the same review
produced a spoken explanation citing line 98. The source was never executed.
The test used synthetic microphone input and muted output. Physical microphone
and speaker playback were outside this check.

Run `npx vitest run test/wholeFileReview.test.mjs test/appControl.test.ts` for the
boundary and tool-schema checks, and `scripts/test-editor-coach.ps1` for the
isolated desktop check. For the signed-in review, set `THREADLIGHT_LIVE_REVIEW=1`
and supply the signed-in integration settings above. Add `-Live`; for spoken
input, also set `THREADLIGHT_LIVE_INITIAL_WAV` to the whole-file request.

## Installed and loaded companions · 8 November 2026

The regular Live transcript and provider tool log showed three first-page
`review` calls at 11:46, each without a continuation. Each returned
`unavailable` with “The active file or its text changed. Read fresh context first.”
Between the first two calls, `context` returned lines 10–22 of the active buffer.
No review page or continuation was issued, including on the retry after a save.

The desktop extension-host log recorded activation at 10:00:33, when 0.1.0 was
installed. The connection record also dated to 10:00:33. Later installations,
including 0.3.1 at 11:34, left that loaded handler in place. Its unsupported
action fell through the walkthrough's snapshot validation. The regular
Threadlight process was running the primary checkout and exposed the review
tool. After the regular window started a new extension host and activated
coaching at 11:51:24, the same Live conversation received a complete first-page
response at 11:51:49 covering all 21 lines and 297 UTF-16 units of the saved
`receipt.py`. The Agent reported findings and distinguished diagnostics from
its own static review.

Companion 0.3.2 identifies the loaded version and supported actions during
connection. The updated app also recognizes the older unversioned response on
an initial review request. It reports an incompatible companion with zero
coverage and activation instructions. Unversioned 0.3.1 still supports review.
The reader’s source-identity and continuation checks are unchanged.

In separate real desktop extension hosts, the original 0.1.0 package and
installed 0.3.1 replayed review, context, review, explicit save and review
on a disposable 22-line buffer. The former reported the activation requirement
on each review. The latter returned the exact complete text in both dirty and
saved states. The test also moved keyboard focus to the Explorer and back.
Use `scripts/test-editor-coach.ps1 -CompatibilityCompanion <extension-directory>`
to repeat the sequence with an unpacked companion.

A separate Windows desktop held a real VS Code extension host and Threadlight's
isolated native panel fixture. The check moved input focus from VS Code to that
panel between page one and page two, then back to VS Code for the next review.
The extension observed the focus change. Both reviews reconstructed the entire
source under their respective snapshots, first dirty and then saved. The
regular user's desktop stayed active throughout.

The corrected companion also passed the isolated signed-in Live check, including
the complete two-page response, the inline preview keyboard checks, the paced
guide and the separate diff. Neither regular application was restarted by these
checks.

## Learner-paced guide · companion 0.4.0

The regular Live conversation about `receipt.py` recorded an explicit request
to see the review one step at a time. The Agent started a one-step guide at line
15, told the learner to click, and started another guide only after the learner
said they had clicked Done. The previous companion sent a finish signal that
only cleared the host’s local plan. Its document-change handler also cleared
the guide during edits. There was no tool for spoken progression.

In an isolated signed-in Live session, generated microphone input asked for the
next step. The Agent used the displayed step token to advance. The real VS Code
host then edited the disposable source, clicked Refresh, and observed a fresh
editor read and a new highlight for the same task. Clicking Finish delivered
completion to the backing thread and produced a native spoken acknowledgement
with no additional user message. The ordered receipts were shown step 1, shown
step 2, paused step 2, refresh requested, shown step 2 and completed step 2.
This used synthetic audio and muted playback. Physical microphone use and
the duration of a spoken pause were not measured.

A separate extension-host check held the narration callback open and edited the
buffer before it returned. It checked the visible refresh action, rejected an
old snapshot, resumed on the new line, and exercised stale clicks and voice
tokens, file switches, cancellation and disconnect. A signed-in whole-file
review of a different fixture began its finding with “Line 98” and identified
the undefined name after reading both pages.

For the end-to-end guide check, supply the signed-in integration settings above,
set `THREADLIGHT_LIVE_GUIDE=1` and set `THREADLIGHT_LIVE_TEST_WAV` to a generated
spoken next-step request. Run `scripts/test-editor-coach.ps1 -Live -Keyboard`.

## Trace · companion 0.5.0

A disposable Windows VS Code 1.145.2 profile displayed native ghost text on
an empty line inside a Python function. With inline syntax highlighting enabled,
the workbench rendered the identifier, operator and string with different token
colours at 0.7 opacity. The screenshot is saved as `trace.png` in the test
evidence directory. Colour and suggestion ordering follow editor settings,
grammar and theme. The provider exists only during an explicitly requested trace.
[VS Code inline completion API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#show-inline-completions)
and [inline suggestion settings](https://code.visualstudio.com/docs/editing/ai-powered-suggestions#settings).

- The real editor reported the original document version after showing a trace.
  Space indentation, matching typing, Backspace, a different character, an
  auto-paired parenthesis, accepting a suggestion-menu item with Tab, and Tab
  inside a snippet all exercised normal editing.
  Divergent input stayed in the buffer. Both LF and CRLF fixtures kept their
  saved contents. A multiline addition between existing statements accepted
  through the native inline-suggestion command and reverted in one Undo.
- The extension checked the snapshot, line content and UTF-16 column, including
  an append after an emoji. A stale version or wrong anchor was rejected.
  Moving to another tab, closing the editor, editing elsewhere or disconnecting
  cleared the trace. The current guide paused on typing. A spoken-origin Next
  command needed a fresh read of the typed line before refreshing the guide.
  That progression check called the real bridge from an isolated test.
- A signed-in backing Agent in a disposable workspace received two text requests.
  It used the production application-control tool and named pipe to place a trace
  on the blank line inside a function. For “Could you show me a live diff,
  please?” with no selection, it read context and requested a selection. The
  editor version stayed unchanged across both requests. This exercised the Agent
  and companion without opening a voice call. Physical speech, voice delegation
  for Trace, and competition with a signed-in Copilot provider were untested.

Run `scripts/test-editor-coach.ps1 -Keyboard -TraceAgent` with
`THREADLIGHT_PLAYWRIGHT` and `THREADLIGHT_CODEX_CLI` set. Omit `-TraceAgent` for
the editor-only check. The script prints the isolated profile and evidence path.

## File proposals, Python suggestions and spoken Trace · companion 0.6.0

Windows desktop VS Code 1.145.2 ran in separate disposable profiles. Two signed-in checks used the production backing Agent and editor connection. The speech check used generated audio, a muted browser and a separate foreground Agent fixture.

- The text caller asked to fill a blank line, then asked for inline diffs for issues in the current file with no manual selection. It used Trace first. For the review it paged through the dirty Python buffer and displayed proposals for the undefined variable in `doubled` and the string operand in `increment` beyond the cursor excerpt. Previewing left the version unchanged.
- In the voice caller, “show me the inline diff … explain the suggestion aloud when I can see it” led to review of both pages and a visible replacement on line 98. The completed spoken transcript explained why quoting the word changes its meaning. The proposal tool took 54 ms from dispatch through the visible acknowledgement and speech submission, excluding Agent inference. A generated “let me type it” follow-up placed `# practice` as Trace on line 99. The receiver observed new non-silent follow-up audio. The recorded call included 3,619 incoming audio packets.
- Dirty LF and CRLF fixtures covered insertion, repeated old text, a disjoint rename group, off-screen deletion, a UTF-16 anchor after an emoji, navigation, skipping, native editor edits and Undo. The saved fixture was unchanged. Tab accepted a displayed group, Alt+Backspace skipped it, and the next change waited for deliberate navigation. User typing invalidated the queue, and replaying the previous step token did not advance twice. A held narration callback plus rapid navigation and typing suppressed the queued explanation, returned an interrupted receipt and preserved the learner’s replacement. A simulated speech failure kept the proposal visible and returned a distinct narration failure.
- Local Python ghost text appeared 306 ms after typing a matching prefix in one editor run. Across three editor runs the paged review fixtures took 53–484 ms from starting the review through the first visible receipt. Three negative typing examples showed no Threadlight suggestion. A second registered inline provider displayed its own completion. These timings and counts describe the fixtures, rather than typical provider latency or prediction quality in everyday use.
- A disposable language-model extension, registered through the real VS Code model API, produced a multiline Python suggestion and a related deletion. Native full acceptance, partial word acceptance and Undo passed. Switching documents cancelled a deliberately late response, and a simulated provider failure reported local fallback. This exercised the optional model integration without sending source to an external model.
- A real 0.5.0 companion reported its loaded version, retained whole-file review and rejected the new proposal action with activation advice. Physical headset listening, signed-in Copilot ordering and external model-provider performance remain unverified. The normal editor and app were not restarted by these checks.
- The 0.6.0 VSIX was installed locally. VS Code listed 0.6.0, and all six packaged and installed JavaScript modules matched the checkout by SHA-256. The VSIX SHA-256 was `03643B223914B61A92CC1FA7BDE4B95CCB2888ECF54522B09FABDC82C0400BE0`. Installation leaves activation to the next window reload.

Run `scripts/test-editor-coach.ps1 -Keyboard -Proposals -TraceAgent` for the focused editor and backing-Agent check. Use `-PythonModel` for the disposable optional-model integration. The focused signed-in spoken check uses `-Keyboard -Proposals -Live`, `THREADLIGHT_LIVE_PROPOSAL=1`, and generated opening and follow-up WAVs with the wording above. The test browser forwards the same playback boundaries used by the regular app.

## Background Python suggestions · companion 0.6.1

Opening a Python buffer activated the installed development companion in a disposable VS Code profile. With no Live command or Agent connection, the real editor displayed local ghost text. The connection descriptor stayed absent. Changing the saved Threadlight preference to Off suppressed suggestions with the VS Code checkbox enabled; changing it to On displayed suggestions with the checkbox disabled. The same host exercised native model completion, related edits and Undo without starting Live.

The isolated Threadlight Settings UI selected On through its ordinary settings control. The application-control test approved a revision-checked settings update and verified the persisted Python choice. The regular VS Code installation listed 0.6.1 and its six JavaScript modules matched the checkout. The regular apps were left running. Run `scripts/test-editor-coach.ps1 -PythonModel` for the isolated editor check.

## Quiet guide edits and receipt examples, 8 November

The recorded receipt step asked the learner to fix both the loop variable and its colon. The editor emitted a paused guide event at 19:27:03 UTC. At 19:27:08 the native assistant transcript contained the request to say next. The later fresh review confirmed the colon and the remaining spelling error. The paused edit now updates the backing guide without submitting a realtime speech input.

A disposable VS Code extension host on a separate inactive Windows desktop exercised the exact target, partial typing, a short-lived match, a cancelled match, an invalidated refresh token, and the next highlight after a fresh source read. An edit outside the target line, switching editor, ending the guide or disconnecting prevents that check from completing. With older companions, explicit done/check or the editor control remains available. The backing transport check verified that a pause makes no realtime text or speech request.

The two saved backing answers at 19:31:32 and 19:32:33 both contained the fenced Python loop. Their native captions had no narration link, but each caption recorded its backing predecessor and its user's delegation identified that turn. The isolated renderer reproduced caption-first arrival, late code from that exact turn, an explicitly quoted current example on a follow-up, and clearing on guide invalidation. The source check does not search other turns for similar-looking code. An unrelated native refusal and a follow-up quoting only a closing brace both left the code hidden. A deferred provider injection through the real serialized editor socket suppressed a stale refresh, while saving an ordinary user caption preserved a current refresh. These checks used recorded evidence and synthetic voice input; no new signed-in conversation was started.

On a separate inactive Windows desktop, the Electron waveform produced 29 native resize events while opening, 16 while adding the Python block and 27 while closing. The renderer also checked reduced motion, two speaking and resting cycles, and dismissal before backing code arrived. The animation preview uses the actual renderer with a synthetic caption and audio levels.
