`THREADLIGHT_UI_FOCUS=source-review` checks the Explain this file action, pinned discussion selection,
reader progress and keyboard line navigation using disposable managed attachments and synthetic provider output.

`THREADLIGHT_UI_FOCUS=provider-settings` checks compact public-provider All/subset/none
selection, separate chat choices, legacy header synchronization, Kimi hidden even for saved development preferences and
configuration retention, failed saves and reload using synthetic IPC.

`THREADLIGHT_UI_FOCUS=screen-region-settings` checks both independent capture
switches, all four combinations and the persisted outside-reply speech setting.
`THREADLIGHT_UI_FOCUS=thread-attention` checks the pending card at the live end
of a single reader, its height limit, scroll-up history, reopening and resolution.

`THREADLIGHT_UI_FOCUS=account-chat-replies` checks both providers in Active, open
conversation polling, retained history/drafts, shared composers, acknowledged
delivery and uncertainty recovery without automatic resend. Uses synthetic IPC.
It also checks formatted answers for both providers, narrow tables, visible language-labelled code,
Perplexity sources/steps/follow-ups, keyboard disclosure controls, retained open
sections during polling, safe link targets and inert HTML/images. Suggestions fill
and focus an empty composer without sending or replacing its draft.
Delayed-send regression closes and reopens the reader before acknowledgement,
then checks the visible and saved draft cleared exactly once. Held background
reads verify stable history/Send controls and queued explicit actions; composer
width and the shared history boundary are checked at the narrow panel size.

`THREADLIGHT_UI_FOCUS=pinned-active` checks the wire context menu and keyboard pinning,
saved pin choice, live status, page/draft retention, main-view wire behavior, footer
ordering, dual layout, small-panel scrolling, empty Active and failed settings saves.
It opens a pinned Smart Thread by keyboard beneath Agent and verifies that page content
and drafts remain visible while the reader is open and after Back collapses it.
It uses synthetic provider IPC and the actual renderer; settings persistence is
also covered by `test/settings.test.ts` with a disposable store.

`THREADLIGHT_UI_FOCUS=voice-mode` uses generated audio to check that a thread
composer takes over the mic and the same connected Live peer receives silence,
then receives audio again after transcription. `THREADLIGHT_UI_FOCUS=mic-indicator`
checks the red muted indicator and both controls on the floating waveform.

`THREADLIGHT_UI_FOCUS=handoffs-canvas` exercises the actual renderer with isolated
multi-objective assignments, both provider chats, submitted/accepted/blocked/waiting/
unknown states, empty and 119-node views, explicit project isolation, live updates,
search/attention/collapse, drag/wheel/Shift/Ctrl and keyboard navigation, pinned
output and prepared discussion navigation, plus Handoffs/Workflow expand/restore.
Uses synthetic IPC and disposable Memory/Spaces stores, never Electron or live chats.
`test/handoffs.test.ts` checks projection and pointer-anchored math;
`test/windows.test.ts` checks native geometry with mocked Electron.

`THREADLIGHT_UI_FOCUS=notes-purpose` checks both provider saver labels, plugin note
projection into Notes, live updates and reload, immutable Markdown paths and no
implicit dispatch. It uses authenticated isolated enrollment fixtures with the real
Memory/Spaces services; `test/memoryPlugins.test.ts` separately exercises both actual
packaged stdio interfaces. No regular app or live provider chat is used.

# Provider UI smoke test

`THREADLIGHT_UI_FOCUS=agent-continuous` checks continuous messages, ordered card
anchors, keyboard access to Audio received, safe formatted replies, copying, retained
drafts, source-line stability, resizing, read-only history and source routing. Provider IPC is synthetic; no live messages are sent.

`THREADLIGHT_UI_FOCUS=agent-decision` checks readable provider-chat decision cards,
content-sized Allow/Deny controls, keyboard access to long details, and keeping a
pending card visible when later Agent replies arrive. Uses synthetic provider IPC
and never accepts a real provider action.

`THREADLIGHT_UI_FOCUS=thread-copy` checks the shared Copy context menu on selected
Smart Thread text for both providers: exact emoji and indented code, captured
selection across menu focus changes, Shift+F10/Enter, Escape/focus recovery,
menu bounds and no Copy action without a selection. It also checks expanded Python
cards, coloured tokens, exact block copying and a separate recorded file link for
both providers. Uses synthetic provider IPC.

`THREADLIGHT_UI_FOCUS=account-chats` checks the saved All/Chat/Code & Computer
filter, ordinary provider-colored rows, activity/workspace matching, read-only
conversation display and history order, retained views across filter changes,
plain-text handling, empty/busy/error states, keyboard access, contextual older-chat
loading and error-only connection recovery in Settings.
It uses synthetic IPC and the actual renderer. The separate
`node test/live/account-chats.proof.cjs` uses production read-only adapters and a
real current Codex context; it records counts and capabilities, never chat bodies.

`THREADLIGHT_UI_FOCUS=workflow-graph` checks the actual compact/expanded editor with
disposable stores: draft/save, selection retention, keyboard removal, explicit
authorization, no execution from editing, and retained failed runs in Handoffs.
`THREADLIGHT_CHROMIUM` optionally selects an already-installed headless Chromium
executable; no Electron app or provider is launched.

`THREADLIGHT_UI_FOCUS=notes-composer` checks the shared compact Notes input,
Shift+Enter, drafts across tabs, failed-save retry, Enter/button saves, dictation,
first-sentence titles, single-line fading, right-click and keyboard Rename/Discuss,
Escape cancellation, body preservation and persistence after reload.
It verifies the actual note Markdown snapshot and
that saving starts no Agent. Voice input and provider IPC are synthetic.

`THREADLIGHT_UI_FOCUS=thread-timeline` includes the multiline Smart Thread composer
regression: one through eight lines, wrapped drafts, stable focus and live position,
the four-line height cap, Shift+Enter editing, keyboard clearing and Enter sending.
It also checks intentional history scrolling and returning to the retained draft.
These checks use the actual renderer with synthetic provider IPC.

`THREADLIGHT_UI_FOCUS=workspace-scope` checks the shared Active/Recent/Workspace
folder filter, limits after filtering, exact worktree and drive isolation,
explicit All drives, provider switches and a saved empty folder after reload.
It uses synthetic snapshots with selected chats absent from global Recent.

`THREADLIGHT_UI_FOCUS=change-workflow` connects the actual renderer to the real
guided-change service using a disposable Git repository. It checks thread-diff
entry, explicit selection, candidate preview, validation, local commit creation,
source HEAD/index preservation, Teach/Off footer behavior and saved Teach settings.
It never commits to the application checkout or a user's project.

`THREADLIGHT_UI_FOCUS=managed-questions` exercises saved decision cards using the
real communication service with synthetic IPC: exact thread placement, typed
answers, retry operation identity, cancellation, and native Codex fallback.

`THREADLIGHT_UI_FOCUS=compaction` verifies that compaction replaces the old progress
text in the thread row and expanded Now section, clears on resumed work, and uses
the same row height. `test/compaction.test.ts` exercises the native Codex SQLite
start/completion metadata, current-turn isolation and interrupted/stopped sessions.

`THREADLIGHT_UI_FOCUS=view-cache` switches Active, Recent and Workspace repeatedly
with artifact discovery deliberately stalled. Both provider rows must stay available
without artifact bars or reserved space. The context-menu viewer must show cached
artifacts and live updates; snapshot reads must not restart and pending catalog
requests must be shared across remounts.

`THREADLIGHT_UI_FOCUS=input-navigation` checks native/DOM mouse Back and Forward,
existing Back retaining Forward, new-route truncation, earlier Agent reading across
page closure, nested Shared Spaces forms, and Active peek preserving an unsent draft.
It also checks the wire button returning from nested pages, Settings, Agent and the
workspace picker to each main view, preserving wire state, folder scope, dual layout
and Agent drafts, with wire toggling retained on the main views.
The isolated Electron window-hover check also runs the real modifier poller with
controlled key states, verifies hidden native windows and click-through, release
order, focus behavior, restoration of an existing page and Windows app commands.

`THREADLIGHT_UI_FOCUS=artifacts` checks the thread context-menu entry and square
viewer navigation chips (click, keyboard, wraparound, overflow and single-file state),
Left/Right artifact shortcuts (including focused HTML, with editing/slider keys preserved),
image/text/static-HTML viewer, thread isolation, Back/Escape, load failures and
blocked HTML scripts and external images, plus compact thread rows with no artifact
bars and the Artifacts context-menu action. `THREADLIGHT_UI_FOCUS=badges` checks that Needs your input occupies
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
It covers independent lanes, tracing, expansion/collapse returning to pointer tracing,
keyboard focus, stationary-pointer scrolling, scroll clipping, membership changes,
singletons, the common toggle, nested Workspace rows, provider filtering and animated
and reduced-motion layout changes. `panel-layout` retains the broader dual layout checks;
`visual-updates` retains the single-column wire regression checks.

`THREADLIGHT_UI_FOCUS=panel-motion` samples intermediate row positions in 140-thread
Recent and Workspace lists, at the top, middle and bottom of the scroll area. It
checks split/merge motion, retained rows during card growth, bounded animation work,
rapid reversals and reduced motion. Optional screenshots capture the moving rows.

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
layout, amplified quiet speech, bass/mid/treble sweeps through the actual GPT Live
hook, provider-colored playback and its fade back to silence, reduced motion,
WebGL context loss, and the Canvas fallback. Chromium is
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

`THREADLIGHT_UI_FOCUS=spaces-recovery` covers failed initial list recovery and a
late failure after a successful snapshot. `node test/ui/startup.smoke.mjs` uses
hidden native windows, a private build copy, verified fixture/dependency paths,
and log-only fatal errors to check delayed backend registration and first-load
Codex usage with wires off and on. It does not restart the regular app.

`THREADLIGHT_UI_FOCUS=connection-setup` also checks two real isolated project
requests: each Chats count/list shows only its target, review names that project,
and approval preserves its stable ID. Backend tamper and both packaged-provider
contracts are covered in `test/memoryPlugins.test.ts`.
`THREADLIGHT_UI_FOCUS=communication-roles` checks shared workflow role discovery,
ordinary-chat selection, native-model preservation, unsupported authority controls
and selection retention after saving. Uses synthetic IPC and no provider sends.
