# Threadlight

A small status dot and mini composer for the **Claude desktop app** on Windows.

> **Unofficial.** Threadlight is not made by, affiliated with or endorsed by Anthropic.
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
- **A talk hotkey** (default `Ctrl+Alt+Q`, press to start, press again to stop) works
  anywhere, even in a game: say _"message docs site, check the build passed"_ and
  Threadlight finds the thread, shows a short countdown you can cancel, and sends.

Everything runs on your PC. Speech is transcribed locally. Threadlight has no
telemetry and no servers.

## Requirements

- Windows 10 (1803 or later) or Windows 11
- The Claude desktop app with Claude Code sessions
- The Claude Code CLI signed in (`claude auth login`) for background sending

## Install

Planned: ask Claude to set it up for you, or install manually from a release.
Instructions will be added with the first release.

## What it reads

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
