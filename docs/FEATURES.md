# Detailed feature guide

This guide describes the implementation and its limits. Start with the [README](../README.md) for the public source preview. Kimi settings and previews described in historical development notes are disabled in public builds.

A small Windows overlay for following **Claude and Codex chats**, composing messages,
reviewing changes and coordinating work across projects.

> **Unofficial, unreleased software.** Threadlight is not made by, affiliated with or
> endorsed by Anthropic or OpenAI. This README describes the implementation in the
> primary `main` checkout, with its current limits. Provider integrations include internal,
> version-dependent formats and protocols; an application update can break them.

## What you can do

- **Build reusable workflows.** Ask Brainstorm to draft a process or edit its connected
  graph in Workflow, authorize an exact version, then follow each run in Handoffs.
  Mix scoped AI assignments and deterministic checks with branches, joins, review
  waits and bounded routines. [Workflow guide](WORKFLOWS.md) covers triggers,
  local-script authority, recovery and limits.

- **Follow your chats.** Active, Recent and Workspace views show activity, plans,
  pending questions, context and recorded usage. Monitor Claude, Codex or both;
  use single or dual view and optional workspace wires to connect related chats.
- **Read and reply from the overlay.** Expanded chats show messages and collapsible
  activity, with a shared composer, dictation and saved drafts. Codex supports
  desktop-owned live updates; Claude reads saved history. Reading older messages
  holds your position until you return to live.
- **Review changes in context.** Open an edit card's recorded patch, a chat's
  attributed changes, or a folder's current/staged/unstaged Git changes. Comparisons
  keep their source and coverage visible, including multiple repositories.
- **Inspect artifacts.** Open local images, text and self-contained interactive
  HTML from a chat's **Artifacts** menu. Originals remain in place; saving a copy
  is explicit.
- **Talk to the hosted Agent.** Use Claude or Codex to read selected chats, navigate
  Threadlight and propose supported application actions. Local transcription and
  Codex native live voice use separate voice modes.
- **Share project context.** Shared Spaces holds notes, handoffs, participant
  information, Brainstorm discussions and reviewed assignments. Connected chats
  receive only the memory access you approve.

Right-click the panel header for **Agent**, **Shared Spaces** or **New thread**.
Native Codex chat creation is implemented; Claude creation remains unavailable.
Mouse Back/Forward buttons navigate the panel. Hold Control to hide the floating
logo temporarily; add Alt for an Active preview. Settings are available from the
panel and tray.

The electric wire button returns directly from any other page to your main
Active, Recent or Workspace view, restoring its saved single or dual layout without
changing the wires. On the main views, the same button shows or hides workspace wires.
Right-click the wire (or press Shift+F10 while it is focused) to **Pin active threads**
below your current page and above the info and usage bars. The live preview scrolls
independently and follows the same folder scope as Active. Unpin it from the same
menu; the saved choice is independent of the wires and window pinning. Active itself
keeps its existing list without a duplicate preview.

The header's folder selection applies to **Active**, **Recent** and **Workspace**.
Switching views preserves that scope: Active shows its working/waiting chats and
recent unread replies, Recent applies its count limit within that scope, and
Workspace shows the thread tree. Choose a drive/share root to include its folders,
or **All drives** to include every enabled provider's workspace. Selecting an exact
folder keeps adjacent worktrees separate. Running Threadlight from another checkout
does not change the saved scope; choose that worktree's folder explicitly.

## Chats, messages and questions

The header's **Threads** filter sits beside Apps and the workspace, with no extra
toolbar row. Hover or focus the group to reveal the faded Threads control, then
click to choose **All**, **Chat**,
or **Code & Computer**. Its short label becomes Threads, Chat or Code and remembers
your choice. Existing installations start with Code & Computer.
**Chat** shows ChatGPT and Perplexity conversations as ordinary thread
rows with provider colors and no code-only controls. Active requires reported
activity, and empty sources add no rows or provider cards. Recent uses the saved
time/count limits; unscoped account chats do not
appear in Workspace. In single-column Recent, chat and coding rows share one
chronological order and one count limit; ChatGPT and Perplexity identify themselves
in the secondary line. Use the applications filter to choose either chat app or both,
then select a row to read it. Right-click or press **Shift+F10** for Read/Close,
Refresh and available layout actions. **Load earlier messages** reads the preceding page without
sending anything. **Load older chats** appears in the row menu when the provider
has more history; the list still uses its existing time and count controls.
Settings shows a connection error and **Retry** only when needed, below the chat
provider choices. ChatGPT resolves an existing local Codex chat for its
desktop routing context; Perplexity uses its signed-in Windows app. The shared
composer sends follow-ups into the selected chat; drafts survive navigation and
restart, and uncertain delivery blocks accidental resends. The composer uses the
full thread width; successful sends clear the draft even if the reader
closes before delivery finishes. Earlier history loads at the top boundary using
the shared **Load earlier messages** control. Refresh stays in the row menu.
Open chats refresh automatically every two seconds. The visible ChatGPT list checks at most once a minute. Perplexity checks its visible list every five seconds. Repeated account-chat limits space out subsequent checks. These are snapshot updates, not token-by-token streaming. Neither source
provides shared-memory enrollment or complete attachment rendering.
Answers display Markdown, links and tables. Smart Threads, account chats and the
Agent show code in expanded, language-labelled cards with Copy and optional
collapse. Hold Ctrl over the code for a grab hand and left-drag to see clipped
lines in either direction. Dragging without Ctrl selects text. Unrecognised
languages retain their original text and indentation. Ctrl-drag follows the mouse beyond
the panel and continues scrolling at a display edge until release. The code header
menu can pin a local snapshot. A resizable purple frame surrounds pinned references,
which remain readable in a separate window when the conversation panel auto-hides.
The spinning logo sits above the detached reference at the matching corner on its
monitor. Shift+wheel over a code body scrolls it horizontally. Each entry folds
independently. Recorded text files and explicitly named reply fences show a
filename with a secondary language label. Anonymous snippets show their opening
line. Hover or focus a header to see the full name and available source details.
Select an entry to discuss it with the foreground Agent. The Agent can discover
and read snapshots and ask for approval to replace the selected copy. Replacements
use the observed latest revision and appear in both views. Appends preserve
the existing text. The entry menu browses its saved versions. Copy uses the
displayed version. Older stores retain their existing revision as the earliest
available snapshot. Each pin supports 50 saved versions, with a 16 MB limit
for the local pin store. A full store refuses an update and retains the saved
versions. Each replacement or append request accepts up to 48,000 characters.
Drag the lower edge to resize the reference. The detached window uses its upper
edge when anchored to the bottom. Up/Down adjust height in 10-pixel steps,
and Home/End choose the minimum or maximum.
[Windows interaction and signed-in checks](validation/PIN-HISTORY-LIVE-CONTROLS.md).
Unpin removes the reference. Reduced motion uses a static stripe. Perplexity adds
compact **Sources**, **Steps** and **Follow-ups** disclosures when supplied by the
provider. Follow-ups fill an empty composer for review; they never send automatically.
Claude ordinary chats remain deferred.
[Connection setup, supported versions and limits](ACCOUNT-CHATS.md).

[Provider layout mapping](specs/PROVIDER-LAYOUT-MAP.md) describes proposed
Dual/Triple/Quad selection by provider family. Triple and Quad are not implemented.

The separate **Perplexity Computer** preview is in **Settings → Providers shown**,
when Perplexity is selected.
Refresh desktop chats to read the Windows app's
current list, or connect Computer with your Perplexity sign-in to use the task
composer. Its section follows the app theme and shows account chats independently of
the Claude/Codex folder and activity filters. Desktop discovery and OAuth catalogue
reads have passed live checks; sending, reading task transcripts and stopping tasks
are implemented but not live-verified because the account credit check rejected
the test before a task started. [Perplexity setup and limits](PERPLEXITY.md).

Kimi integration is in development and hidden in the public build. Historical
setup/preview proofs do not establish usable provider execution.

**Settings > Providers shown** offers Claude, OpenAI and Perplexity. **All** selects
or clears these public choices. **Chat providers shown** separately controls
ordinary ChatGPT and Perplexity chats.
Turning both Claude and OpenAI off pauses their monitoring without disabling the
hosted Agent. Disabling a coding provider prevents
new background submissions and releases its held cards; already accepted work can
continue. Per-chat drafts are stored locally and restored after restart.

Expanded chats group adjacent edits, commands and public activity headings in one
collapsible stack. Messages, turn boundaries and compaction separate groups. Each
edit keeps its own counts and **View** action. Recorded local images can appear in
an image gallery and open in Artifacts. The composer stays with the live end of the
conversation; scrolling into history preserves its draft.

Compact command activity uses readable action labels such as **Running UI checks**,
**Checking types** or **Reading project files**. Environment setup and launcher
paths do not occupy that short status line. Expand the command activity to inspect
its original command and output; a label describes the action, not a successful result.
When Codex supplies a public activity heading, that heading stays on related actions
instead of being replaced by a generic tool label. Explicit tool titles take precedence.
A new activity without a heading shows **Working…** until a heading or action arrives.

For a connected local Codex desktop chat, an idle chat receives a message through
its existing desktop owner. A confirmed active turn sends the new message to the
native queue. Queued messages support **Edit**, **Remove** and an explicit **Steer**
action; editing preserves their attachments. An uncertain result retains recovery
information and is not silently resent or changed into another delivery route.
Unavailable connections report their reason. **Copy and open Codex**, where offered,
is an explicit fallback that requires you to paste and submit.

Codex messages can include pasted, dropped or selected local files and images,
including attachment-only messages. This is a local desktop integration, not
ChatGPT's cloud Files uploader or a guarantee of cloud quota compatibility.
Claude retains its own supported message and held-card paths; it does not gain
Codex's native queue or local attachment contract.

Question and approval cards retain their exact request identity. Supported native
Codex questions, held provider cards and Threadlight-managed questions use their
own response paths. Answer fields share the composer and microphone controls;
dictation fills a draft for review. **Answer through Agent** must be selected on
the relevant card before an Agent answer can use that human decision path.

See [live thread views and attachments](validation/LIVE-THREAD-VIEW-VALIDATION.md),
[Codex queue evidence](validation/CODEX-QUEUE-VALIDATION.md) and
[native chat creation](validation/HEADER-THREAD-PICKER-VALIDATION.md).

## Diffs and local change tracking

### Guided change review

The diff viewer offers **Prepare changes**.
Select current files or text sections, review the complete candidate, run selected
local checks, and save a commit on a new local branch. The source branch, working
files and staging stay untouched, so selected edits still appear in the original
checkout. Selection covers current edits from all writers; nothing is preselected.

Settings offers **Tour / Full / Teach / Off**. Teach explains relevant Git concepts
in the bottom information area. Essential action effects remain visible with help
Off. Existing `info` settings retain their value and display as Full.

The first release is local only: no push, PR creation/merge, rebase or scheduled
mutation. Custom commit hooks, symlinks, submodule changes and file-conversion
filters require the normal Git workflow. Optional package scripts execute project
code against an exported candidate and may reuse installed dependencies; they are
not sandboxed. See the [specification](specs/GUIDED-CHANGE-WORKFLOW-SPEC.md)
and [validation record](validation/GUIDED-CHANGE-WORKFLOW-VALIDATION.md).

Primary main also includes the Shared Spaces **Workflow** tab. Guided review,
the Workflow tab and project connection setup are integrated locally; restart the
app to load the rebuilt renderer.

### Available comparisons

A chat badge opens its **Thread diff**. The thread context menu's **Worktree diff**
opens a folder comparison. Select the source folder when the chat has recorded
changes in several repositories. Identical relative filenames remain separate.

Reconciliation runs automatically in the background without an Agent request.
**Evidence** opens the same viewer with provider-recorded files grouped by source,
including folders without a saved baseline. Local patch matches identify commits
in the checkout history or separate branches; they do not prove commit authorship
or that every recorded operation is still present. Pending counts remain separate.
Unavailable checkout history is recoverable only through a Git common-directory
binding observed during this app session and a verified surviving checkout.
Missing bindings, baselines and bounded-search limits remain explicit. Nothing is
committed, merged, or opted into recording by reconciliation. See the
[reconciliation and startup validation](validation/ATTRIBUTION-STARTUP-2026-10-29.md).

| Comparison         | What it shows                                                                          |
| ------------------ | -------------------------------------------------------------------------------------- |
| Recorded edit card | The provider-recorded operation at that point in the conversation.                     |
| Thread diff        | Available recorded edits that can be matched to current changes, with coverage limits. |
| Git current        | HEAD compared with working files, across all writers in the selected checkout.         |
| Git staged         | HEAD compared with the index.                                                          |
| Git unstaged       | The index compared with working files.                                                 |
| Folder baseline    | Current files compared with an explicitly recorded local baseline.                     |

Git comparisons use the local repository and need no remote account connection.
Their selector is in the Changes viewer. Current changes are not the sum of staged
and unstaged counts: an edit can be staged and then reversed in the working file.
Counts, the file list and opened patches share a captured revision. An expired
revision reports unavailable instead of opening a different comparison.
Refreshing the same comparison keeps its current file list and open patch visible
until the replacement arrives, with a **Refreshing…** indicator. The preview stays
open and retains its wrap setting. Selecting another comparison or folder starts
a separate read, so the previous comparison is not shown under the new selection.

Ordinary folders support opt-in local recording, baseline reset, pause and Forget.
Recording uses fixed exclusions for secrets, dependencies, generated files, VCS
metadata and symlinks. A full storage budget pauses recording. Reading a comparison
or asking the Agent to select a mode does not enable recording.

**Partial** means the available evidence cannot establish the full set of changes.
The compact row places this label beside the branch details on the second line;
**2 roots** means two distinct source folders or checkouts, not two errors. Click
the coverage label to open the comparison and inspect its source folders.
Unknown counts and unavailable groups remain visible; zero known edits does not
necessarily mean a clean folder. Nonempty thread attribution is currently partial:
it does not prove continuous or exclusive authorship, or reconstruct missing
historical edits. Edit-card counts are historical operations, not additive current
folder totals. Full acceptance coverage, configurable exclusions and some advanced
Git/retention diagnostics remain unfinished.

The hosted Agent can read or navigate to a specific comparison mode and known
repository. See [implemented behavior, tests and remaining work](validation/LOCAL-CHANGE-TRACKING-VALIDATION.md).

## Hosted Agent

Choose Claude or Codex in **Settings → Agent → Provider**. Codex requires a signed-in
native Codex CLI; Claude is not required for a Codex Agent. Codex model and reasoning
choices come from the installed runtime. A continuing conversation keeps its
provider and model; use the selection controls for a new conversation.

The Agent can find and read enabled local chats, inspect source details, navigate
the panel, select artifacts and diffs, and propose supported settings changes,
named-space creation, native Codex chat creation or restart. Writes use the Agent's
existing decision cards. Navigation waits for the requested view's load result;
restart remains pending until the next instance confirms startup.

**Stop** interrupts the current turn. **End** closes the conversation; **Earlier**
keeps saved history and **Continue** resumes it. Codex End also archives the
underlying native thread. Closing the microphone does not end the conversation.
Hosted conversations are excluded from Threadlight's monitored work-chat list,
but exclusive storage in Threadlight is not implemented: provider history may
still contain them.

Hosted Agent and Brainstorm CLI processes are owned by their conversation. **End**,
conversation replacement and idle expiry retire their process trees; hiding or
minimizing the panel keeps them available. A full **Quit Threadlight** waits for
conversation cleanup and drains remaining owned helpers. On Windows, private job
objects also terminate owned descendants if Threadlight exits abruptly. Cleanup
allows a short stdin-close grace period before forcing remaining descendants to
stop. Existing desktop apps and externally managed services are not adopted.
See [process lifecycle evidence and limits](validation/AGENT-PROCESS-LIFECYCLE.md).

Application-control tools belong to the foreground hosted Agent. They are not
exported to Shared Spaces workers or the shared-memory plugins. Claude native
chat creation and Claude captured edit-card navigation are unavailable. Desktop-only
Codex plugins/connectors remain unavailable to the hosted Agent until their
permissions and execution support can be verified.

See [Agent compatibility](validation/AGENT-CODEX-VALIDATION.md),
[chat discovery and reading](validation/AGENT-THREAD-DISCOVERY-VALIDATION.md),
and [application control](validation/THREADLIGHT-AGENT-CONTROL-VALIDATION.md).

### Voice

**Settings → Voice target** selects **Local STT** or **GPT Live**.

- **Local STT** transcribes on your PC using a speech model downloaded with your
  consent. Choose **Agent conversation** or **Thread message**, with Toggle or
  Push to talk. Thread messages use review/countdown and Hold controls. The
  composer's microphone always dictates into its own draft.
- **GPT Live** uses native audio through the Codex Agent and your ChatGPT sign-in.
  One brief local cue confirms that the microphone and native session are ready. Speaker mute silences it. Startup cancellation does not play a success cue, and the cue adds no wait before microphone input.
  Spoken replies play on the current output device. A written transcript can appear
  even when the output device is silent.
  It sends audio to the provider and does not use the local speech model. The
  hotkey connects or disconnects the conversation; switching modes closes pending
  capture rather than silently changing engines.

The voice waveform amplifies quiet speech visually and responds to measured bass,
mid and treble energy. During GPT Live playback it fades into the active
conversation's provider color, then settles into a neutral ribbon as speech ends.
The full Agent shows its working logo and current activity at the bottom of the transcript. In the
floating pill, audible output also lights the edge in the provider’s colour.
Blue travelling dashes can appear alongside that glow during Agent work.
Reduced motion holds these indicators steady.
Visual amplification does not change microphone or speaker volume.

The Agent and Earlier views show continuous conversations. **Audio received**
reveals the original delegation details. While reading an example, use **New
updates** to jump to the latest message or **Needs input** to reach a decision.
The top **Reply** button opens the shared message composer below the transcript.
The green phone beside it starts or resumes voice. Unsent drafts stay available. To resize the full Agent
reader, drag the grip below the conversation, or focus it and
use Up, Down, Home or End. Threadlight remembers the height and fits it to the
available space alongside the composer and pins.
The compose icon toggles the reply box and keeps its text while hidden. The upper edge of current and Earlier messages fades while scrolled. Coaching replies distinguish short inline code from indented, syntax-highlighted Python blocks.
Smart Thread and Agent assistant prose shares the same 12px text and line spacing. The Agent action row is centered. During a live Agent call the reply pencil is the fifth control in that row. The resize grip supports dragging and keyboard adjustment. Agent and Smart Thread code blocks use the two-card Copy icon. A pinned reference copies the displayed revision.

In Agent Settings, **Show spoken replies in waveform pill** lets the collapsed Agent GPT Live waveform unfold to show the latest caption. Short captions stay centered at the resting width of 92px. Longer captions widen the pill around its center, up to 296px, then wrap. Code cards remain left-aligned. The pill stays within the screen edges. The scrollable reply body uses up to 232px below the waveform. The × folds the body before the pill narrows and dismisses that reply, including later caption updates. A new reply reopens the pill. Reduced motion switches directly between sizes. The preference is saved and defaults to off. Opening the panel or the waveform menu hides it. Ending the call clears it. Direct captions remain readable without a source link. Linked opening and later captions share a reply, and code blocks from the identified thread message appear beneath it with syntax highlighting and Copy.

Right-click anywhere on the live pill, including its code, or press Shift+F10 for Pause listening, Resume listening, Stop speaking during audible playback, and Hang up. Pausing the microphone preserves the connection and speaker preference.

Hover over the waveform for half a second to open the ongoing Agent or Brainstorm conversation. The card centers on the waveform where space allows and stays inside the screen edges. Drag the waveform to reposition the pill and reply together. Text and code remain selectable, and the Copy button copies code. A focused waveform opens the call with Enter or Space. Its call controls stay with that conversation; other pages offer Return to call. Leaving an unpinned panel can collapse it while the call continues.
The gear immediately left of Back opens Agent settings, including provider, model, effort, lifetime and Earlier conversations.

Expand a thread in the pinned Active list below the current page and use its composer mic to dictate a
draft during GPT Live. The Live waveform turns red in the panel and on the
floating indicator. The Agent can still speak, and its mic resumes when dictation
ends.

With the Codex Agent and the default **Ctrl+Alt+Q** binding, the shortcut opens GPT Live for that conversation, including when Local STT is selected. Press it again to close the microphone. The composer retains local dictation, and **Ctrl+Alt+B** opens Brainstorm
voice. Brainstorm shares the Agent conversation and voice UI but keeps its project
context and tool scope. While listening, hover over the floating waveform to open the
current panel. The red phone disconnects capture and playback. During native Live,
the mic and speaker have independent mute controls. **Pause/Break** and
**Ctrl+Alt+M** toggle the current Agent or Brainstorm microphone, including
while the panel is hidden. Holding either key toggles once per press. These
shortcuts are released when the call ends, shortcuts are paused from the tray,
or Settings is recording a binding. A key assigned to Talk or held by another
application can be unavailable independently of the other mute key.
Open **Settings → Hotkeys** for registration errors, your editable Talk binding,
in-panel gestures and the VS Code companion’s default preview keys. The Pause
function may require Fn on compact keyboards. Ctrl+Break is a separate Windows
interrupt. Use Ctrl+Alt+M or the microphone button on keyboards without Pause. Stop speaking skips playback of the current
reply and leaves the next reply audible. Hanging up keeps the chat available
for typing or resuming voice. In the Agent bar, the new-chat icon starts fresh and the bin closes the current conversation. Both preserve history in Earlier. Unsent text remains available when the reply box is reopened. Active work and decisions must finish first.
**Voice pace** in Agent Settings has five steps from Slower to Faster. The next GPT Live call or spoken screen reply uses your saved preference. The middle step restores Normal. GPT requests a speaking style, and Windows screen replies set the local synthesizer rate.

When a backing reply streams explicitly final prose, Live can read one stable
opening sentence while the remaining text and examples arrive, then speak the remaining prose once after the matching opening playback finishes. **Read remaining** requests the rest when the automatic handoff is uncertain. Related captions are available under **Spoken reply**. Other answers use the completion handoff. Fenced code stays available to read and copy. The current working indicator remains below the reader even while browsing earlier lines. A completed, plain-language acknowledgment of an upcoming read can be spoken while the tool works. Its caption shares the written item. An extended read can give a brief observed status when an acknowledgment is unavailable. Instructions and code wait for the editor receipt. Linked voice delegation records appear in the original user message’s Audio received details.
Threadlight preserves direct Live replies and records the association when it
asks Live to narrate a backing answer. [Validation and limits](validation/AGENT-CONTINUOUS-LIVE.md). A subtle blue perimeter animation indicates confirmed
Agent work in the minimized pill and becomes static with reduced motion. Tests include
simulated audio; the Brainstorm shortcut also has a recorded human keypress check.
See [Brainstorm voice evidence and limits](validation/BRAINSTORM-VOICE-VALIDATION.md).

During foreground Codex Agent Live sessions, a spoken question about “this app”
can identify the window you were using while speaking. A visual question can
inspect that window while its identity and focus still match. To share a region
of the desktop directly, hold Ctrl, right-drag, then release Ctrl. The mouse can
be released first to hold the outline. Escape cancels. The thread displays a
thumbnail and the accepted image stays in the same provider conversation for
follow-up questions. Claude hosted text and Perplexity account chats do not
currently provide this native Live transport.

The optional [Threadlight Live Coach companion](../vscode-coach/README.md) works
in a trusted desktop VS Code window on Windows. On request it shares a bounded
excerpt of the open buffer around the selection with the foreground Live Agent.
Each step reveals one line and a clickable hint before sending its explanation
to speech. Ask for one step at a time to start a guide for the current discussion.
Say “what’s next?” or click **Next step** to advance. **Finish guide** reports
completion to Live. Editing pauses the guide. Click **Refresh guide** or say
“continue” to reassess the updated buffer. For in-place file fixes, ask for inline diffs with the source tab open. Coach
reads the current buffer, locates insertions, replacements or deletions, and presents
one proposal at a time. Tab accepts one undoable edit or group. Alt+] navigates,
Alt+Backspace skips and Esc dismisses. Typing in the chosen location cancels stale
proposals. Companion 0.6.5 shows removed and added lines together, with **Result** and **Why this edit?** controls. Scrolling away keeps the proposal and its controls’ state. Acceptance and requested narration require the proposed location to be visible. Choose **Settings → VS Code → Automatic Python suggestions → On** in Threadlight, or ask the Agent to enable them. Companion 0.6.1 starts automatic ghost text and next-edit predictions when a trusted Python file opens. The default follows the VS Code checkbox.
For alternatives to a particular selection, select one range and ask for versions. An expanded review in the original
editor shows up to three versions. Tab accepts the displayed version into the
unsaved buffer, Esc dismisses it, and the arrow keys cycle versions. Switching
editors or changing the selection or buffer invalidates the preview. A separate
diff compares read-only snapshots. For “show me what goes on that line,” Trace
places native ghost text at a verified insertion point. It supports indented
and multiline additions without a selection. Typing and Backspace update the
remaining suggestion locally. Divergent text stays in the buffer and dismisses
the trace. Closing Live clears the guide, trace and inline preview.
See the [Windows editor and voice checks](validation/VSCODE-LIVE-COACH.md).

Ask Live to review the whole open file to share every page of the active text
buffer, including unsaved changes. No selection or screenshot is needed. The
review covers up to 32,768 UTF-16 units. Changing the active tab, editing the
file or disconnecting interrupts a review in progress. Findings can cite the
editor’s current diagnostics. The review never saves, edits or executes the file.
Each located finding begins with its line number and a short explanation.
If the open window still runs a companion without whole-file review, Live reports
zero coverage and gives the steps to activate an updated companion.

**Screen regions** has independent **In Live** and **Outside Live** switches.
Outside Live sends the crop to a fresh text conversation with the configured
Codex or Claude Agent. **Speak reply** reads the completed Codex answer using
the signed-in GPT Live voice. Claude answers use local Windows speech synthesis.
Both play with the microphone closed. Regions received while the Agent
is working or waiting for a decision queue until it is available. Disabling
Outside Live clears unsent regions. The shared gesture in a Live Brainstorm
conversation sends to that conversation. Identical JPEG content is suppressed while
pending and for five seconds after acceptance in the same route. Failed sends can
be retried, and unconfirmed delivery is reported separately. Replacing, ending
or expiring a standalone Codex run archives its owned chat and preserves Earlier
history. Startup retries pending archives and recovers explicitly marked, settled
standalone crops. Older chats are not inferred from titles.
Shared images follow the user's words and relevant conversation. Without a clear
request, the Agent explains an unmistakable visible issue, or acknowledges the
image and asks one short question about what the user wants.

A glowing diamond beside Settings opens the most recent foreground Live or crop
conversation, including after restarting. It pulses white for a current Agent
input request. The existing floating drips show the same
attention state. A settled conversation remains in the header for 24 hours.

Within Smart Thread, a needs-input card is the last item in the conversation
scroll area. The reader opens on that card above the composer. Scrolling upward
reveals earlier turns without expanding another history section.

## Shared Spaces

Open **Shared Spaces** from the header context menu and set up a workspace. The
test build has **Handoffs**, **Notes**, **Brainstorm**, **Workflow** and **Chats** areas.
Enable **Settings → Shared Spaces → Add to .gitignore** to show an optional checkbox
when creating a space. It starts unchecked for each new space and adds only
`/shared-spaces/<space-folder>/` to that workspace's `.gitignore`. Existing spaces
and rules stay unchanged; turning the setting off hides the choice without removing
rules already added.

Notes use the shared compact composer, including dictation: Enter saves and
Shift+Enter adds a line. New titles use the first sentence (up to 80 characters),
while the full text is retained. List titles stay on one line with a fade; open a
note to read it, or right-click for **Rename** and **Discuss**. Saving does not call
a model; **Discuss** opens a linked
discussion, and **New discussion** works without a note. Each discussion keeps its
own history and drafts.

Brainstorm uses the shared Agent interface with project-scoped tools. It reads
notes, enrolled chat evidence, handoffs, results and participant reports. Explicit
comparison controls add read-only context. On request, it can save or revise an
attributed note and validate/save workflow drafts. It can invoke an exact workflow
revision only under existing human authorization and current automatic project
policy, then inspect its runs and results. It cannot grant itself authority,
answer approvals or control the application. Review and authorize prepared
assignments separately in Handoffs. See the
[Brainstorm operating guide](BRAINSTORM-OPERATING-GUIDE.md).

Open a shared Python, JavaScript or TypeScript attachment and choose **Explain this file**
for a read-only walkthrough. The discussion names the exact snapshot and displays the
lines returned to Brainstorm. Select a cited line to inspect it. Follow-ups use the
same copy even after another file with that name is shared.
[Source review evidence](validation/SHARED-SOURCE-REVIEW.md)

**Chats** records project participants and their capability reports, including
whether evidence is reported or human-verified. Suggestions retain their supporting
rationale; a report is not proof that a delivery path has been tested.

Handoffs opens a work canvas: prepared discussion tasks and explicitly labelled
workflow assignments are grouped by objective; older unlinked work stays under
**Ungrouped**. Click a task for its full brief, pinned inputs, results and relevant
authorization/review actions. **Find** and **!** jump to work without reordering it.
Drag empty space to pan, wheel to scroll, Shift+wheel to move horizontally and
Ctrl+wheel to zoom at the pointer. Arrow keys pan, +/− zoom and Home fits when the
canvas has focus. **Fit** and the zoom percentage recover the view. Collapse an
objective from its header. **Folders & controls** retains the storage views.
The top-left arrow expands Handoffs or Workflow to a temporary square overlay;
restore keeps the current page and viewport and does not change saved panel settings.
Viewport/selection/collapse persist during this app session. See
[validation and limitations](validation/HANDOFFS-CANVAS-2026-10-29.md).

Handoffs also contains the current project communication/workflow controls:
roles, exact chat/model selection, project DMs and manual, assisted or automatic
progression. The scheduler checks dependencies, input versions, workspace conflicts
and budgets. Delivery receipts, questions and results remain inspectable. Remote
execution and unrestricted wakeup of desktop-owned chats are not claimed.

Production automatic Claude runtime wakeup remains gated on a real Claude Desktop
acceptance test. Existing-runtime registration and CLI proofs do not close that
gate; competing Claude CLI resumes remain disabled. The human Codex composer has
its own verified native message/queue path, separate from workflow delivery.

The Claude and Codex shared-memory plugins request a verification code for each
chat. The project’s **Chats** tab shows connected chats and a counted **Requests**
section when requests are waiting. Open a request, match its code and approve
read-and-publish access to the project bound in the request. Approval returns directly to Chats;
decision-card workflow settings are separate from this request screen.
With the updated plugin, a chat supplying its native ID can wait for approval
through `memory_wait_for_approval`, then verify enrollment and read its briefing
without a manual reply. This works only while the tool call is active; it does
not wake idle or closed chats. See [approval continuation limits](specs/CONNECTION-APPROVAL-CONTINUATION-SPEC.md).
Requests with a known native chat ID resolve the chat
automatically; older requests offer searchable chats across working folders. Installation alone grants no access. Connections
are explicit, temporary and revocable; reconnect after expiration or app/bridge
restart. Shared readable snapshots, versioning and conflict handling preserve
existing material during workspace migration.

See [shared-memory setup and recovery](SHARED-MEMORY.md),
[Brainstorm behavior](validation/SHARED-SPACES-BRAINSTORM-VALIDATION.md),
[shared conversation UI](validation/BRAINSTORM-CHAT-VALIDATION.md),
[participants](validation/PROJECT-PARTICIPANTS-VALIDATION.md) and
[workflow delivery evidence](validation/THREAD-COMMUNICATION-VALIDATION.md).

## Artifacts

Right-click a thread and choose **Artifacts**. The viewer discovers supported
local files explicitly linked or attached in recorded messages, including Codex
visualizations. Header chips and arrows select a file. **Refresh** rereads the
original, **Link file** adds a local reference, and **Keep a copy** explicitly saves
a snapshot. Missing originals and incomplete discovery remain visible.

PNG, JPEG, WebP, UTF-8 text/Markdown and self-contained HTML can be previewed, up to
5 MiB per file. HTML runs in an isolated preview with inline scripts, canvas and
controls, but no Threadlight bridge, Node, filesystem access, external resources,
WebRTC or persistent browser storage. JSX/TSX stays source text. PDF, Office and
media references can be listed but do not have previews. Cloud-only artifacts and
remote URLs are outside this implementation.

Thread rows no longer reserve an artifact checker strip; access remains in the
context menu and the viewer's navigation. See [reference discovery](validation/ARTIFACT-REFERENCES-VALIDATION.md)
and [interactive-preview validation](validation/INTERACTIVE-ARTIFACTS-VALIDATION.md).

## Install and run

Threadlight currently runs from a checkout. Requirements:

- Windows 10 (1803 or later) or Windows 11; the verified native Codex desktop
  transport currently requires Windows x64 and the packaged Codex distribution.
- [Node.js](https://nodejs.org/) 22.16 or later on PATH.
- The desktop app and signed-in native CLI for the provider you use. You can use
  Codex without Claude. Native integration compatibility depends on the installed
  provider build; see [Codex setup](../codex-plugin/README.md).

To build and run the application:

```powershell
npm install
npm run build
npm run start
```

For Claude plugin/setup automation, ask Claude Code to follow
[the setup skill](../skills/setup/SKILL.md), or run:

```powershell
node scripts/install.mjs --hotkey Control+Alt+Q --countdown 5 --corner top-right --autostart
```

The installer installs packages, builds the app, sets up the Claude plugin and
saves preferences. It does not install the Codex plugin; follow the separate
[Codex plugin instructions](../codex-plugin/README.md#enable). Review and trust changed
hooks in the provider, and reopen sessions when required to load them.

- `node scripts/install.mjs --check` reports setup status without changes.
- `node scripts/install.mjs --check-keys Control+Alt+Q` checks hotkey availability.
- `node scripts/install.mjs --uninstall` removes installer-owned setup; add
  `--remove-data` only when you also intend to remove local app data.

**Upgrade the app and both installed plugin packages together.** Current hooks
and local shared-memory/Agent MCP connections require authenticated encryption.
Old hooks, plaintext memory clients and mismatched servers do not silently
fall back to plaintext. Building does not refresh installed plugin caches or reload
a running app. See [the coordinated upgrade procedure](security/LOCAL-IPC.md#upgrade-both-app-and-plugins-together).

**Launch at sign-in** in Settings → App starts a quiet Windows launcher. It waits
for Claude or Codex to open before showing Threadlight. Quitting is respected until
another desktop app opens; turning the setting off also stops the launcher.
**Restart** is available in Settings → App and the tray. Finish active work before
using it; the Agent's restart flow also checks for other work and pending operations.
The Settings button immediately shows **Restarting…** and disables repeat clicks
while the app shuts down and reopens.

## Privacy and compatibility

Threadlight runs locally and has no telemetry or external Threadlight service.
Monitoring reads local Claude transcripts/desktop metadata and Codex history/activity
stores, plus plugin hooks. Those formats and the Codex desktop coordination protocol
include undocumented interfaces. Threadlight does not directly edit provider history
databases; message and answer actions use their supported adapter paths.

Local STT stays on your PC. Hosted Agent turns use your selected provider account,
and GPT Live sends audio to the provider. Local-only storage does not mean model
requests stay offline. Settings and recovery data are kept under
`%APPDATA%\Threadlight`; shared workspace snapshots and intentionally retained files
have their own documented locations.

The local trust boundary includes your Windows account, installed provider apps
and plugins. Verifying Codex's pipe server does not authenticate every participant
on its coordination bus. Same-account hostile processes and remaining upstream
router limitations are not solved by Threadlight. See [local IPC security and tested scope](security/LOCAL-IPC.md),
[PRIVACY.md](../PRIVACY.md) and [SECURITY.md](../SECURITY.md).

## Development and validation

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, checks and code layout, and
[AGENTS.md](../AGENTS.md) for the shared working rules. Run `npm run dev` for development.
Update [CHANGELOG.md](../CHANGELOG.md) under **Unreleased** as user-visible work lands;
update this README when capabilities, entry points or limitations change.

The linked validation records identify focused tests, isolated renderer/native
fixtures, installed-provider proofs and remaining acceptance work. Their results
apply to the stated code and environment, not every future provider version.
A passing build or isolated fixture is not a full release certification, a physical
microphone test or proof that a running app has reloaded. Historical records may
retain earlier failures; later evidence must explicitly establish what changed.

Feature proposals live in `docs/specs/`. Work in a separate, unmerged checkout and
specification-only changes must not be presented as available in the primary app.

## Licence

[MIT](../LICENSE) © 2026 Julius Deane. Third-party notices are in [NOTICE](../NOTICE).

### Save notes by purpose

Both Codex and Claude plugins accept `purpose: note | work_context | result`.
User-requested notes and ideas appear in the project's Notes and `notes/`, with
server-recorded saver, source chat and time. Notes edits use the same memory item
and revision history; discussing a note links it without copying. Checkpoints use
Handoffs/`handoffs/`; deliverables use `results/` and separate submission/acceptance.
Explicit-purpose saves never create assignments or send messages. Existing access
scopes still apply. Old callers omitting purpose and historical records retain
legacy routing; no author/keyword migration occurs. See
[the purpose contract](specs/NOTE-PURPOSE-SPEC.md) for compatibility details.
Activation requires the rebuilt app plus refreshing/reconnecting each installed
provider plugin; rebuilding alone does not replace an installed plugin cache.

### Connect to a named project

Ask the chat to connect to the intended Threadlight project. The updated Codex and
Claude plugins call `memory_list_projects` before enrollment, match its name and
send the returned stable `spaceId` with the request. Duplicate names or an unclear
match require a short clarification. Only names and IDs are discoverable; access
still needs human code confirmation in that project's **Chats → Requests**.
The open project cannot retarget approval. Older plugins/requests without a target
must be refreshed and recreated; they cannot silently use the open space.
