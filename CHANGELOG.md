# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- Settings are stored in `%APPDATA%\Threadlight\settings.json`; a damaged or partly
  invalid file falls back to defaults field by field, never losing the rest.

### Fixed

- A session whose Claude Code process ended (for example after a background reply) no
  longer flips back to "working" for 30 seconds.
