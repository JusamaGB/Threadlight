# Agent audio, voice headings and reading height

The grouped heading checks below describe the preceding build. The [continuous Agent reader](AGENT-CONTINUOUS-LIVE.md) supersedes those headings and moves the working mark into the transcript.

The checks used the primary checkout, isolated Windows renderer fixtures, and a separate Electron window. Audio input and playback came from generated signals. No provider conversation was needed.

## Audio and work

The full Agent kept a full-width resting ribbon during silent work. Measured microphone input changed the ribbon, and audio received over the fixture’s WebRTC connection turned it Codex blue. The separate working mark animated during work and disappeared when the Agent waited. Reduced motion and the fallback canvas were exercised.

The 92 × 24 floating pill showed Codex and Claude playback colours from supplied provider state. The measured output level controlled the strength of the edge. Tests combined muted input, audible output and real work state, then removed the output while work continued. In reduced motion the travelling lights stopped and the audible edge held a steady intensity. The waveform and phone kept their separate click targets. These checks cover renderer behaviour and audio routing. They do not establish a new live-provider or physical-device result.

## Group headings and indications

A request inside a complete, recognized Live delegation envelope supplied the group heading. The original message remained visible inside the group. Ordinary text, incomplete records, trailing user text and nested tags retained their display fallback. Tests exercised stable request IDs, repeated requests, partial history, exact anchors, disclosure memory, pending cards and read-only history.

The timeline supports a pending indicator from a decision card attached to a specific turn. A screen-region thumbnail is also tied to a specific message. A code fence identifies a snippet, and a thread-read receipt identifies a source. Neither establishes that the Agent wrote a file or changed the repository. A file or diff count would require an explicit result attributed to that turn.

## Reading height

With two pins visible, the reader resized by pointer and keyboard at both vertical anchors. The grip stayed between Earlier and the Agent settings. In a 410-pixel-high panel the composer and grip remained accessible above the pins. The test checked the grip’s hit target, fixed panel width, reading position, draft, decision card, pin list and saved height after a reload.

The isolated Electron window grew with the reader and retained its anchored edge. Its pointer watcher kept the panel open when the pointer left during the captured drag. Existing pin list, folding and persistence checks also passed.

## Repeat the focused checks

- Run the Vitest checks in `test/agentTranscript.test.ts`, `test/motion.test.mjs` and `test/windows.test.ts`.
- With the UI test environment configured, run `test/ui/providers.smoke.mjs` with `THREADLIGHT_UI_FOCUS` set to `agent-grouped`, `mic-indicator` or `pin-list`.
- Run `test/ui/motion.smoke.mjs` for the rendered waveform and playback checks. Run `test/ui/window-hover.smoke.mjs` with `THREADLIGHT_UI_FOCUS=agent-height` for the native drag.

At the final read-only check, the regular app had a Live call open and was running an intermediate renderer that preceded the short-window layout fix. Its next restart after the call loads the rebuilt interface.
