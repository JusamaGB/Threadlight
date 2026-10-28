# Provider UI smoke test

`THREADLIGHT_UI_FOCUS=managed-questions` exercises saved decision cards using the
real communication service with synthetic IPC: exact thread placement, typed
answers, retry operation identity, cancellation, and native Codex fallback.

`THREADLIGHT_UI_FOCUS=compaction` verifies that compaction replaces the old progress
text in the thread row and expanded Now section, clears on resumed work, and uses
the same row height. `test/compaction.test.ts` exercises the native Codex SQLite
start/completion metadata, current-turn isolation and interrupted/stopped sessions.

`THREADLIGHT_UI_FOCUS=view-cache` switches Active, Recent and Workspace repeatedly
with artifact discovery deliberately stalled. Both provider rows and cached chips
must stay available, snapshot reads must not restart, pending catalog requests must
be shared across remounts, and live attachment events must still update the chips.

`THREADLIGHT_UI_FOCUS=input-navigation` checks native/DOM mouse Back and Forward,
existing Back retaining Forward, new-route truncation, earlier Agent reading across
page closure, nested Shared Spaces forms, and Active peek preserving an unsent draft.
The isolated Electron window-hover check also runs the real modifier poller with
controlled key states, verifies hidden native windows and click-through, release
order, focus behavior, restoration of an existing page and Windows app commands.

`THREADLIGHT_UI_FOCUS=artifacts` checks the thread context-menu entry and square
viewer navigation chips (click, keyboard, wraparound, overflow and single-file state),
Left/Right artifact shortcuts (including focused HTML, with editing/slider keys preserved),
image/text/static-HTML viewer, thread isolation, Back/Escape, load failures and
blocked HTML scripts and external images, plus the attachment line beneath the title
and Now text. `THREADLIGHT_UI_FOCUS=badges` checks that Needs your input occupies
the second line's right corner, displaces the branch tracker and task timer, and
restores them once attention clears. Storage persistence and file limits are
covered by `test/artifacts.test.ts`; provider parsing, bounded scans, replacement,
path restrictions and metadata-only linking by `test/artifactReferences.test.ts`.

After building, `node test/ui/artifacts-native.smoke.mjs` launches an isolated Electron
fixture using the real preload, IPC, discovery, storage and viewer. It checks automatic
transcript discovery without persistent copies, metadata-only linking, reading edits
via Refresh, explicit saved-copy selection and survival after source deletion/reload,
and cross-thread ID denial. It uses a temporary profile and no provider processes.
The native viewer now also exercises real inline scripts, slider input, canvas,
CSS animation, no app/Node access, blocked network/file/loopback fetches, workers,
WebRTC constructor replacement (including document replacement and blank frames),
popups, navigation fallback, guest Escape and closing a frozen guest renderer.
The browser smoke retains the static fallback checks.
Use the same `THREADLIGHT_PLAYWRIGHT` override described below. Set
`THREADLIGHT_SCREENSHOTS` to an output directory to capture the native viewer.

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

`THREADLIGHT_UI_FOCUS=wire-routing` checks dual-view Claude-only wires outside the
left edge, Codex-only wires outside the right edge, and shared wires at the centre.
It covers independent lanes, tracing, expansion, scroll clipping, membership changes,
singletons, the common toggle, nested Workspace rows, provider filtering and animated
and reduced-motion layout changes. `panel-layout` retains the broader dual layout checks;
`visual-updates` retains the single-column wire regression checks.

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
It also verifies the real dual card's native width, fitting/removal of the right
gutter as wire groups change, gutter click-through, Workspace dragging flush to the
display top, and restoration of the single-column window width.
