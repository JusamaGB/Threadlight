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

Everything runs on your PC. Speech is transcribed locally. Threadlight has no
telemetry and no servers.

## Requirements

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
already accepted work continues. Drafts and pending answer text stay with their
chat in memory, and changing the toggles cancels any voice-send countdown.

### Installed applications

- Windows 10 (1803 or later) or Windows 11
- The Claude desktop app with Claude Code sessions
- The Claude Code CLI signed in (`claude auth login`) for background sending

## Install

Until the first release, Threadlight runs from a copy of this repository. You need
[Node 22.13 or later](https://nodejs.org) as well as the requirements above.

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
