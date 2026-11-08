# Reply code cards on Windows

The regular app was rebuilt and restarted from the primary checkout. Its live
Codex connection returned the original Python fence and indentation for a
previously saved reply that had displayed as plain text. The isolated renderer
displayed that same reply at the narrow panel width. The Python label and
highlighting were visible, and the Copy button returned the complete code with
its whitespace intact.

Isolated renderer checks exercised Codex and Claude Smart Threads, ChatGPT
and Perplexity account chats, and the Agent. They covered code formatting,
ordinary selected-text copying, and a recorded file link alongside a code
card. Account-chat polling preserved a manually collapsed card. Stream and
rollout tests checked the incoming Markdown independently of the renderer.

In the narrow Smart Thread fixture for both Codex and Claude, holding Ctrl
changed the cursor over the code to a grab hand. Left-dragging reached the
rightmost column and last line of an overflowing file, and dragging back
revealed earlier code. The surrounding conversation kept its scroll position.
Releasing Ctrl mid-drag stopped panning. Ordinary mouse selection and copying
the complete file after panning also passed.

These cards display code supplied in assistant replies. Provider-hosted editable
canvases and downloading arbitrary account-chat attachments were outside this check.

The pin check used the header context menu, changed views, reloaded the panel,
and unpinned the same snippet using the keyboard menu. A separate Windows
Electron check used the production window manager, renderer and preload. Hiding
the unpinned main panel exposed a focusable code-only window; reopening the main
panel hid the separate window. Changing reference height, the purple border,
static reduced-motion styling, detached panning and last-file Unpin were checked.
Cursor coordinates and button states were simulated at the input boundary:
the real reference continued scrolling after the simulated pointer left the
window and stayed at the display edge, and stopped on release. A physical mouse
drag on the user's monitors was not part of this check.

A Windows Electron check placed the logo at each of the four work-area corners,
opened Active and Recent at different panel heights, and hid the panel. In all
eight transitions the 238 × 340 reference aligned the matching corner to the dot.
The original implementation excluded the indicator rectangle from the reference's
native window region. That also exposed the application behind the logo.
Geometry tests also covered a negative-origin monitor, a clamped interior position
and the expanded microphone indicator. Placement is immediate, including when
reduced motion is enabled.

## Pinned snapshots · 8 November

The isolated Windows check now uses the real reference store, two Electron
renderers and native Windows hit testing. It checks the logo and code hit
targets after the reference receives focus. Temporarily hiding the indicator
revealed the reference's opaque background directly beneath the logo. Checks
ran at all four corners after both Active and Recent. The separate window
received a snapshot replacement, retained Copy and Unpin, and scrolled
horizontally with Shift+wheel.

The browser fixtures pinned two recorded text files with the same basename.
Their distinct paths appeared in the bottom help area on focus and hover.
Folding one preserved the other and survived a reload. A migrated unnamed
snippet retained its content and identity. Smart Thread checks exercised
Shift+wheel over code, horizontal trackpad deltas, overflow edges, Ctrl-drag,
selection and Copy.

The previous signed-in Live conversation asked for an explanation from a pin.
Its backing Agent could identify a pinned conversation and requested the file
again. In a new isolated signed-in Codex **text** session, the foreground Agent
used the production pin list and read tools, returned a value beyond the list
preview, and requested a replacement. The test accepted the decision for that
disposable pin. The new revision contained the requested code and the source
file retained its original bytes. Store and control tests covered stale and
denied replacements, revoked callers, stable IDs, legacy migration and durable
state. The signed-in text check is reproducible with
`test/live/pinned-code.proof.mjs`, `THREADLIGHT_LIVE_SMOKE=1` and the installed
`THREADLIGHT_CODEX_CLI`.

A separate signed-in WebRTC Live check sent generated speech through the native
microphone-input path. The user turn asked what two words the selected pin
assigned to a variable. The Agent called both pin discovery and read, and the
voice session returned “violet compass,” a value outside the list preview.
The check observed the completed spoken transcript, received audio packets,
and retained the conversation after the mic closed. Test output was muted.
Physical headset playback and signed-in Claude were outside this check.
