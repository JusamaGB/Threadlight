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
