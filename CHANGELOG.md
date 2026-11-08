# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- VS Code Live Coach 0.6.5 shows file proposals as compact inline diffs. Removed and added lines appear together, with highlights that fade just past the code. **Result** previews the proposed lines and **Why this edit?** opens the explanation. Scrolling away and back preserves the proposal and both controls’ state.

- GPT Live can speak a short progress acknowledgment while the Agent checks the editor. Repeated events share one readout. The next proposal or answer waits for playback, and Stop or a new turn cancels queued narration.

- Agent Settings has a keyboard-accessible **Voice pace** slider. Its five choices apply to the next GPT Live call or spoken screen reply, and the setting survives restarts.

- Live Coach clears stale guide highlights quietly during typing. A known exact line edit can trigger a fresh check automatically. Natural done or next requests also check the current buffer.
- The live pill can display code from the learner’s verified delegated turn as soon as the backing answer arrives, and retain the current example when its follow-up identifies it.

- Answered Agent questions and approvals stay with the conversation that prompted them. Only pending decisions appear beneath the latest message, including when the request is on an earlier history page.

- GPT Live gives one brief connection cue after the microphone and native session are ready. Speaker mute silences it, and cancelled startup never signals success. Live Coach 0.6.2 lets native ghost text follow typing without repeatedly requesting VS Code’s inline-suggestion sound. Guide continuation still waits for the learner.

- The Agent bar uses compact icons for composing, calling, starting fresh and closing the current conversation. Toggling the reply box preserves its draft, and closed chats remain in Earlier.
- Code blocks in Agent, Smart Thread and pinned references use a two-card Copy icon with clipboard feedback. Pinned blocks copy the displayed version.
- The recent Agent shortcut uses the four-point sparkle from the November 7 artwork and retains its purple glow and waiting indicator.
- The Agent reply pencil sits beside the four live-call controls in one centered row. Settings credits Threadlight as an independent open-source project by HAAIL.
- Agent actions are centered above the transcript, and the compact resize handle leaves room for replies. Smart Thread and Agent assistant replies share a slightly larger text size.
- Agent Settings can show the latest GPT Live reply inside the waveform pill. It sizes itself to the centered spoken caption, keeping short replies compact and linked code left-aligned. It widens before unfolding and folds in reverse. Dismiss one reply with the ×. The next opens automatically.
- The collapsed live waveform reaches both rounded ends of the pill. Right-clicking the live microphone waveform or pressing Shift+F10 opens listening, playback and hang-up actions. Stop speaking appears during audible playback.
- Hovering the waveform for half a second opens the ongoing Agent or Brainstorm conversation centered on the waveform. The panel stays open under a stationary pointer after the pill has been moved. Dragging the waveform moves the pill and its attached reply. Right-click anywhere on the pill for call actions. Leaving the panel can collapse it back to the pill while the call continues. Other pages offer a compact return action.

- The compact Reply icon opens the composer, and scrolled messages fade at the reader’s upper edge. Inline code is easier to spot alongside a walkthrough; multiline Python examples retain highlighting, indentation and copy controls.

- The [Threadlight website](https://threadlight.jocosewasp4.chatgpt.site/) leads with a copyable assisted-setup prompt, Windows Git Bash and PowerShell instructions and provider and privacy FAQs. The prompt heading has a right-aligned copy icon, with the installer note centered below the prompt. The hero retains the release spiral’s blue glow. The footer credits HAAIL. Both product panels show the current development renderer. The simulated Agent call shows five controls in one row, two thread sources and a highlighted Python example. The FAQ distinguishes local Windows integrations from browser chats and describes development-only account-chat support. See the [public website claim review](docs/validation/PUBLIC-WEBSITE-CLAIMS.md).

- The Agent header has a settings gear beside Back. It opens provider, model, effort, conversation lifetime and Earlier chats. Back returns to the open conversation and its draft.

- Press Pause/Break or Ctrl+Alt+M during an Agent or Brainstorm call to toggle the microphone, including when Threadlight is hidden. Settings → Hotkeys lists the current Talk binding, contextual shortcuts and VS Code companion defaults.

- Shared Spaces can explain a selected Python, JavaScript or TypeScript attachment in plain language. File discussions follow the exact snapshot, show reading progress, and open cited source lines without editing or running the code.

- Scroll continuously through the Agent and Earlier. Expand **Audio received** for the voice details, use **Reply** or the green phone at the top to type or speak, or choose **Needs input** to reach a decision. The reader remembers its height and keeps your place as updates arrive.
- GPT Live can speak the opening of a streaming answer and then its remaining prose once. If it cannot identify the opening playback, **Read remaining** lets you request the rest. Matching captions stay under **Spoken reply** in both the current chat and Earlier. Live retains the opening microphone audio while connecting and catches up during sustained quiet pauses. Editor work keeps a visible status below the conversation and can give a brief spoken update during a long read.

- Pin reply code or a recorded text file from its header menu. The resizable reference lists independently folding snapshots by filename or snippet, with source details in the footer. The spinning logo sits over the detached reference at the matching corner. Shift+wheel scrolls code sideways and Ctrl-drag pans in either direction, including at a display edge.
- Pinned files use the reference’s full width. Drag the resize edge or focus it and use the arrow keys. Approved Agent replacements and appends create per-file versions. Browse earlier versions from the entry menu and copy the displayed version.
- Live calls have independent mic and speaker mute, a Ctrl+Alt+M mic shortcut and a control to silence the current spoken reply. The centered call controls disconnect voice while keeping the chat open. The Agent header keeps conversation actions available when the call ends. Two blue highlights on the floating waveform indicate active Agent work. The working logo stays below the reader while the Agent is busy. Earlier tool details remain expandable.
- Repeated captures of identical pixels are coalesced while queued or sending and for five seconds after delivery. Standalone Codex image chats follow the usual Agent archive lifecycle and remain accessible from Earlier.
- VS Code coaching accepts longer hints, shows a compact clickable label with the full hint on hover, and reports invalid guide fields separately from connection failures.
- Ask foreground GPT Live to review the whole active VS Code file, including unsaved changes. The read-only review follows one buffer version, checks up to 32,768 UTF-16 units and includes available editor diagnostics. If the connected window is still running an older companion without review support, Live reports zero coverage and explains how to activate the update.

- VS Code reviews give brief, line-first findings. Ask for one step at a time to start a highlighted walkthrough of the current issue. Spoken “next” and **Next step** advance it, **Finish guide** confirms completion in Live, and editing pauses the guide for a fresh read when you’re ready.
- Ask Live to show the next line to type in VS Code. Trace displays ghost text at a verified insertion point, including between existing lines or at the end of a file. Type along, indent with Tab, backspace, or dismiss with Esc. An explicit next-step request rechecks the learner’s code.
- Ask for inline diffs across the open file. Coach locates each change, shows one proposal at a time, and can explain the visible change aloud. Tab accepts one undoable edit or group. Use Alt+] to navigate or Esc to dismiss. Selected alternatives and separate read-only comparisons remain available.
- Turn on **Automatic Python suggestions** in Threadlight Settings, or ask the Agent to turn them on. Live Coach 0.6.1 starts local completions and related-edit suggestions whenever you open a trusted Python file. The preference persists across restarts. You can also follow the VS Code checkbox and optionally choose a model in VS Code.
- Screen regions can be enabled independently in Live and outside Live. The Agent follows your words and the relevant conversation when you share an image. Without a clear request, it explains an unmistakable visible issue or asks what you want help with. Outside Live, a region starts a fresh conversation with the configured Agent. Codex reads its answer in the GPT Live voice, and Claude uses Windows speech. Both leave the microphone closed. Busy Agents finish their current turn before handling queued regions.
- Smart Thread opens a needs-input card at the bottom of its normal-height reader, immediately above the composer. The first upward scroll reveals the preceding text immediately. Use Jump to live to return to the card.
- The Agent diamond reopens the most recent screen-region or foreground Live conversation. Only a current input request activates its pulse and the floating drips.
- Native Codex question cards follow confirmed answers and turn completion. Use × to dismiss a single question in Threadlight across rescans and restarts. **Stop ignoring** restores it. Revised and new cards can signal again.
- Codex GPT Live can identify the foreground Windows app for a spoken question and inspect its window on request. Hold Ctrl, right-drag to outline a region, then release Ctrl to send the image into the same Live conversation, including when you are silent.
- Code blocks in Smart Thread, Agent, ChatGPT and Perplexity replies open as language-labelled cards with syntax colouring, preserved indentation and a Copy button. Hold Ctrl and left-drag inside the code to pan horizontally or vertically. Existing Codex replies recover their formatting when reopened.
- Pinned Active threads expand in place beneath the current page. Back collapses the reader while preserving the open page and its drafts. During thread dictation, GPT Live stays connected and its floating waveform turns red. Live can hear you again when dictation ends.
- Fixed a Windows restart error when a late pointer-leave event tried to show the floating dot after its window had closed.

- GPT Live now sends the Agent’s completed answer to speech when a voice request needs tools or current information. This fixes follow-ups that displayed the answer but spoke only an acknowledgement.

- Source setup accepts Claude Code, Codex and Perplexity individually or together. On fresh Windows installations it verifies and extracts the desktop runtime using Windows tar. The source distribution includes the tray icons. Claude and Codex bundle the conversational setup skill, and Perplexity Computer users can upload its standalone Markdown version. See [Windows setup checks](docs/validation/CONVERSATIONAL-SETUP.md).

- Agent conversations use expandable request turns, keeping replies, activity, decision cards and source links together. Earlier turns show their last reply when folded; a new pending decision opens its owning turn. Replies support formatting, links, tables and collapsible code with Copy. See [validation](docs/validation/AGENT-GROUPED-TURNS-2026-11-07.md).

- The foreground Agent can request a Claude Code or ordinary Perplexity chat in a named Shared Space. The decision card shows the provider, named space, role and opening message in a readable summary, with compact approval buttons. Pending cards stay visible as Agent replies arrive. Connection failures before the opening message leave the space dispatch budget intact. Perplexity lookup in a space resolves its participants even when their titles omit the provider name.

- The floating microphone waveform opens the current panel and keeps it visible during the conversation. The square beside it has a larger Stop target and remains available while listening, even if a monitored provider window closes.
- Ctrl+Alt+Q starts or stops GPT Live for the Codex Agent even when Local STT is selected. The saved voice preference still applies to other voice controls. Live unmutes replies after the opening message is acknowledged.
- Assistant replies in Smart Thread view support text selection and copying, including emoji and code. Right-click selected conversation text for **Copy** in the usual context menu, or open it with **Shift+F10**.
- Selected chat providers are checked when the panel loads. Connection errors appear beside a red light in the bottom info area, including in Settings and Shared Spaces. Failed refreshes retain the last list.

- Fixed workflow chat discovery hiding Codex behind large Claude catalogues.
  Hosted Brainstorm now receives scoped, paged output-folder IDs and an explicit
  explanation that workflow operation limits count join and finish steps too.

- Added ordinary ChatGPT and Perplexity destinations to shared-space messaging.
  Authorized briefs use the common journal and return correlated text replies to
  the sender inbox. Native model selection is preserved. Ordinary chats do not
  gain memory tools, filesystem access or automatic sender wakeup.
  An amber Chat list warning identifies a rate-limited account-chat refresh. ChatGPT discovery checks once at startup and then at most once a minute while its list is visible. Repeated limits increase the cooldown even if an intervening refresh succeeds. A longer provider retry time takes precedence.

- Sanitised published Git history to remove personal author email, native chat
  identifiers and local-only screenshots/build artifacts. Existing clones need
  [the history-cleanup guidance](docs/security/HISTORY-CLEANUP.md) before pushing.

- Prepared the 0.1.0-alpha.1 Windows source preview: Kimi setup and its provider
  choice are hidden while development continues. Existing configuration is retained.
  Added a concise setup guide, explicit provider limitations and roadmap, corrected
  privacy documentation, and sanitised public validation examples.

- Fixed ordinary-chat drafts remaining after a successful send when the reader
  closed before delivery finished. Composers now use the full thread width;
  background polling no longer dims controls. Removed the duplicate conversation
  heading and inline Refresh button, and reused the shared history-boundary control.

- ChatGPT and Perplexity answers now display formatting, links, tables and
  collapsible code. Perplexity sources, reported plan steps and follow-up
  suggestions appear in compact disclosures inside the conversation. Suggestions
  fill an empty composer for review without sending or replacing an existing draft.

- Added ordinary ChatGPT and Perplexity replies through the shared composer,
  saved drafts, provider-reported activity and automatic conversation updates.
  Delivery receipts prevent duplicate retries after interruption. One authorized
  test message and reply were verified in each existing test chat. Updates poll
  snapshots; token streaming and full attachment/approval parity remain unavailable.

- Settings immediately highlights **Restarting…** after Restart is clicked and
  disables repeat clicks while the app closes and reopens.

- Replaced Applications with compact **Providers shown** choices for Claude,
  OpenAI, Perplexity and Kimi, plus an All shortcut. Ordinary ChatGPT and
  Perplexity chats have independent choices. Kimi setup hides when deselected,
  retaining its saved configuration and in-progress draft.
  Removed the redundant Chat connections counts and controls; older chat history
  is available from the row menu, and connection retry appears only on failure.

- Added the shared right-click menu to Perplexity and ChatGPT chat rows, with
  Read/Close, Refresh and existing layout actions. Shift+F10 opens it; Escape
  closes it and returns focus. Chat rows omit code-only actions.

- Fixed an “Object has been destroyed” error during Restart: window polling stops
  before shutdown, and delayed window callbacks ignore windows that have closed.

- Fixed single-column Recent to interleave account chats and coding threads in
  one chronological list with one shared count limit. ChatGPT and Perplexity now
  identify their provider in the secondary line. Mapped future Triple/Quad layouts
  in a [planning document](docs/specs/PROVIDER-LAYOUT-MAP.md); those layouts remain unimplemented.

- Moved the Threads filter into the compact Apps/workspace header group, replacing
  its separate dropdown row with the shared click-to-change menu. Only the Threads
  control fades at rest and reveals on group hover, keyboard focus or while its
  menu is open. Apps and the workspace label remain fully readable.

- Added read-only **ChatGPT** and **Perplexity** conversations in Threads, with a
  saved **All / Chat / Code & Computer** filter and separate chat-source choices.
  Ordinary chats use the existing thread-row style with provider colors; empty
  sources do not occupy the list, and setup stays in Settings. ChatGPT resolves an
  existing local Codex chat automatically. Active requires reported activity;
  Recent applies time/count limits, and account chats stay out of Workspace.
  Perplexity reads
  recent ordinary chats and older messages through its
  verified desktop connection. Chat reading has no send or task controls and does
  not enroll chats in shared memory. [Setup and limits](docs/ACCOUNT-CHATS.md).

- Added a **Perplexity** preview under **Settings → Applications**, using a compact,
  theme-matched disclosure instead of a panel in Threads. Desktop discovery reads chat titles
  and previews through a verified Windows pipe; Computer connects through official
  OAuth MCP with encrypted sign-in storage, task controls and guarded retries.
  Live discovery, sign-in and catalogue reads passed. A live model reply remains
  unverified because Perplexity rejected the test for insufficient account credits.
  [Setup and limits](docs/PERPLEXITY.md).

- Added a Kimi workspace preview through Settings, with clearly simulated activity,
  permission and Stop/Continue states, read-only example files and changes.
  Real Kimi execution remains unavailable.

- Added non-executing **Settings → Kimi** setup for Local model, Server model and
  Moonshot API, with a separate agent location, saved non-secret configuration and
  explicit local package inspection. Model connections remain untested and Kimi
  agent execution is not enabled.

- Removed routine **Evidence** tags from thread rows and shortened their info area
  to change counts, status and source folders. Multi-root counts and their folder
  explanation remain; detailed attribution records stay in the diff viewer.

- Added **Settings → Shared Spaces → Add to .gitignore**. Enabling it offers an
  unchecked choice for each new space; selecting it appends only that space's
  folder to the workspace `.gitignore`, preserving existing rules. Existing spaces
  are unchanged, and retrying creation does not duplicate the ignore entry.

- Added versioned workflow graphs shared by agent tools and a compact visual editor,
  with scoped context, local scripts, AI assignments, evidence review, branches,
  parallel joins, waits and bounded routines. Manual, assignment-event and
  timezone-aware cron triggers require revision-specific human authority. Handoffs
  retains run progress and recovery evidence; interrupted effects are never blindly
  replayed. Existing policies and assignments are preserved. See the
  [workflow guide](docs/WORKFLOWS.md).

- Restored amplified voice waveform movement for quiet speech and connected its
  spatial bass/mid/treble response to measured spectral power. GPT Live playback
  fades into the active conversation's provider color, including Brainstorm,
  instead of taking the hosted Agent's color. GPT Live strands use varied blue
  shades with a deep-to-ice-blue gradient along their length. Audio volume is unchanged.

- Hosted Brainstorm now saves and revises requested notes with Codex/Claude
  attribution, preserves revision history, and reads/edits workflow drafts through
  project-scoped tools. It can inspect run evidence and invoke only existing
  human-authorized revisions under automatic project policy. Comparison projects
  remain read-only; retries retain operation IDs. See the
  [operating guide](docs/BRAINSTORM-OPERATING-GUIDE.md).

- Right-click the electric wire to pin or unpin a live Active preview below the
  current page and above the info and usage bars. The preview scrolls independently,
  preserves the page and drafts, follows the Active folder scope, and remembers the
  choice across restarts without changing wires or window pinning. The main Active
  view shows its existing list once. Keyboard access uses Shift+F10 on the wire.

- Handoffs now opens a navigable work canvas grouped by explicit objectives, with
  attention/search jumps, pinned source/result links, collapse and pan/zoom controls.
  Submitted results and uncertain delivery stay distinct from accepted completion.
  Folders remain available below the canvas. Handoffs and Workflow can temporarily
  expand into a work-area-bounded square overlay without changing saved panel layout.
  See [isolated validation](docs/validation/HANDOFFS-CANVAS-2026-10-29.md).

- Codex and Claude can discover eligible project names and stable IDs before
  enrollment and request access to the named project. Requests appear only in that
  project's Chats list, and backend approval enforces the stored project and supplied
  native chat. Older destinationless requests require an updated plugin and fresh
  request; discovery grants no content access. See
  [validation](docs/validation/PROJECT-DISCOVERY-VALIDATION.md).

- Route explicit-purpose Codex and Claude saves to Notes, Handoffs or Results.
  Notes shows authenticated saver attribution and keeps the original shared item
  and revision history when edited or discussed. Saving notes or checkpoints does
  not dispatch work. Existing records and callers retain legacy routing.

- Fixed a restart/quit error after approving a shared-memory chat: connection
  cleanup no longer tries to sync files through an already closed Spaces database.
  Temporary connection grants are still revoked during shutdown.

- Notes now uses the shared compact composer with dictation, Enter to save and
  Shift+Enter for a new line. Removed repeated guidance and excess empty spacing;
  saving a note still does not start an Agent. New notes take their title from the
  first sentence; list titles stay on one line with a fade. Right-click a note for
  Rename or Discuss instead of a separate discussion button in each row.

- Shared-memory chats can receive human approval through a bounded active tool
  wait, with exact request/chat binding, grant verification and duplicate-signal
  suppression. This removes the manual reply while the chat is waiting; idle or
  closed local chats still cannot be woken through a supported plugin callback.

- The electric wire button now returns from other pages directly to the main
  Active, Recent or Workspace view and its saved layout without changing the wires.
  On the main views, it continues to show or hide workspace wires.

- Startup now registers the backend before loading the panel and dot renderers,
  preventing first-load failures in Codex usage, settings and Shared Spaces.
  A newer Spaces snapshot clears an obsolete load error without clearing an
  unrelated action error.

- Thread diffs automatically reconcile recorded edits with local Git history and
  retain non-Git evidence alongside current comparisons. Source groups distinguish
  matching checkout commits, separate branch history, pending changes and specific
  remaining coverage limits. Removed checkout history can be recovered through a
  previously observed common-repository binding; no commits or merges are made.

- Fixed the live/Smart Thread composer rapidly hiding and reappearing once a draft
  reaches several lines. Multiline and wrapped drafts keep focus, remain editable
  and send with Enter; intentional history scrolling still preserves the draft.

- Hosted Agent and Brainstorm now own their CLI process trees on Windows, including
  descendants and short-lived discovery/archiving helpers. End, replacement, idle
  expiry and full quit await cleanup; hiding the panel keeps conversations alive.
  Windows job ownership is established before provider launch and also cleans up
  after abrupt app exit. Fixed Claude stream-error cleanup and serialized Brainstorm
  End against starting another discussion.

- Diff refreshes keep the current file list and open preview visible, updating them
  in place when the new result arrives. The open preview retains its wrap setting.
  Switching comparisons still clears the old view. Removed the informational
  **Git and file changes** section from Settings.

- Codex's public activity headings stay visible through related commands and generic
  tool events; explicit tool descriptions retain priority. New activities without a
  heading show **Working…** instead of the previous command. Saved-history status
  also reads public headings. Only the short heading is displayed.

- Compact command activity now describes recognized work such as UI checks,
  tests, builds and file reads instead of displaying a long executable path.
  Live Codex commands are labelled before truncation; expanded activity retains
  the original command and output. Unknown commands use a neutral action label.

- Diff coverage labels such as **Partial · 2 roots** sit on the second row after
  the branch details, leaving line counts beside the title. Their hover explains
  incomplete attribution and the number of source folders/checkouts. Git discovery
  retains a verified fallback while a new preferred folder resolves, avoiding a
  temporary disappearance of the existing diff badge.

- Active, Recent and Workspace now share the header's selected folder, drive or
  All drives scope. Recent applies its count limit after filtering; a temporarily
  empty saved folder stays selected instead of switching to another project.
  Launching a different Threadlight checkout preserves the saved selection.

- The compact header fades long workspace names, halves the
  leading inset and reserves space beside Settings for dragging, double-click
  pinning and the header context menu.

- **Integrated test branch:** combined the completed primary-checkout security,
  composer, Brainstorm, activity and change-tracking work with guided review and
  the Workflow tab. Normalized Windows root identities and stopped an initial
  changes request from waiting on a newer background scan. See
  [integration validation](docs/validation/INTEGRATED-TEST-BRANCH.md).

Documentation reconciled with the primary checkout on **29 October 2026**.
These changes are unreleased. Linked records distinguish automated fixtures,
installed-provider proofs and remaining acceptance gates. Earlier entries retain
previous development behavior; the README describes current supported scope.

### Fixed

- The Notes composer stays below the notes list, with long lists scrolling above it.

- Chat request review now centers the title, verification code, access description
  and approval button, uses a compact **Confirm** checkbox, and reduces the space
  above the title and below the approval button.

- Shared Spaces project tabs now span the full width of the Threadlight panel,
  and the Chats request heading has half the spacing above and below it.
  Connected chat details start higher without an unnecessary leading divider.

- Removed the redundant space-name tooltip from the Shared Spaces project header.

- The Chats tab lists connected chats and shows **Requests (count)** only when
  requests are waiting. Open a request to match its code and review access on one
  page; the separate Connect a chat entry and setup steps are removed. Empty spaces
  show a short invitation to request access. Capability details stay collapsed.
  Request approval now includes publishing shared notes and returns directly to
  Chats. Removed repeated chat labels, permission toggles, decision-card setup,
  and the duplicate back button from request review; the header back control remains.
  Connection review uses the open space. Chats
  in other working folders can now be linked; requests carrying a native chat ID
  show the matching chat directly. Older requests have a searchable fallback and
  missing chats have recovery guidance instead of an unexplained empty picker.

### Added

- **Guided change review:** thread/worktree diffs offer explicit
  file and text-section selection, exact candidate review, local checks and a
  commit on a new branch, preserving the original checkout and staging. Added
  **Teach** beside Tour, Full and Off with contextual Git explanations at the
  bottom of the panel. Publishing, PR merging and automation remain future phases.
  See [tested scope and limitations](docs/validation/GUIDED-CHANGE-WORKFLOW-VALIDATION.md).
- Integrated the previously separate Shared Spaces **Workflow** tab and guided
  review into primary main, preserving the project connection setup fix and all
  later activity, workspace-scope and diff updates.

- Added local Git **Current**, **Staged** and **Unstaged** comparisons, source-folder
  selection and multi-repository groups that keep identical filenames distinct.
  Counts, file lists and opened patches share a captured revision. Ordinary folders
  support opt-in baseline recording, pause, reset and Forget. This is the initial
  local implementation, with fixed exclusions and explicit coverage limits; see
  [validation and remaining acceptance work](docs/validation/LOCAL-CHANGE-TRACKING-VALIDATION.md).
- Added foreground Agent application tools for acknowledged navigation, scoped
  artifact/diff reads, supported settings, named-space and native Codex chat creation,
  guarded restart and durable action receipts. The Agent can select each comparison
  mode and a known repository. Claude native creation and captured-card navigation
  remain unavailable. See [application-control evidence](docs/validation/THREADLIGHT-AGENT-CONTROL-VALIDATION.md).
- Added native Codex chat creation from the header context menu, with workspace
  selection, recovery receipts and a focused empty composer. The desktop adopts the
  chat without an initial prompt. Claude creation remains visibly unavailable.
  [Creation and real-provider evidence](docs/validation/HEADER-THREAD-PICKER-VALIDATION.md).
- Added live expanded Codex conversations with saved-history fallback, anchored
  history reading, grouped tool activity, image galleries and an inline shared
  composer. Claude uses saved-history polling. Local Codex messages support pasted,
  dropped and selected file/image attachments; this is not a cloud file uploader.
  [Implementation and test scope](docs/validation/LIVE-THREAD-VIEW-VALIDATION.md).
- Added native Codex queue inspection, attachment-preserving Edit, Remove and
  explicit Steer, with receipt reconciliation for uncertain writes.
  [Queue and Steer live proofs](docs/validation/CODEX-QUEUE-VALIDATION.md).
- Added local artifact discovery from transcript links and Codex visualization
  markers, refresh/link/save-copy actions and isolated interactive HTML previews.
  Self-contained scripts, controls and canvas work; external assets, persistent
  browser state and cloud artifacts remain unsupported.
  [Reference evidence](docs/validation/ARTIFACT-REFERENCES-VALIDATION.md) and
  [interactive-preview evidence](docs/validation/INTERACTIVE-ARTIFACTS-VALIDATION.md).
- Added project participant capability reports, human verification and evidence-based
  destination suggestions, retaining reviewed rationale in unsent handoffs.
  [Participant validation](docs/validation/PROJECT-PARTICIPANTS-VALIDATION.md).

### Changed

- Brainstorm now uses the shared Agent conversation and voice interface, with
  project-specific history, drafts, sources and reviewed plan/assignment preparation.
  Notes and discussions remain separate. Ctrl+Alt+B opens Brainstorm voice;
  Ctrl+Alt+Q opens ordinary Agent voice. Project tools do not gain application
  control or independent dispatch. See [conversation UI](docs/validation/BRAINSTORM-CHAT-VALIDATION.md)
  and [voice validation](docs/validation/BRAINSTORM-VOICE-VALIDATION.md).
- Codex next-step, native-question and managed-question answers now share the
  standard composer and microphone. Dictation fills a draft for review; the original
  card-specific submission path remains. Closing a card prevents late transcription
  from changing its reopened draft. Voice checks used synthetic audio.
- Consecutive edits, commands and public activity headings share a collapsible smart
  thread stack. Messages, turn boundaries and compaction separate stacks; each edit
  retains its own counts and recorded-patch View action.
- Moved Agent, Shared Spaces and New thread into the header context menu. Removed
  thread-row artifact checker strips and their reserved space; Artifacts remains
  available from the thread context menu and viewer navigation.
- Reconciled the README and plugin guide with implemented behavior and explicit
  limitations. Repository instructions now require same-session Unreleased entries
  and affected documentation updates before user-visible work is reported complete.

### Fixed

- Collapsing Smart Thread releases its workspace wire and group highlight so pointer
  movement and scrolling trace the thread under the mouse again. Keyboard focus
  tracing remains available; browser regression checks cover single and dual layouts.
- Automatic human Codex messages now send immediately to a confirmed idle chat;
  only a confirmed active turn falls back to the native queue. Unknown or rejected
  delivery preserves the draft/error instead of silently queueing or steering.
  Previous uncertain queue receipts are reconciled before a direct retry.
  The routing change has focused automated coverage; earlier live queue proofs
  do not certify the new routing. [Evidence](docs/validation/CODEX-QUEUE-VALIDATION.md).
- Thread diffs now explain partial attribution and unknown metrics, preserve supported
  edits after lines move, and avoid reporting zero known edits as a clean folder.
  Switching scope, mode or repository cannot apply stale replies to the new view;
  opening a file uses its captured comparison revision. Large-file preview limits
  no longer truncate available count evidence. Nonempty thread attribution remains
  partial and does not prove exclusive authorship.
- Unwrapped Added/Removed diff sections now have independent horizontal scrollbars.
  Wrapping removes the overflow. Browser checks cover thumb dragging, wheel input
  and section independence.

### Security

- Added server authentication and encryption to the separate shared-memory MCP
  connection for both Claude and Codex, including enrollment and Claude runtime
  credentials. Agent communication, chat-reader, space-context and app-control
  connections use the same transport. Plaintext routes are rejected; capabilities
  remain scoped and revocable. Refresh the app and both complete plugin packages
  together, then reconnect and pair again. Manual configuration is now stdio and
  must be regenerated after app restart.
- Removed MCP credentials and Claude relay prompts from provider command lines,
  bounded relay output, and added Windows user/logon checks to Claude inbox writes.
  Same-user hostile code, upstream Codex router authentication and the real Claude
  Desktop inbox release gate remain explicit limits. See
  [follow-up security validation](docs/validation/CLAUDE-MEMORY-SECURITY.md).

- Verify the Codex desktop pipe server's Windows user/logon, packaged executable
  and signature before sending initialization or chat data, retaining the verified
  handle. Tightened response correlation and bounded transport resources. This
  does not authenticate every participant on the upstream Codex coordination bus.
- Provider hook requests and replies now require authenticated encryption, protected
  per-start credentials and replay checks. Refresh the app and both plugin packages
  together; old plaintext hooks are rejected. These protections retain the Windows
  user trust boundary and do not isolate hostile same-account code.
  See [local IPC security, upgrade steps and remaining limits](docs/security/LOCAL-IPC.md).

### Earlier development history

<details>
<summary>Earlier unreleased notes, through 27 October 2026</summary>

These entries are preserved as development history. Later entries above supersede
older behavior and limits; they are not a second current-feature checklist.

- "Needs your input" now has the bottom right corner of a thread's second row. The branch counts and task timer step aside while it shows and return when it goes, so the title keeps the whole top row (it was squeezed out by the diff counts, and vanished entirely on an open thread).
- The question and approval cards no longer carry the "Waiting for you here · opening it in Claude answers it there instead" note.

- The three header icons (brain, agent, cog) share one centre line; the agent star sat about a pixel too high.

- Mouse-wheel scrolling is finer everywhere in the app: one notch now moves a quarter as far (25 px instead of 100 px). Touchpads are unchanged.

- Centre wires in dual view are tidier: three slots (Claude side, middle, Codex side) with a group sitting on the side its threads are on, short spikes that stay clear of row text, and rounded joins. Wires are grey until their group is lit, then show their colour. While a wire is lit, the text of every thread outside it dims a little.

- The swirling dot is larger: 32 px instead of 22 px, about the size of a taskbar icon, so it is easier to see. The needs-input drips scale with it.

- Workspace wires now work in dual view: the same rail runs down the divider between the columns, joining threads of one repo across Claude and Codex. The longest group sits dead centre with a spike to each thread, and overlapping shorter groups step to alternate sides and reach further, layered as before. No extra width.

- A hover hint no longer closes when you press the mouse on its target. It closes when the pointer leaves, or when what is under the pointer moves or changes, and steps aside for a menu that opens.

- Claude and Codex rows now appear together: updates from the two sources that land within 120 ms go out as one, and a first load reads up to 150 threads per scan instead of 25.

- Workspace with All drives (or a drive with more than 500 workspaces) showed only one Claude thread: the list of open workspaces was dropped for being too long. It now asks for everything at once, and the folder scan reads files in parallel.

- Very long Claude threads (hundreds of MB of pasted images and tool output) no longer hold the list up: the first read takes a thread's opening lines and the last 8 MB, so every row loads at once.

- **Claude threads appear straight away after a start or a change of view.** A thread's
  transcript is read in full the first time, so reading a long history in one scan held every
  Claude row back (Codex reads from a database and was not affected). A scan now reads at most
  25 new transcripts, newest first and stopping after half a second, and the rest follow on the
  next scans; threads Threadlight is tracking live are always shown at once. Scans that still
  take over 0.75 s are noted in `scan-timing.log` in Threadlight's data folder.
- The explanation for **Ignore** now opens in the info area at the bottom of the panel, as
  other hints do. A hint on a menu item used to float beside the cursor because a menu is
  drawn outside the card.

- **The time window always applies.** Window can no longer be turned off, because a long
  history made the panel slow to fill (a start could take ten seconds to show your Claude
  threads). A saved "no limit" setting falls back to 24 hours. Each scan also builds only the
  newest threads for Recent and at most 300 for the Workspace list, newest workspaces first;
  the rest stay listed with their counts and load on "Show more". Older threads are found
  through your files.
- Dual view no longer shows a half-built layout when you move between lists. Going from Active
  to Recent used to grow the card with all ten threads crammed in the right column for about a
  second before splitting them. The columns now open and close with the card; the rows glide
  between columns only when you choose Dual view or Single view yourself.

- **Restart** in Settings → App, and in the tray menu, closes Threadlight and starts it again
  (settings and threads are untouched). The tray item works even if the panel will not open;
  if the normal quit ever hangs, the process is forced out after six seconds so the restart
  still happens.
- Fixed a slowdown with very long lists, such as Workspace across all drives. Moving rows
  into dual view's columns read and animated each row in turn, so the browser redid layout
  for every row again and again; positions are now read first and animated together, and past
  120 rows the columns change without the glide. The "Last active" text is also much cheaper
  to build for each row.

- **Ignore** in a waiting thread's right-click menu. It sets the pending request aside in
  Threadlight only: the thread stays listed, its "Needs your input" tag and amber dot are
  toned down, it no longer stays pinned in Recent past the usual list, and it no longer
  drips. Hovering the item explains that nothing changes in Claude or Codex. A new question
  from the thread flags it again, and **Stop ignoring** undoes it. The choice lasts until
  Threadlight restarts.

- Dual view now steps aside for Shared Spaces, the Agent and Settings: the panel narrows
  smoothly to the normal thin card while one of them is open and widens back to the two
  columns when you return to the list. Your Dual view choice is kept.

- **One drip for every thread that needs input.** While Threadlight is minimised, each
  waiting thread (up to ten) now has its own drip, in the order the Active list shows
  them, in its own provider's colour, instead of one drip for one chosen thread. With N
  waiting a drip leaves every 6 / N seconds and the forming of each drop speeds up as
  they get closer, so a crowd of waiting threads becomes a steady run of drops. The
  wheel keeps its Claude-orange design with the Codex-blue shimmer for every provider;
  only the drop takes a provider colour.

- **Settings explain themselves.** Every setting now has a short hover description, with
  extra detail in Tour. Labels are shorter to match: Threads shown, List, Window, Count,
  Open on, Dot and Countdown. The Panel group is merged into App, which stays at the bottom.
  **Count** appears only for the Recent list instead of being greyed out.
  The Shared Spaces group keeps its place for future settings; open Shared Spaces from the
  brain icon in the panel header.

- **Dual view.** Right-click a thread and choose **Dual view** (the last item, after Worktree
  diff, Compose and Open in Claude) to widen the panel and show Claude and Codex threads side
  by side. The window widens, the card grows, the Claude threads slide left and every thread
  closes up into two stacked columns; **Single view** reverses it. The choice is remembered
  and needs both providers switched on. It applies to the Recent and Workspace lists (Workspace
  repeats its headers in each column): Active and All stay one column, and the choice returns
  with the list. Workspace wires are hidden
  while the columns are split. **Sessions listed** now goes up to 50.

- Fixed Git metadata disappearing during folder rechecks and diff reads restarting
  throughout an active chat. Clean branches remain visible; the loading indicator
  no longer contains a replacement character.

- **Launch at sign-in** now starts a quiet Windows launcher. Threadlight waits for
  Claude or Codex to open before showing its dot, with one startup setting. Opening
  both starts one copy; quitting Threadlight is respected until another desktop app
  opens. Turning the setting off stops the launcher too.

- Git badges now prioritize displayed chats, share worktree scans, publish branch
  metadata before expensive counts, and bound background Git concurrency. Hook and
  filesystem changes invalidate cached diffs promptly, with loading indicators and
  polling recovery. Git reads drain safely on failure and shutdown.

- Conversation return events now reuse the existing cards inside Agent history,
  retain exact request identity and independent worker state, and persist result
  and speech receipts. Active GPT Live conversations can announce new events at a
  verified pause through their existing connection. Local STT remains separate;
  uncertain speech is not replayed. Claude Desktop wakeup still requires the
  Wednesday acceptance test.

- Added Claude existing-runtime inbox delivery with authenticated plugin registration,
  verified Windows pipe ownership, durable execution claims, completion acknowledgements
  and correlated result history. Duplicate notifications do not authorize repeat work.
  Automatic release remains gated on the real Claude Desktop test scheduled for
  Wednesday, 28 October; concurrent CLI resumes remain disabled.

- Required explicit human answers for native question cards; option mentions,
  negated choices and ambiguous alternatives no longer count as selections.
  Codex card answers also require the panel's main frame as their IPC caller.

- Added persistent cross-provider communication tools, project DM history, correlated replies,
  native request routing and workflow scheduling with dependency, model, workspace and budget gates.
  Added backup/recovery and uncertain-delivery reconciliation. The tested Codex idle resume is
  admitted; Claude wakeup remains disabled after its concurrent-writer proof failed. See
  [validation and supported paths](docs/validation/THREAD-COMMUNICATION-VALIDATION.md).

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

</details>
