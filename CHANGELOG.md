# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Required explicit human answers for native question cards; option mentions,
  negated choices and ambiguous alternatives no longer count as selections.
  Codex card answers also require the panel's main frame as their IPC caller.

- Added persistent cross-provider communication tools, project DM history, correlated replies,
  native request routing and workflow scheduling with dependency, model, workspace and budget gates.
  Added backup/recovery and uncertain-delivery reconciliation. The tested Codex idle resume is
  admitted; Claude wakeup remains disabled after its concurrent-writer proof failed. See
  [validation and supported paths](THREAD-COMMUNICATION-VALIDATION.md).

- Buffered GPT Live speech during hotkey-triggered connection setup, with parallel microphone
  startup, ordered playback and cancellation cleanup. No standby connection is opened.

- Added an explicit Local STT / GPT Live voice switch. Local speech stays in transcription;
  GPT Live uses native audio from the first turn, independently of local send targets and push-to-talk preferences.

- Narrowed the panel from 342 to 300 pixels and halved thread-row vertical padding.

- Added named-chat discovery and fresh read-only answers across enabled Claude and
  Codex chats, with ambiguity handling and inspectable source details in Agent history.

- Removed worktree-count and behind-main text from expanded thread details,
  retaining the branch, folder path and existing links.

- Workspace fills the display's usable height by default. Hovering the usage bars
  reveals a height grip; picked heights persist for Workspace across restarts and
  clamp to smaller displays. Other views keep their content-sized layout.

- Muted the hollow thread scrollbar's outline and hover/focus colours to match the panel.

- Context circles now spin throughout active work, including tools and replies,
  then stop on idle. Removed the flashing red row dot; measured context fill and
  colour remain unchanged, with a neutral ring when context is unavailable.

- Added compact −count+ controls beside Recent, linked to the Sessions listed
  setting. Other views retain their existing thread totals.

- Layered worktree wires by measured vertical span: longest closest to the panel,
  shorter overlapping wires farther out, and separate groups back at the closest lane.

- Stabilised thread order during messages, tool progress and permission pauses.
  Threads now reorder when their task finishes and goes idle, across both providers
  and Recent/Active/Workspace lists, while live activity details keep updating.

- Made the thread scrollbar track transparent and its thumb outline-only, overlaid
  on the rows so provider gradients continue underneath it.

- Corrected the thread context menu to open Worktree diff, including all current
  changes in its checkout. Row badges and checklist links keep their thread-specific diffs.

- Restored the compact 300px panel and 6px between adjacent thread contents.
  Moved Git ahead/behind counts to the second row. Last active now appears after
  a one-second stationary hover, with a date for activity at least 24 hours old.

- Connected same-folder/worktree threads with traceable wires in a 16px transparent
  gutter outside the panel. Hover, focus or click highlights a workspace's route.
  The first wire stays four pixels from the card. Wires default off; a sparking
  U-clip beside the header toggles them and remembers the choice.
- Added the provider-coloured pool, drop and taskbar splash while minimised when
  a listed thread needs input. Opening the panel or capturing voice stops it;
  reduced motion holds a steady wheel and bead.

- Applied the vibrant Claude-orange active wheel and glossy Codex-blue outward
  shine to the application dot and connected header.

- Thread badges and diff viewers now use each Claude/Codex chat's own recorded
  changes. Repeated edits combine where supported; incomplete histories are
  labelled explicitly. Workspace Git totals no longer substitute for thread diffs.

- Connected the Agent's orange wheel at the left end of the divider to a richer
  voice ribbon that stretches rightward, with smoothly evolving colours.

- Preserved the conversation E2E observer and its cleanup check, with portable
  paths and conversation evidence stored outside the repository.

- Moved the Agent's inactive microphone text beside its status, such as
  "Ready - No active Mic", clearing it from the header.

- Reused the context wheel for thread thinking animation, preserving its recorded
  fill, colour and tooltip and removing the separate status-line spinner.

- Codex chats discover Git badges from structured repository activity and attached
  worktrees, and display linked PR badges when remote status is unavailable.

- Both + Workspace interleaves Claude and Codex chats by latest activity, newest
  first, while keeping side threads beneath their parent.

- Aligned status text with and without a branch icon; only a numbered branch badge
  adds extra indentation.

- Moved thread ages and background task timers to the lower-right of each row,
  leaving more room for titles and stats above.

- Kept nested thread gradients flush with the panel edge at every depth while
  preserving thread indentation and guide lines.

- Removed the redundant microphone-on label; an inactive microphone now shows
  "no active Mic" in the header.

- Preserved the new resting-light idle design preview with a warm centre, blue
  halo, gentle breathing and steady reduced-motion mode.

- Fixed Both + Workspace matching across ordinary and extended Windows drive/UNC
  paths; Shared Spaces uses the same folder comparison and drive grouping.
- Preserved the latest vibrant orange active-wheel and glossy blue-shine preview.

- Compacted the Agent's empty voice/chat area and removed its usage instructions.
  Microphone status now sits on the header's left; back arrows sit on the right
  across all panel pages, with titles still centered.

- Shared Spaces setup fits its content, explains the project and document location,
  and offers a drive filter beside the Workspace label.

- Preserved the outward-shine and provider-coloured liquid/drip/splash design
  previews with portable launch scripts and physics/browser verification.

- Agent footer provider, model and effort labels now open their setting menus, using
  the same model catalog and model-specific effort defaults as Settings.

- Centered the Agent footer labels vertically with even space above and below.

- Extended the header waveform to both panel edges, including its quiet resting state.

- Double-clicking the header now toggles pinning without changing the selected view.
  Removed triple-click pinning and its delay; switching views keeps the panel pinned.

- Grouped the application and workspace controls beside the view/count label on the
  left of the toolbar, separated by a subtle divider.

- Added a pale outward shine along the thinking wheel's strands, with a static
  reduced-motion state.

- Moved the Agent provider, model and reasoning label to a compact bottom-right footer
  alongside Earlier.

- Moved the voice waveform onto the light strip beneath the header across Agent and
  thread views, replacing the original microphone glow and removing the large central
  animation area. The bottom usage bar remains visible.

- Enlarged the resting floating waveform and slimmed the live microphone pill from
  32px to 18px tall, with a smaller stop control.

### Added

- Shared Spaces now requires workspace setup with fixed `ideas`, `plans`, `handoffs`
  and `results` folders under the workspace's `shared-spaces` directory. Workspace
  view follows the selected workspace. Stable ownership, readable versioned snapshots,
  explicit migration previews and main-process execution checks keep work isolated
  and preserve existing documents and older unassigned material.

- Shared Spaces now has Handoffs, Ideas and Brainstorm tabs beneath one header and
  one Back button. Ideas persist locally; per-idea Agent discussions lead to editable
  mini plans and explicit Claude/Codex task choices. Preparation atomically saves a
  pinned plan and unsent assignments for review through the existing delivery system.
  Provider memory stays with its provider; shared material supports collaboration.

- Electric voice ribbons follow microphone input and audible native Agent playback. The same
  filaments form an amber Catherine wheel during work, with a stable caption area, compact
  dot and microphone-pill versions, reduced motion, and a Canvas fallback when WebGL is unavailable.

- Claude and Codex plugins now teach shared-memory workflows and bundle scoped MCP
  tools. Chats request a verification code; the compact Agent access view approves
  folder scope and permissions without copying credentials. Explicit per-chat
  connection IDs, briefings, expiry, revocation and restart recovery keep access
  bounded. Existing lifecycle hooks and background assignment credentials remain.

- Agent shows when an existing conversation differs from the saved provider/model,
  with a Use selected model action. Ended conversations display the selection for
  the next message while retaining their history.

- Shared memory in the existing compact panel: spaces, folder map/list, versioned notes,
  decisions, scratchpads, managed images/documents, discussion, search, provenance and
  SQLite backup/restore. Agent-created folders appear without moving the current view.
- Authenticated local MCP tools with scoped, revocable capabilities for Claude and Codex.
  Delegations pin input and output revisions, use temporary assignment credentials and
  the existing background relays, and require separate human acceptance of saved results.
  Durable budgets, subscriptions, pause, causal loop checks and uncertain-delivery recovery
  bound automatic coordination. Native provider memory and global settings are unchanged.
- Composer drafts now survive normal restarts in Threadlight's own recovery store.
  Conflicting or failed saves preserve the visible text and report the problem.
- Live Codex chats show an explicit **Copy and open Codex** action and explain that
  desktop sending is not connected. Enter and voice countdowns never invoke that
  fallback automatically. Background desktop sending remains incomplete.

- Codex Agent conversations archive on End, inactivity expiry and normal app exit,
  while remaining readable in Agent → Earlier. Continue restores the original thread.
  Archive failures retain a cleanup marker for retry. The dedicated Agent workspace
  stays out of monitored workspace lists even before a new thread ID is registered.
  Live integration tests wait for retirement; discovery-only test threads are ephemeral.

- The hosted Agent can use Claude or any eligible text model in the installed Codex
  runtime's catalog, independently of chat monitoring. Codex adds dynamic model and
  reasoning selection, streamed replies, queued approval and question cards, Stop,
  provider-aware history and exact-thread continuation. Conversations retain their
  model and app choices. Uncertain sends are journaled without automatic replay;
  configured MCP tools require explicit permission, while unverified desktop-only
  integrations remain unavailable.

- Settings has a centred header title and slightly tighter row and help-text spacing.

- Codex workspace labels hide Windows long-path prefixes. Verified database turn states
  no longer say "state guessed"; missing or stale state information is labelled unavailable.

- Codex thread summaries show the actual request after attachment metadata, use agent
  progress updates for Now, and remove markdown/image-path clutter from replies. Tool-only
  activity has readable labels, and a new turn no longer presents the previous reply as current work.

- Thread provider edge tints are half as wide and continue through expanded details and cards.

- Codex question cards use numbered selectable choices, a custom-response field,
  question paging and compact actions. Picks and drafts stay with their chat when
  collapsed or hidden; Copy & open prepares the answer for completion in Codex.

- The header divider glows while the microphone is open, with steady illuminated ends
  and a centre glow that expands with speech. Agent commands use Claude orange;
  composer dictation follows its chat destination, including Codex blue. Reduced-motion
  mode varies brightness without stretching the line.

- The recording waveform fills the available composer input width and scrolls smoothly
  with real mic levels. Existing drafts stay visible above it; reduced-motion mode
  keeps the level display stationary.

- A subtle downward fade from the composer's top divider matches its destination: orange for
  Claude and blue for Codex, including when only one application is enabled.
  It replaces the composer provider tags, and the send arrow stays hidden until there is text.

- Codex plan presentation: current numbered steps, formatted proposed plans and plans
  retained above waiting cards. A parallel blue weekly usage bar reads local quota
  reports, with independent hover details, observation time and an unavailable state.

- Independent Claude and Codex toggles: enable both for a combined activity list
  with subtle blue Codex and orange Claude right-edge tints, or disable both to pause
  monitoring. Existing selections migrate unchanged. Workspace groups and saved choices stay separate; drafts remain
  chat-scoped, disabled applications release held cards, and sends keep their exact target.
  The panel header is thinner, with the excess gap below expanded thread details removed.

- Codex provider: separate hook plugin and read-only session/database tracking,
  background `codex exec resume` for unloaded chats, writer-lock detection and
  copy-and-open for live chats. Permission and Stop cards can be held and answered;
  native question cards use copy-and-open. Settings switches the list, workspaces
  and composer between Claude and Codex, preserving chat drafts in memory.
  See `codex-plugin/README.md` for installation and compatibility limits.

- Project scaffold: Electron, TypeScript (strict), React, electron-vite, ESLint,
  Prettier, Vitest and Windows CI.
- Status dot window (always on top, transparent, not in the taskbar).
- Sessions core: reads transcripts and Claude app thread records, replays task plans,
  detects stopped (interrupted) sessions, and merges hook state into one session list.
- The dot shows live state (pulses red while a session works), can be dragged (position
  is remembered) and only appears while the Claude desktop app is running.
- Clicking the dot opens the panel in its place: active sessions first, recent ones a
  click away, each expandable to its plan, current step and last result. Clicking
  anywhere else, or Esc, turns it back into the dot.
- Right-click a session for "Open in Claude".
- Claude Code plugin (`.claude-plugin/`, `hooks/hooks.json`) whose hooks report session
  activity to Threadlight's local endpoint on `127.0.0.1:47615`, so working / waiting /
  idle is exact. The hook command runs unchanged in Git Bash, Windows PowerShell and
  PowerShell 7, and always exits cleanly when Threadlight is not running.
- The endpoint only accepts session-state events and refuses anything a web page could
  send (requests with an Origin or Referer header, or a non-local Host).
- Right-click a session → Compose to message it in the background, without opening the
  Claude window. The message goes to your own `claude` CLI (`--resume … -p`) as a single
  argument, never through a shell, using the session's own folder, permission mode and
  model from Threadlight's scan (the UI only supplies the session id and text).
  ✓ Sent when it is delivered, ✓✓ Read when the session replies; the reply shows on the
  row for two minutes. Threads the Claude app holds open are refused, and only one
  message per thread can be in flight.

- Voice, transcribed on your PC with Whisper (base.en, about 76 MB, downloaded once and
  only after you agree). It runs in its own background process, so the app never freezes.
  A 5-second message takes about 1.5–2 seconds to transcribe on a typical CPU.
- A mic button in the composer: click to talk, click again and the words land in the box.
  The microphone is only open while recording, and Threadlight's windows may use nothing
  but the microphone (camera, screen, location and the rest are refused).
- The talk hotkey, Ctrl+Alt+Q (press to start, press again to stop). Say
  "message <thread>, <what to say>": Threadlight finds the thread, opens the panel without
  taking focus from a game, counts down 3 seconds (press the hotkey again or × to cancel),
  sends, and turns back into the dot once the thread has replied. If no thread clearly
  matches, it never guesses: it asks you to pick one. While it listens the dot turns blue;
  while it transcribes it shows a spinner. If another app already owns the hotkey,
  Threadlight says so in the panel.

- Settings, inside the panel itself: the gear in the header (or Settings in the tray) turns
  the card into one compact list, and ‹ goes back. Changes save and apply at once. You can
  set the talk hotkey (click it and press the keys; plain letters and keys another app
  already owns are refused, and the old hotkey keeps working), the voice send countdown
  (1–10 s, never zero), whether the dot opens the panel on hover or only on click, how far
  back sessions are listed and how many, launch at sign-in, and reset the dot's position.
  A message you were typing survives a trip into Settings.
- A tray icon with Show sessions, Settings, Pause talk hotkey and Quit.
- Header clicks on its bare space: double-click pins the active list open, threads and all
  (a pin shows before "Active"); triple-click pins the full recent list open (a pin icon then takes the
  place of the count, next to "recent") until you triple-click again or click the pin or
  the word. Dragging the bare header moves the panel and
  its dot.
- The full list can show your workspaces (Settings → "Full list shows"): Recent (the most
  recent threads, as before), Workspace (every thread in the workspace you last had open
  in Claude), or All (every workspace as a collapsible group, like the Claude sidebar,
  with the current one open). Threads look exactly as in the recent list, side threads
  nest under the thread that started them, and big workspaces show their newest threads
  with "Show N more". Only threads you can see have their transcripts read. "Show
  sessions from the last" filters all three; an older thread stays when a side thread
  under it is recent.
- Choosing Workspace in Settings opens a picker of every workspace (plus "Follow Claude",
  the default); picking one goes straight to its threads, and tapping the workspace name
  in the list reopens the picker. An empty list says "Nothing within your chosen time
  frame" and names the window.
- The talk hotkey can be Toggle (press to talk, press again to send) or Push to talk
  (talk while held, send when you let go), chosen next to the hotkey in Settings.
  Push to talk checks only the hotkey's own key, and only while it is held.
- Setup: `scripts/install.mjs` installs from a checkout (packages, build, the Claude Code
  plugin, settings, dot corner, start at sign-in), with `--check`, `--check-keys` and
  `--uninstall`. It records what it adds and uninstalls only that. The setup skill
  (`skills/setup/SKILL.md`) walks someone through it with Claude: what will change, their
  choices, sign-in and a final check. The hook server answers `GET /status` (running, and
  how many hook events arrived) for the check.
- The expanded thread's Now line shows how long the current turn has been going, from
  the prompt until it finishes ("Reading hookServer.ts 41s"). It counts from the same
  moment as the Claude app's own timer (the thread record's turn start), or from the
  prompt's time for sessions the app does not track.
- Agent settings: how long a conversation lasts after its last reply (10 min, 1 h, 4 h or
  until ended; then the next message starts a fresh one, the old one kept readable), the
  worker's model (Opus or Sonnet), a switch for each connected app Claude Code sees (off: the
  agent cannot use it at all).
- The task timer also counts a command while it runs in the foreground, as the Claude app's
  Background tasks list now does; it drops off when the command finishes.
- A turn without a plan shows what it is doing: Thinking, with the turning ring, then its
  reply as it is written. Each new message clears the last turn's step, so the row no longer
  shows activity from a few messages back. Long row lines fade out before the icons instead
  of ending in "…", and an open thread shows its whole last reply, scrolling.
- The Agent view keeps its history: past conversations sit under a collapsed "Earlier"
  row, newest first, each opening read-only with Continue to pick it up again (Claude Code
  resumes the same transcript). The agent's conversations never show in the thread list.
- Settings, Agent, Changes and the workspace picker put "‹ Title" on the right of the header,
  where the button that opens them is. The agent no longer shows a running cost, and while it
  works on another page its ✦ button turns purple with a blue shimmer about once a second.
- The agent knows your threads: each question carries a briefing of what Threadlight shows
  (titles, states, folders, git numbers, current steps), which the front desk answers from
  when it can. In the threads' own folders it may read files and run read-only git (one plain
  status, log, diff or show command with -C) without asking; anything chained, piped or
  redirected, and anything that changes things, still asks.
- Agent (spike): the ✦ button opens a conversation Threadlight hosts itself, running the user's
  own Claude Code on a two-way stream (as the Claude app does). Steps and replies show live;
  reading tools (an integration's search, get, list…) run at once, while anything that sends,
  deletes or changes things waits on an Allow / Deny card; a follow-up continues the same
  conversation, and End closes it (its transcript stays on disk). It works in its own folder
  and can use the user's claude.ai connectors (Gmail, Calendar, Drive…). The conversation runs
  on Haiku, which hands anything that needs looking up or doing to an Opus worker (a Claude
  Code subagent) and waits for its report; the worker's steps show as they happen, and its
  tool calls still ask for approval.
- A next-step card answers whichever way can reach the thread: handed back while Threadlight
  holds the turn's end; for a thread Claude has open but nothing held (started before the
  plugin's Stop hook), Copy and open puts the answer on the clipboard and opens the thread to
  paste; otherwise sent in the background. Its "✓ Sent" now follows the real send, and a
  refused send unlocks the card with the reason. Threads Claude Code has open are read from
  its own register of live sessions.
- The Active list leaves out each thread's age: everything there is happening now.
- Hovering a thread's git numbers says it in one line, in Threadlight's own style ("main · 16
  files changed (5 new), +1.7k −30 uncommitted"); clicking them opens the Changes view in the
  panel: each changed file with a new / edit / gone tag, its folder and its counts, and one
  file's diff open at a time (numbered lines, removed in red, added in green), fetched only
  when opened; a binary or very long file offers Open ↗ instead. Read-only, and only files
  among that thread's changes can be read or opened.
- Each thread shows where its git folder stands beside its title, only what is not zero:
  "+22 −1" changed since the last commit (as Claude shows it), "↑2" commits to push (ahead
  of its upstream, or of main if never pushed) and "↓5" commits behind the local main. The
  tooltip says it in full, and an expanded thread has a line for it: branch · to push ·
  behind main · worktrees. A workspace header counts its worktrees, in place of its thread
  count (the panel's header already gives that). A thread's git folder is
  the worktree the Claude app made for it, else the folder of the last file it touched
  inside its working folder, else that folder. Counted in the background, at most every 5 s;
  nothing is fetched from the network.
- Next steps can be answered here too: when a turn ends on a question, the plugin's Stop hook
  waits and Threadlight shows the card with a countdown. Send hands back the picked answer,
  and Other your own words, and the same turn carries on with it. Threadlight lets go on the
  same rules as question cards.
- A card answered from Threadlight locks at once ("✓ Sent") so it cannot be sent twice, and a
  next-step box a Stop hook has answered (recorded as "Stop hook feedback") no longer shows.
- Fixed: sending in the background could start a second Claude Code process on a thread the
  Claude app had open, because the app's processes no longer name their session on the
  command line. The check now reads Claude Code's own registry of live sessions
  (`~/.claude/sessions`) as well, and refuses such a send.
- Each thread's dot has a context ring like the Claude app's: it fills clockwise as the
  thread's context fills, grey, then amber from 60% and red from 80%, and stands on its own
  where an idle thread has no dot. Hovering shows "Context 52%". It counts the latest
  reply's input and cache tokens against the model's window (1M; 200k for older models),
  which matches the app's own figure.
- Idle threads no longer show a green dot; only working (red) and waiting (amber) threads do.
- The plan step in progress spins, as in Claude's own task list (still with reduced motion).
- A thread that has just gone idle stays in the Active list for 30 seconds, so its reply can
  be read; the thread the composer is open on stays for as long as the composer is open.
- Threads waiting on you say "Needs your input" beside their age (a long title fades out
  behind it), with Claude's amber double circle for a dot and the question on the line
  below. Expanded, they show only a card drawn like Claude's own question card: the
  question on top, radio rows with the recommended answer picked, Other, then the buttons
  (Ctrl+Enter presses the main one).
  - A next-step box (the question a finished turn asks) shows each answer with the message
    it sends; Send puts the picked one into the thread, Other opens the composer, and an
    app action (commit, open a PR) opens the thread in Claude.
  - A question card has "‹ 1 of 2 ›", Skip and Next, and can be answered right here: the
    plugin's question-card hook hands the card to Threadlight and waits, Threadlight collects
    your pick for every question (Other has a text box), and Submit gives them to the session
    as its real answer. Claude's own card is held back meanwhile, so Threadlight lets it go at
    once when it is closed, when you open the thread in Claude (or Claude is in front showing
    it), when you press Answer in Claude, or after 60 seconds. A tool waiting for approval
    still opens the thread in Claude.
- An expanded thread shows Open ↗ on its title line, in place of the age, and its workspace
  folder on the status line where Open used to be.
- Background tasks: while a thread has a background command or agent running, its age
  becomes "Task 42s" (counting up) or "Tasks ×3". Hovering lists each task and how long it
  has been running. A task counts until its completion notice reaches the transcript, it is
  stopped, or 12 hours pass.
- Hold, next to the send countdown, keeps a spoken message in the composer until you click
  Send; the countdown greys out while it is on. The countdown now defaults to 5 seconds.
- The panel can now grow to the full height of the screen from wherever the dot is.
- Threads with pull requests show the Claude sidebar's branch icon, coloured by the
  latest PR's state, with a count when there are several.
- Settings are stored in `%APPDATA%\Threadlight\settings.json`; a damaged or partly
  invalid file falls back to defaults field by field, never losing the rest.
- A usage bar, 2px, along the panel's foot: the 5-hour limit on the Active list and open
  threads, the weekly limit while the full list is open; hovering it shows both, with when
  each resets. The numbers come from the agent's runs, or else from a one-word Haiku check
  (no tools, settings or saved session; about a thousand tokens) at most every five
  minutes while the panel is open.
- Every card a thread waits on can be answered from Threadlight (plugin 0.0.3, for threads
  started after it is installed). Approvals, a plan to approve included, are held through a
  PermissionRequest hook and get Allow or Deny (with an optional reason). New session / Do
  it here offers are held before Claude shows them, and the choice goes back to the thread,
  which starts the session or does the work itself. A next-step box's app buttons (Commit,
  Open PR…) ask the thread to do that itself.
- A thread's plan steps can be clicked to see what was done on each: how long it took, the
  files it edited (with lines added and removed), the commands it ran (✗ for a failed one),
  the other tools it used and what it last said. It is read from the thread's transcript, so
  it works on old threads too; a step in progress keeps up as it goes. Files changed by a
  shell command show only as that command.
- Plan steps can say which files they mean to change and why (plugin 0.0.4). While
  Threadlight runs, starting threads are asked to add "files" and "why" to each step of
  their task list. A step then shows why it is there, and its planned files next to what it
  changed: ✓ planned and changed, ○ planned but not changed, + changed without a plan. A
  step not started yet shows what it plans to touch.
- Open mic, a variant of the Toggle talk mode (Settings → Open mic). The talk hotkey or
  the mic button opens a live mic that stays open until pressed again; the dot wears a
  blue ring and a mic button in the panel's header glows (and closes it). Speech is found
  on the PC by loudness against the room (BLAM8's rules: the room level learned only in
  quiet, speech at 4× the room and 0.06 peak, 600 ms lead-in, 500 ms to end), transcribed
  with the local Whisper, and joined into one sentence across short pauses. Its first
  command: "open", then a one-second pause, opens the full list pinned without taking
  focus; "open" followed by more words is not a command.
- The "Which thread" box after a voice message says to click a thread, has a × to
  discard it, and scrolls a long transcript instead of filling the panel.
- Long recordings are transcribed in 30-second chunks, and a phrase Whisper gets stuck
  repeating is cut back to one.
- Right-click the header's list button (recent, workspace or all) to switch the full list
  to one of the other kinds, without going into Settings.

### Changed

- Voice target now selects Agent conversation or Thread message independently of Toggle /
  Push to talk. Countdown and Hold apply to thread messages. Closing Agent voice releases
  the microphone without ending its conversation; reopening continues the same Agent.

- Agent settings combine provider and reasoning on one row and remove model search and refresh controls.

- Removed the application-selection, Codex plugin and model-selection explanatory copy from Settings.

- The workspace picker header uses a centered title and left-hand back arrow, matching Settings and Agent.

- Thread toolbar separates view, application and workspace controls. Click the view label
  to cycle Active, Recent and Workspace; right-click it for direct choices including All.
  Application filtering shares the Settings selection, and the workspace name opens its
  picker. The duplicate workspace heading and toolbar microphone button are removed;
  the open-mic hotkey remains available.

- Thread edge glows are half as wide (10 px) and mirrored on both sides.

- Expanded thread details show elapsed turn time beside NOW, above the current action.

- Thread context hovers use the panel's styled tooltips instead of native system boxes.
  Provider-name bubbles have been removed from thread rows.

- Hide Connected apps from Agent settings for both providers and stop discovering
  apps when opening settings. Existing integration policies and preferences remain intact.

- A held card no longer lets go after a minute: it waits until it is answered here, or let
  go when the thread is opened in Claude or Threadlight quits (12 hours at most).

### Fixed

- All page headers use a centered title and left-hand back arrow, including Changes
  and Shared Spaces. Long titles truncate before reaching the navigation controls.

- Checklist file counters now show an immediate hover summary and toggle the shared
  file diff viewer, with keyboard support and clear feedback for unavailable diffs.

- Codex history scans use the native item-type column and yield between threads so
  long conversations do not block panel hover, leave and blur events. Duplicate hover
  messages are ignored, including delayed requests after the pointer has left the dot.

- Hover-opening and leaving the panel are immediate. Native cursor checks reject stale
  leave/open events and cover missing browser leave events during the dot/panel handoff.

- Thread context and usage bubbles appear immediately and sit beside the pointer,
  switching sides at the window edge. Leaving, clicking or scrolling clears stale tips.

- Expanded thread lists recalculate available height while moving the panel, including
  across displays and growth directions. Borders and usage bars fit inside that limit;
  the list scrolls only when its contents exceed the available room.

- The dot is raised again whenever another window comes to the front, so full-screen apps
  and Show desktop no longer leave it hidden behind them.
- A session whose Claude Code process ended (for example after a background reply) no
  longer flips back to "working" for 30 seconds.
