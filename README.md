# Threadlight

**Keep your AI work in view without keeping every chat window in front.**

Threadlight is a compact Windows desktop overlay for following AI chats, replying,
reviewing code changes and keeping project context together. It lives at the edge
of your screen and opens into a small, contextual panel when you need it.

**Early source preview · Windows only · MIT licensed**

Visit the [Threadlight website](https://threadlight.jocosewasp4.chatgpt.site/) for an overview,
a copyable assisted-setup prompt, manual instructions for the public source preview, and answers about compatibility and privacy.

This is an independent community project, not an official product of Anthropic,
OpenAI, Perplexity or Moonshot AI. Some integrations depend on private desktop
interfaces and can break when those apps update. Expect rough edges and uneven
provider support; this is not a production-stability promise.

## What it does

- **Follow work:** Active, Recent and Workspace views, provider colours, plans,
  questions and activity. Click a pinned Active thread to read or reply beneath
  your current page. Back collapses the thread and keeps your place.
- **Read and reply:** compact conversations, saved drafts, local dictation and
  contextual history loading. Ordinary ChatGPT and Perplexity chats sit alongside
  coding threads in Recent. Replies show code in expanded, copyable cards with
  language labels and syntax colouring for supported languages. During a GPT Live conversation, a thread composer’s
  mic takes over for dictation. The floating waveform turns red until Live can
  hear you again. You can still hear the Agent while dictating.
- **Review changes:** inspect recorded edits and Git changes with their source and
  coverage shown. Preview local images, text and self-contained HTML artifacts.
- **Understand a shared source file.** In a Space’s Handoffs, open a folder and use **Add file** to share a small Python, JavaScript or TypeScript file. Open the attachment and choose **Explain this file**. Brainstorm explains the selected copy, shows how many lines it read, and links its answers to the source. [File review guide](docs/BRAINSTORM-OPERATING-GUIDE.md#explain-a-shared-file)
- **Keep context together:** Shared Spaces for notes, project discussions and
  handoffs. Optional plugins connect individual Claude/Codex chats after approval.
  The foreground Agent can request a new Claude Code or ordinary Perplexity chat
  in a named Shared Space. Its decision card shows the provider, space, opening
  message and role before you approve it.
  Shared-space messaging can also send bounded briefs to ordinary ChatGPT and
  Perplexity chats and collect their text replies in the sender inbox. See
  [account-chat messaging and limits](docs/ACCOUNT-CHATS.md#shared-space-messaging).
- **Explore workflows:** a hosted Agent, Brainstorm and workflow tools are included
  as experimental features with explicit authorization and documented limitations.
  Scroll continuously through Agent messages, activity, decisions and source
  links. Replies display formatting, links, tables and collapsible, copyable code.

## Provider status

| Provider        | In this preview                                                                                | Still catching up / not included                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Codex**       | Coding threads, native messages and questions, activity, changes and queue integration         | Compatibility depends on the installed Windows desktop version; hosted Agent tools differ from desktop-chat tools           |
| **ChatGPT**     | Ordinary chat history, replies, reported activity and formatted answers                        | Snapshot polling, not token streaming; interactive task cards, complete citations and attachment parity are not implemented |
| **Perplexity**  | Ordinary chat history/replies, reported activity, sources, plan steps and suggested follow-ups | Computer integration is experimental; credit-backed execution and approval flows do not have full live acceptance           |
| **Claude Code** | Existing session monitoring, saved-history reading, composer and plugin integration            | Catch-up and renewed live validation are priorities; new-chat creation and ordinary Claude account chats are not available  |
| **Kimi**        | Development code retained in the repository                                                    | Hidden from the public UI. Runtime integration is being worked on; no usable Kimi execution is claimed                      |

Claude support has not kept pace with the newer Codex work. The preview keeps that
limitation visible rather than implying feature parity. See [known limitations](docs/LIMITATIONS.md).

## Run from source

In Claude Code, Codex, or an assistant with command access to your Windows PC, paste
**“Set up https://github.com/JusamaGB/Threadlight on this PC. Read its setup skill,
ask which providers I use, and verify the installation.”** A browser-only chat can
walk you through the same commands. Use a durable source folder for the app.

The [setup skill](skills/setup/SKILL.md) is bundled with both coding plugins.
The [standalone Perplexity setup skill](perplexity-skill/threadlight-setup/SKILL.md)
is prepared for Computer accounts with **Plugins → Add custom → Upload plugin or skill**.
Upload and automatic setup from Perplexity are unverified. A local assistant can read
the setup instructions directly from a checkout that includes them.

There is no signed installer or automatic updater in this preview.

You need **Windows x64**, **Node.js 22.16 or later**, Git, and access to the provider
apps you want to use. Install and sign in to those apps separately. Claude and
hosted Agent features may also require the corresponding signed-in CLI. You can
use Codex without installing Claude.

```powershell
git clone https://github.com/JusamaGB/Threadlight.git
cd Threadlight
node scripts/install.mjs --providers codex
```

Choose `claude`, `codex`, `perplexity`, or a comma-separated combination.
Setup builds and launches the overlay and installs the selected coding plugins.
On first installation it selects those providers in Settings. With existing
settings, review **Providers shown** and **Chat providers shown** in the app.
Run `node scripts/install.mjs --check --providers codex` with your list for
diagnostics. Review hook trust and sign-in in the provider app. Shared memory
requires approving the intended chat and space in Threadlight. The manual
build route is `npm ci`, `npm run build`, then `npm start`.

If a manual build succeeds but Electron is missing, run the source setup command
above with your providers. It verifies the Windows runtime archive against the
checksum supplied by the installed Electron package and extracts it with Windows tar.

Open Settings from the panel or tray. Choose **Providers shown** and **Chat
providers shown**, then select Active, Recent or Workspace. The footer identifies failed chat operations. An amber **Chat list** light means automatic list refresh paused after a rate limit. ChatGPT checks the list at startup and then at most once a minute while the list is on screen. Repeated limits space retries farther apart. Choose **Copy diagnostics** to capture the failure category and timestamps. ChatGPT account-chat
access currently requires a compatible Codex desktop installation and an existing
local Codex chat; it is not a standalone API integration.

For hooks and shared memory, follow [Claude/shared-memory setup](docs/SHARED-MEMORY.md)
and [Codex plugin setup](codex-plugin/README.md). Upgrade the app and its plugin
packages together. Installing a plugin does not grant a chat access to project data.

- [Account chat setup and compatibility](docs/ACCOUNT-CHATS.md)
- [Perplexity ordinary chats and Computer limitations](docs/PERPLEXITY.md)
- [Detailed feature guide](docs/FEATURES.md)
- [Workflows](docs/WORKFLOWS.md)

## Privacy and control

Threadlight runs locally and has no Threadlight account, telemetry service or
hosted backend. **Provider requests are not offline:** replies, hosted Agent work,
Perplexity Computer and GPT Live use your provider accounts and their services.
Local speech transcription stays on your computer after the model download.
During Codex GPT Live on Windows, ask “which app is this?” or ask for help with
the window in front while you speak. To share a picture, **hold Ctrl, right-drag
over the region, then release Ctrl**. Mouse-up fixes the outline. Ctrl-up sends
it to the same Agent, even without a spoken question. Escape cancels the outline.
The Agent uses the crop to answer your question. If your intent is unclear,
it explains an unmistakable visible issue or briefly asks what you want help with.
In **Settings → Voice → Screen regions**, choose **In Live**, **Outside Live**,
both or neither. Outside Live starts a fresh Agent conversation and keeps the
previous one in Earlier. Identical captures share one delivery while pending and
for five seconds after acceptance. A different image can be sent immediately.
Retired standalone Codex crops are archived and can be reopened in Earlier.
**Speak reply** uses the GPT Live voice for Codex and
the Windows voice for Claude. Your microphone stays closed. Outside Live is
opt-in on new installations.

After a screen region or foreground Live conversation, click the glowing Agent
diamond beside Settings to return to that conversation. A current Agent input
request pulses white and activates the floating drips while the panel and
microphone are closed. Completed replies keep a quiet shortcut for 24 hours.

A Smart Thread waiting for input opens at its question or approval card above
the composer. Scroll up within the reader to see the conversation that led to it.
For a native Codex question, **×** dismisses that question in Threadlight. Use
**Stop ignoring** in the thread menu to restore it. Codex keeps control of the
answer. Threadlight clears the card when Codex confirms the matching answers
or ends the turn. A voice transcript alone can leave the card pending.
Over a code block or recorded text file, use **Shift+wheel** to scroll sideways,
or hold **Ctrl** and left-drag to pan in either direction. Right-click its header
(or press **Shift+F10**) and choose **Pin**. Each pinned file folds independently.
Hover or focus its header for the full name and source details in the footer.
Unnamed snippets show their first line. Drag the reference’s lower edge to resize
it, or focus the edge and press **Up** or **Down**. A detached reference anchored
at the bottom resizes from its upper edge. The spinning logo stays clickable.
Right-click an entry for **Previous version** or **Next version**. Copy uses the
version on screen. **Unpin** removes that entry and its saved versions.

To discuss a pin, click inside it and ask the foreground Agent, “Explain my
selected pinned code.” You can also ask it to append to or replace the latest
pinned copy. Review the change in the Agent decision card. Your editor and
source file keep their contents.

With Codex as the Agent provider and **Ctrl+Alt+Q** configured as the Talk shortcut, press it for spoken replies even when Local STT is selected. Press it again to stop. In an expanded Smart Thread, select reply text and right-click for **Copy**, press **Ctrl+C**, or open the Copy menu with **Shift+F10**.
Open **Settings → Hotkeys** to see or change the Talk binding and browse Threadlight
shortcuts and VS Code companion defaults. During an Agent or Brainstorm call,
press **Pause/Break** or **Ctrl+Alt+M** to mute or unmute the microphone from any
window. Use the keyboard's Pause function (some keyboards require Fn), or the
microphone button if a shortcut is unavailable. The speaker button mutes playback independently. **Stop speaking**
silences the current reply. **End call** disconnects voice and keeps the current chat
available for typing or another call. The pencil sits beside the call controls during an Agent call. It toggles the reply box and keeps your draft. The new-chat icon starts fresh, and the bin closes the conversation and keeps it in Earlier. Both wait for active work and decisions. Hover over the floating waveform for half a second to open the call centered on it, or drag it to move the pill and its reply together. Right-click anywhere on the pill, or focus it and press **Shift+F10**, to pause or resume listening, stop an audible reply, or hang up. The waveform follows audible speech. A separate
working mark in the Agent and travelling blue marks around the floating pill
show when a task is running.

Open **Audio received** to read or copy the original voice delegation. Use
**Reply** at the top of the Agent to open the message composer at the bottom, or
use the green phone beside it to speak in the same chat. **New updates** returns to the latest message and **Needs input**
takes you to a pending decision.
Unanswered Agent questions and approvals appear below the latest message.
Answered cards return to their place in history with the recorded response.
If the original message is off-page, **Load earlier messages** in Earlier shows
it when available. **Saved cards** keeps decisions readable when their position is unknown.
Hover over the waveform or focus it and press **Enter** to return to the ongoing conversation. Moving away can collapse the panel while the call continues; other pages offer **Return to call**.
Open the gear immediately left of **Back** for Agent settings and **Earlier** conversations. Enable **Show spoken replies in waveform pill** to follow the latest Agent reply while a GPT Live call is collapsed. The waveform centers the caption and widens as the words arrive, up to 296px before wrapping. Linked code stays left-aligned beneath it. A requested example can appear when its backing answer arrives, and a follow-up can refer to that same example without reopening the panel. Use the × to dismiss just that reply. The next reply opens automatically. The setting is off by default.
Smart Thread and Agent use the same assistant reply text size and line spacing. Use the two-card Copy icon on a code block to copy its contents. A pinned block copies the version on screen. Drag the grip below the conversation to resize the reading area,
or focus it and use the arrow keys. Threadlight remembers the height.

For delegated answers, GPT Live can speak a complete opening sentence while the
Agent continues writing. When Live confirms that opening finished, it can speak the
remaining prose once. If playback is uncertain, choose **Read remaining** in the
Agent. Expand **Spoken reply** beneath the written answer to read the actual caption.
The full answer and code stay in the thread. A spoken request has one
**Audio received** disclosure for its delegation records. A working indicator
stays below the conversation while the Agent is waiting on the editor. [Timing and validation](docs/validation/AGENT-CONTINUOUS-LIVE.md)

In **Agent Settings → Voice pace**, choose Slower, Slightly slower, Normal, Slightly faster or Faster. The choice applies to the next call or spoken screen reply. GPT Live uses a speaking-style instruction and Windows screen replies use the synthesizer’s rate. Normal is the default.

GPT Live gives a brief cue once the microphone and connection are ready; speaker mute silences it. Opening the call still buffers early speech while the native session connects.

For optional code coaching, install the [VS Code desktop companion](vscode-coach/README.md).
Run **Threadlight: Start Live Coaching** in the editor window you want to share.
Ask foreground GPT Live “Review the whole file I have open and tell me what looks wrong, if anything.”
It reads the active text tab, including unsaved edits, without a selection or screenshot.
The review supports up to 32,768 UTF-16 units and leaves the file untouched.
After upgrading the companion, reload the connected VS Code window and run
**Threadlight: Start Live Coaching** again to activate the installed version.
Place the cursor near your code, start foreground GPT Live and ask for a walkthrough.
Findings start with a verified line number where available and a brief explanation.
Ask “Could you show me one step at a time?” to walk through the issue just discussed.
Typing clears the old highlight quietly. With a companion that supports verified guide edits, a step with one declared exact target line requests a fresh source check when that line matches. For open-ended steps or partial edits, say “I’m done,” “check this,” or “what’s next?” to have the coach check your work. **Next step** and **Refresh guide** are also available. **Finish guide** closes
the last step and confirms completion in Live. To practise typing the next
line, ask “Could you fill that line for me?” **Trace** places ghost text at a
verified insertion point without requiring a selection. Type along, use Tab
to indent, or press Esc to dismiss it. Companion 0.6.2 stops explicitly retriggering the inline-suggestion sound as you type. VS Code’s own accessibility preferences still control suggestion cues. When ready, say “I’m done, let’s move
on” for a fresh check of your code. Ask “There are issues in my file; show me the inline diffs.” Coach reads the active
buffer and brings each proposed change into view. You can type your own fix, press
Tab to accept, Alt+] to see the next, Alt+Backspace to skip, or Esc to dismiss.
Each accepted proposal or dependent group is one Undo. Ask for a spoken explanation
while the change is visible. Selecting a range and asking for alternatives still
supports ← / → to cycle versions. With companion 0.6.1 or newer, choose **Settings → VS Code → Automatic Python suggestions → On** in Threadlight, or ask the Agent “Turn on automatic Python suggestions.” Trusted Python editors then offer ghost text and related edits whenever you open them, even with Threadlight closed. The default **VS Code setting** follows the editor checkbox. Ask for a **separate diff**
to compare read-only snapshots, including unsaved edits.

The app reads local chat metadata/history and talks to installed provider apps.
Drafts, settings and recovery records are stored locally. Shared Spaces contain
context you explicitly publish; connected chats need your approval. Screenshots,
logs and exported project data can contain private information, so review them
before sharing an issue.

Read [Privacy](PRIVACY.md), [Security](SECURITY.md) and the
[local IPC model](docs/security/LOCAL-IPC.md) before enabling advanced integrations.
Existing subscriptions, credits and provider terms still apply.

## Development and feedback

```powershell
npm run dev
npm run check
npm run build
```

Read [Contributing](CONTRIBUTING.md) for the architecture, focused UI tests and
plugin packaging. The public preview is a starting point for feedback, especially
around installation, provider compatibility, accessibility and compact UI behaviour.
Please include your Windows/provider versions and a minimal reproduction, with
private chat content removed. Report security issues privately as described in
[SECURITY.md](SECURITY.md).

[Changelog](CHANGELOG.md) · [Roadmap](docs/ROADMAP.md) · [MIT license](LICENSE)
