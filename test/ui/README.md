# Provider UI smoke test

Build the app, then run `node test/ui/providers.smoke.mjs`. This optional test needs
an installed Playwright module and its Chromium browser. It uses ordinary module
resolution, or `THREADLIGHT_PLAYWRIGHT` can name an existing Playwright module's
absolute directory. It is separate from the default Vitest suite so normal installs
do not download a browser.

`THREADLIGHT_UI_FOCUS=startup` checks the single sign-in switch, the quiet-start
explanation, enable/disable and persistence after reload.
On Windows, `node test/live/app-launcher.proof.mjs` checks the real sign-in command
with spaces and apostrophes. It owns a temporary profile and a separately named
temporary Run entry, removes both on exit, and never starts the regular app.

Set `THREADLIGHT_UI_FOCUS=workspace` to run the toolbar checks and mixed Windows path regression:
Both + Workspace loads both providers from initially empty trees, combines ordinary
and extended drive/UNC paths in the picker, and preserves original IDs when loading
threads, saving a selection and switching providers. It also checks merged completion
ordering, stability during working/waiting updates, stable ties, nested side threads,
workspace isolation and reordering when the task goes idle.

`THREADLIGHT_UI_FOCUS=compact-layout` checks the 300px card, 6px thread spacing,
Git count placement, wires, compact menus and Shared Spaces. `thread-hover` checks
the one-second stationary last-active hover, movement/leave/scroll cancellation,
time/date switching, and immediate context/diff/usage tips. These checks use the
browser clock and synthetic timestamps.

`THREADLIGHT_UI_FOCUS=workspace-height` checks full-height Workspace, quota hover
tips and the height grip, persistent drag/keyboard picks, reload and smaller-screen
clamping, plus the existing content-sized layout in other views.

The test serves the built renderer on a temporary loopback port with synthetic IPC.
It never launches Electron, either chat CLI, or a hook server, and needs no accounts.
It exercises the actual settings controls, combined lists and workspaces, draft and
pending-answer retention, explicit live copy/open and Enter refusal, exact send targeting, pause/resume settings,
and the paused dot/hotkey. It also checks checklist file diff hovers, keyboard toggles,
refresh and unavailable files, the shared Changes viewer, Codex step/proposed-plan
rendering, separate quota hovers, expired usage, and safe text rendering. Provider aggregation and settings validation use the real
shared modules. Optional `THREADLIGHT_SCREENSHOTS` writes synthetic `.local.png`
previews to a chosen directory. The browser and temporary HTTP server close on exit.

The Agent scenarios cover Codex with both monitoring providers disabled, dynamic
and additional models, reasoning reset, explicit question submission, queued
approvals, Stop/End and paginated history continuation. These use synthetic IPC;
runtime protocol tests are in `test/agentCodex.test.ts` and `test/codexClient.test.ts`.
Opt-in authenticated tests are documented in `AGENT-CODEX-VALIDATION.md`.

Recording checks generate an audio stream in the browser and replace `getUserMedia`;
they never access a microphone or speakers. They verify full-width changing waveform
pixels, reduced-motion behaviour, preserved drafts, transcription and stopped tracks.
Voice routing waits for processed quiet audio before sending each opening test tone,
and measures the processed speech duration before ending it, so browser scheduling
delays do not consume the microphone's calibration period or shorten an utterance.

`node test/ui/motion.smoke.mjs` focuses on the electric voice surface. It uses the same
Playwright and screenshot environment variables, exercises the built panel and dot,
and establishes a local synthetic WebRTC call using the production voice connection.
It checks measured microphone and playback levels, muted and stopped audio, caption
layout, reduced motion, WebGL context loss, and the Canvas fallback. Chromium is
launched with audio output muted. It requires no microphone, account, or network service.

`node test/ui/window-hover.smoke.mjs` checks the real Electron window manager,
preload and renderer with isolated temporary user data. Playwright supplies pointer
events and matching controlled screen coordinates, so desktop mouse movement does
not interfere. It checks repeated hover/leave handoffs in both directions, delayed
blur, painted attention frames across closing, rapid re-entry, Escape and pinning.
It uses the same Playwright and screenshot environment variables, starts no provider
or hook services, and does not restart the regular app.
