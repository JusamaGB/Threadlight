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
