# Live help with the active application

Proposed Windows experience. Ctrl+Alt+Q starts or stops the configured Live Agent. One conversation can span many applications. Two independent actions give the Agent context: asking about the foreground window and explicitly sending a selected region.

Implemented for the foreground Codex GPT Live connection. The broader provider
setup below remains a design goal. See the [Windows checks and remaining coverage](../validation/LIVE-SCREEN-HELP.md).

## One Agent throughout

The intended setup uses the selected Codex, Claude or Perplexity connection with computer use and its configured full-access or bypass-permissions mode. Use that connection and its existing conversation for voice, tools, images and replies. Changing the foreground application does not change the Agent. This is a product requirement; parity for live voice, computer use, image delivery and access mode needs verification on each provider and account. If a capability is unavailable, identify it on that connection. Do not silently route the image or question through another provider.

## “Can you help me with this window?”

Resolve the Windows foreground window when the user asks. Changing focus from VS Code to Spotify is all it takes. The shortcut starts the conversation; it does not choose a window. No target picker or retarget command is part of the normal flow.

Use the focus at the spoken reference, before transcription, a tool call or Threadlight's own overlay could move focus. Keep only enough session-local focus information to resolve the turn. If the user is actually interacting with Threadlight, identify Threadlight. Ignore transient focus changes caused by the capture overlay itself. If the referenced window closes before inspection, say so. Resolve focus afresh for each new “this window” question. An explicit follow-up about a previously shared image continues to refer to that image.

- **Spotify.** The user clicks Spotify on the left and asks “Can you help me with this app?” The Agent can answer “You’re in Spotify. What would you like to do?” Identifying the app needs no screenshot. For a general question it uses what it knows. When unsure, it searches relevant documentation. For “what does this control do?” it can inspect the actual window using the configured computer-use tools.
- **VS Code.** The user clicks an editor, then asks about lines 20–29. Read the relevant, current text using the best available source for that window, including an editor integration when available. Prefer the unsaved buffer or accessible text; use visual inspection or OCR when necessary. Distinguish exact lines from text inferred from pixels.
- **Any other app.** The same entry point works without a dedicated app skill. Choose an available skill, connected browser tab, accessibility interface or screen inspection according to the question. Search app-specific help when needed. Present the source with the answer if a lookup or inspection informed it.

## Hold Ctrl, draw, release Ctrl

During Live, hold Ctrl and right-drag to outline a rectangle anywhere on the desktop. Letting go of the mouse while Ctrl remains down leaves the rectangle outlined. **Releasing Ctrl sends the selected pixels immediately to the current Agent conversation**, even with a silent microphone. Releasing Ctrl mid-drag commits the rectangle at the current pointer position. Escape cancels before commit. An empty selection sends nothing. Ordinary right-click, Ctrl-to-hide and Ctrl+Alt-to-peek retain their existing behaviour outside an actual selection.

On commit, add a thumbnail to the Agent thread and begin delivery with a unique attachment ID. Show **Sending…** until the provider confirms receipt. The image can include whatever is inside the drawn rectangle; foreground-window lookup does not restrict the selection. Preserve the outlined boundary across mixed display scaling, excluding the selection outline from the image.

- **Image first.** Once received, the Agent can say “I’ve got the image. What would you like to know?” The user asks a follow-up without resending it.
- **Question already spoken.** Send on Ctrl release just the same. If the question and image belong together, answer directly. Do not interrupt the user to ask a redundant question.
- **While the Agent is speaking.** Deliver the image on release and acknowledge it at a natural break. Keep it in the same conversation.
- **Composer mic active.** Live remains connected and its red mute indicator stays visible. The explicit gesture still sends its image. Dictation remains in the composer and cannot become a question to the Agent.
- **Failure or stop.** Never acknowledge an unreceived image. Show a confirmed failure and allow retry; reconcile uncertain delivery before retrying. Ending Live abandons any uncommitted outline. A committed image belongs only to its originating session.

## Acceptance before implementation is called supported

1. Start Live with VS Code focused, click Spotify, ask about “this app”, then switch back and ask again. Require the correct app on both turns without a manual switch or a continuous screenshot feed. Delay a tool call until focus has moved to prove the Agent answers about the window referenced by that turn.
2. Draw over a random value, release the mouse while keeping Ctrl down, then release Ctrl in silence. Verify zero sends on mouse-up, exactly one send on Ctrl-up, confirmed receipt, and a correct spoken answer about the value when asked afterwards.
3. Repeat the image test while talking, while receiving a reply, and while dictating into a pinned thread. Check cancellation, mixed-DPI displays, normal context menus, disconnection and retry.
4. Test voice, full-access computer use and image receipt on each configured provider separately. Keep unsupported account paths explicit. Window identification alone does not validate screen inspection or image delivery.

Threadlight already reads the foreground window identity and title for internal shortcut handling. This proposal adds their use in Agent turns. The signed-in route for delivering images during Live still needs a provider-specific end-to-end check.
