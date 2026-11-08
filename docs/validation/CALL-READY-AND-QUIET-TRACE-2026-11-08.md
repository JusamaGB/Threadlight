# Call readiness and quieter Trace

## Findings and change

The companion's Trace refresh used `editor.action.inlineSuggest.trigger` after
each matching edit or caret change. VS Code's implementation explicitly requests
the inline-suggestion accessibility signal from that command. Trace now leaves
normal matching typing and Backspace to the native completion model; its delayed
validation still clears stale or divergent traces. The initial explicitly requested
trace retains normal VS Code accessibility preferences. No global editor sound
settings were changed.

The guide invalidates old line positions when source changes and requires a fresh
read on explicit continuation. That state is not an automatic call pause/resume,
and the inspected path has no Threadlight pause/resume sound generator. The
learner's physical sound was not recorded or independently identified.

GPT Live already negotiates the native session concurrently with microphone
acquisition and buffers early speech. A short local two-note cue now runs once,
after both microphone acquisition/audio-context resume and native session
readiness. It does not await sound completion, change voice-turn detection or
delay input. The cue connects only to the local output destination; speaker mute
silences it. Ending startup prevents a late success cue.

## Verification

- Syntax and scoped ESLint passed for the changed Trace, microphone hook, cue and
  cue fixture.
- `THREADLIGHT_TRACE_ONLY=1 ./scripts/test-editor-coach.ps1 -Keyboard` passed in a
  disposable real VS Code host. Matching typing, Backspace, automatic character
  pairs, divergence, LF/CRLF, insertions, explicit acceptance, Undo and invalidation
  remained functional. The test evidence was retained outside the checkout.
- The initial broader editor run stopped in the unchanged proposal keyboard test
  before reaching Trace: `print("🐍")` was observed where the fixture expected
  `print("🐍 label")`. No proposal assertions were weakened. That unrelated case
  remains a reconciliation/release check; the focused Trace run passed.
- `THREADLIGHT_UI_FOCUS=call-ready node test/ui/providers.smoke.mjs` passed with a
  generated microphone stream and substitute native peer. It checks model-ready
  gating, delayed microphone acquisition, one cue per session, cancellation,
  speaker mute and no replay on unmute. No real microphone or provider calls.
- `vitest run test/liveVoice.test.mjs`: 21 tests passed.
- `npm run typecheck` and `npm run build` passed.

These are source and isolated rendering/transport checks, not physical headset
timing or a regular-app reload. Companion 0.6.2 was packaged and installed with
the VS Code CLI; the CLI's extension list confirmed that version. The user's
editor window was not reloaded, so its extension host may still be on the earlier
version. App restart/activation is being completed separately by the UI owner.

## Primary references

- [VS Code trigger command](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/inlineCompletions/browser/controller/commands.ts)
- [VS Code accessibility signals](https://code.visualstudio.com/docs/configure/accessibility/accessibility#accessibility-signals)
