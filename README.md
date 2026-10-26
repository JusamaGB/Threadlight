# Threadlight

A small status dot and mini composer for **Claude and Codex desktop chats** on Windows.

> **Unofficial.** Threadlight is not made by, affiliated with or endorsed by Anthropic or OpenAI.
> It reads files the Claude app and Claude Code keep on your PC, some of which are
> undocumented, so a Claude update can break it. See [What it reads](#what-it-reads).

> **Status: early development.** Nothing is released yet. This README describes the
> plan; features are ticked off in [CHANGELOG.md](CHANGELOG.md) as they land.

## What it does

- **A dot in the corner of your screen.** Green when none of your Claude Code sessions
  is working, pulsing red when one is. It only shows while the Claude app is running.
- **Click it** and it opens, in the same spot, into a list of your sessions: the ones
  working now first, then recent ones. Click a session to see its task plan, the step
  it is on and its last result.
- **Right-click a session → Compose** to type or speak a message to that thread. It is
  delivered in the background, without opening the Claude window.
  ✓ means delivered, ✓✓ means the thread read it and replied.
- **A talk hotkey** (default `Ctrl+Alt+Q`, press to start and again to stop, or push to
  talk) works anywhere, even in a game: say _"message docs site, check the build passed"_
  and Threadlight finds the thread, shows a short countdown you can cancel, and sends. Or
  turn on Hold, and the message waits for you to click Send.
- **Settings → Voice target** chooses **Agent conversation** or **Thread message**.
  Both support Toggle and Push to talk. Agent Toggle keeps listening between sentences;
  Push to talk submits when released. Closing the mic keeps the Agent conversation available
  until End or its inactivity limit. Thread messages use the review/countdown controls.
  In Agent mode, navigation commands are also available:
  Say **“open”**, then pause for one second, to expand and pin the thread list. That
  microphone session stays in command mode until closed; other speech is ignored.
  Close and reopen to choose again. Start with ordinary speech instead to send it to
  the Agent after a pause, keeping the mic open. Busy or failed sends remain visible
  for retry. The thread composer's mic always stays dictation for that thread.

Threadlight runs on your PC and transcribes speech locally. It has no telemetry or
external Threadlight service. Shared Spaces exposes authenticated collaboration tools on loopback;
agent turns still use your provider account.

### Shared Spaces

Open **Settings → Shared Spaces → Open** and set up the workspace. Workspace view
follows the thread view's workspace; other views offer a workspace selector. Setup
creates `shared-spaces/ideas/`, `plans/`, `handoffs/` and `results/` inside that workspace.
The location is fixed, with no alternative folder picker. The tabs are **Handoffs**,
**Ideas** and **Brainstorm**. This is a collaboration and handoff layer between Claude and Codex;
each provider keeps its own memory. Share the context a collaborator needs, rather
than maintaining another personal memory archive.

Capture an idea without calling a model, move it to Brainstorm, and discuss it with
the configured Agent. Each idea keeps its own resumable conversation, separate from
the general Agent. Edit a mini plan and choose each assignment's provider, exact chat,
brief and shared output folder. **Prepare assignments for review** saves a pinned plan
and unsent task drafts. Open each task in Handoffs to review and authorise delivery.
Prepared plans stay frozen so later discussion cannot change a recipient's brief.
This first version uses existing chats and their models; automatic task decomposition,
new-chat creation, dependency scheduling and workflow profiles remain future work.

Setup creates the workspace's collaboration space. In **Handoffs**, add named sectors/folders
for notes, decisions, scratchpads, images and documents. The map, folder, item and task
views stay inside the existing 342-pixel panel. Map/List, search, Back and saved drafts
let you browse without starting agent work.

Existing material stays **Unassigned** until you explicitly preview and confirm its
workspace assignment. Readable Markdown snapshots retain stable document IDs and
earlier versions. External edits are preserved and reported as conflicts. Brainstorms,
assignments and late results keep their original workspace even when you switch views.
Setup and destination checks also run in the main process before work can be dispatched.

**Claude and Codex plugins** include shared-memory tools and a common workflow skill.
Ask an installed plugin to connect this chat to Threadlight. It shows a verification
code; match it under **Shared Spaces → Handoffs → choose a space → Agent access**, then choose
the folder scope and permissions. Read-only is the default. Each chat uses its own
connection ID; installation does not grant access to all memory. Connections expire
after eight hours and need renewed approval after an app or bridge restart.

**Agent access** also creates enrollments for background assignments. Advanced users
can still copy a manual MCP configuration. A capability identifies an enrollment,
not a verified native chat identity. See [plugin setup](SHARED-MEMORY.md#plugin-setup)
for installation, updates and reconnecting existing chats.

**Delegate** creates a draft task with exact input versions and an output folder.
Review and authorise it, then permit dispatch in **Coordination**. Live chats wait;
closed idle chats use the existing background relay with temporary scoped tools.
Saved results are submitted separately from human acceptance. Automatic coordination
requires explicit permissions and is bounded by persisted time/turn limits, two
concurrent destinations and causal-loop checks. Pausing stops new dispatches.

See [SHARED-MEMORY.md](SHARED-MEMORY.md) for access, recovery, backup and verification details.

## Requirements

### Hosted Agent

Open **Settings → Agent → Provider** to choose Claude or Codex. The Agent works
independently of the Applications monitoring toggles, including when both are off.
Codex requires a signed-in native Codex CLI; Claude is not required for a Codex Agent.

Codex models and reasoning choices come from the installed runtime and load when
Agent settings opens. Select **Show additional models** to see hidden entries.
Availability still depends on your account. Model and connected-app choices apply
to new conversations; an existing or continued conversation keeps its selection.
Claude retains its Haiku conversation model and Opus/Sonnet worker.

The Agent streams replies, displays questions and approval cards, and keeps earlier
conversations under **Earlier**. **Stop** interrupts the current turn; **End** closes
the conversation. Continue resumes its original provider and model. An uncertain
send is retained for recovery and is never automatically sent again.

The same Agent conversation is reused until **Conversation lasts** expires (60 minutes
after the last reply by default) or you choose **End**. For Codex, ending also archives
the underlying thread. Its saved conversation stays in **Earlier**, outside the
workspace thread lists; **Continue** restores that same thread. Closing the mic does
not end the Agent conversation. Failed archive cleanup is saved for retry on startup.

Configured Codex MCP servers require permission for each tool call. Desktop-only
plugins and connectors are shown as unavailable until their permissions and
execution support can be verified. Codex Agent conversations use their own runtime
connection and are excluded from the monitored chat list. See the
[implementation specification](AGENT-CODEX-SPEC.md) and
[validation record](AGENT-CODEX-VALIDATION.md) for compatibility and test coverage.

### Show one application or both

**Settings → Applications** has independent **Claude** and **Codex** toggles. Enable
both for one list, ordered by working/waiting state and then recent activity. Each
row has a subtle right-edge tint (Codex blue, Claude orange); hovering identifies
the application, and the composer's header fades down in its destination's colour. The time window and session
limit apply to the combined recent list; workspace groups stay separate and are
labelled with their application, even when they share a folder.

Upgrading preserves the application you had selected. New installs keep Claude on
and Codex off until changed. Your choices are saved, with separate workspace
selections for Claude, Codex and the combined view.

Both off pauses chat monitoring. The dimmed dot and Settings remain accessible.
Disabling an application releases its held cards and prevents new background sends;
already accepted work continues. Composer drafts are saved in Threadlight's own
local recovery store and restored after restart; pending answer cards remain in
memory. Changing the toggles cancels any voice-send countdown.

An open Codex chat currently shows **Copy and open Codex** explicitly. This copies
your draft and opens its destination for you to paste; it does not submit it.
Enter and voice countdowns never trigger that fallback. Delivery into the existing
desktop runtime remains gated on the connection proof in the
[completion roadmap](CODEX-INTEGRATION-SPEC.md#28-selected-desktop-chat-messaging-completion-roadmap).

### Installed applications

- Windows 10 (1803 or later) or Windows 11
- The Claude desktop app with Claude Code sessions
- The Claude Code CLI signed in (`claude auth login`) for background sending

## Install

Until the first release, Threadlight runs from a copy of this repository. You need
[Node 22.16 or later](https://nodejs.org) as well as the requirements above.

**Ask Claude to do it.** Open Claude Code in the folder and say _"set up Threadlight"_. It
follows [skills/setup/SKILL.md](skills/setup/SKILL.md): checks your PC, tells you what will
change, asks for your talk hotkey and a few preferences, then runs the installer and checks
that it works.

**Or run the installer yourself** from the folder:

```
node scripts/install.mjs --hotkey Control+Alt+Q --countdown 5 --corner top-right --autostart
```

It installs the app's packages and builds it, installs the Threadlight plugin for Claude
Code (the hooks that report session activity), saves your choices, and starts the app.
Every option is optional. Running it again changes only what is not right yet.

- `node scripts/install.mjs --check` says what is and is not set up, and changes nothing.
- `node scripts/install.mjs --check-keys Control+Alt+Q` says whether a hotkey is free.
- `node scripts/install.mjs --uninstall` stops Threadlight, turns off start at sign-in and
  removes the plugin, but only if the installer added it. Add `--remove-data` to also
  delete your settings and the speech model (`%APPDATA%\Threadlight`).

The hooks only reach Claude Code sessions started after the plugin is installed. The voice
speech model (76 MB) downloads the first time you use voice, after you agree to it.

## What it reads

### Codex

Enable **Settings → Applications → Codex** for local Codex chats. Leave Claude on
to see both together; drafts remain with their chat. Read
[Codex setup and behavior](codex-plugin/README.md) for plugin installation and trust,
live-chat copy-and-open, held questions/approvals, and compatibility limits.
Codex users need the signed-in Codex desktop app and native CLI instead of Claude.

Codex rows show the current numbered step when Codex has emitted a tracked plan.
Expanded chats also show proposed plans from plan mode, formatted separately from
completed/in-progress steps. Plans stay visible above waiting question cards.
Ordinary replies are not converted into invented checklists.

The separate blue usage line shows Codex's **weekly** account quota, read from local
session reports. Hover for the percentage, reset time and when Codex last reported it.
It updates as Codex records usage; Threadlight makes no probe requests. Missing or
expired reports show an unavailable line rather than 0%. Claude keeps its own bar
and window selection; with both applications enabled, the two lines are stacked.

### Claude

All read-only, all on your PC:

| What                                           | Where                                    | Documented by Anthropic? |
| ---------------------------------------------- | ---------------------------------------- | ------------------------ |
| Session activity from Claude Code hooks        | sent to Threadlight on `127.0.0.1`       | Yes                      |
| Session transcripts                            | `%USERPROFILE%\.claude\projects\`        | No                       |
| Claude app thread list (titles, archived flag) | `%APPDATA%\Claude\claude-code-sessions\` | No                       |

Sending a message runs your own `claude` CLI (`claude --resume <session> -p "…"`),
with that thread's own permission mode. Threadlight never sends to a thread the Claude
app currently has open, and voice sends always count down first so you can cancel.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE) © 2026 Julius Deane. Third-party notices are in [NOTICE](NOTICE).
