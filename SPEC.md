# Threadlight — build spec (v1)

> Author: Julius Deane. Repo is local-only until a GitHub account is chosen (§14).
> This file is the plan for the rebuild. It moves to `docs/ARCHITECTURE.md` once the code exists.

## 1. What it is

A small, unofficial desktop companion for the **Claude desktop app** on Windows.

- A status dot in a screen corner: green when no Claude Code session is working, pulsing red when one is.
- Click it: it becomes a panel in the same spot listing sessions (active first, then recent), each expandable to its task plan, current step and last result.
- Right-click a session → **Compose**: type or talk a message to that thread. It is delivered in the background without opening the Claude window. ✓ = delivered, ✓✓ = read and replied.
- **Talk hotkey** anywhere (including in games): press `Ctrl+Alt+Q`, say _"message docs site, check the build passed"_, press it again. The panel opens with the matched thread and text, counts down, sends.
- Visible only while the Claude desktop app is running.

Not affiliated with or endorsed by Anthropic. It reads files the Claude app and Claude Code leave on disk; it never talks to Anthropic servers itself (background sends run the user's own `claude` CLI).

## 2. Principles (because it is public)

1. **Nothing personal in the repo, ever.** No real paths, names, thread titles, transcripts, emails or screenshots of real work. Fixtures are synthetic.
2. **Local only.** No telemetry, no analytics, no network except the one-time speech model download, which is shown and confirmed.
3. **Ask before changing the user's machine.** Hooks, autostart and model download are each listed and confirmed during setup, and each is reversible (`uninstall`).
4. **Honest about fragility.** It depends on undocumented Claude app internals (§6). The README says so up front, and the app fails soft (dot stays, features degrade, a clear message says why).
5. **Safe by default for sending.** A background send runs with that thread's own permission mode. Voice sends always show a countdown that can be cancelled. Threads currently held open by the app are never written to.
6. **Readable code for newcomers.** Strict TypeScript, small modules, a comment wherever the _why_ is not obvious, no clever abstractions.

## 3. Stack

| Concern         | Choice                                                                     | Why                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language        | TypeScript 5.x, `strict: true`                                             | Types catch mistakes early; mainstream                                                                                                                                         |
| Shell           | Electron (current stable)                                                  | Same platform as the Claude app; transparent always-on-top windows; crisp CSS rendering                                                                                        |
| Build           | `electron-vite`                                                            | One config for main/preload/renderer; fast HMR                                                                                                                                 |
| UI              | React 19 + CSS modules                                                     | Most widely known; no UI kit needed for a panel this small                                                                                                                     |
| Global keys     | Electron `globalShortcut`                                                  | Talk is a **toggle** (press to start, press to stop), so key-down is enough and no native add-on is needed. A hold-to-talk mode would need `uiohook-napi`; out of scope for v1 |
| Speech-to-text  | `@huggingface/transformers` (Whisper `base.en`, ONNX) in a utility process | Pure JS/WASM, no compiler or Python; model downloaded once to app data                                                                                                         |
| Mic capture     | `getUserMedia` in a hidden renderer                                        | Chromium handles devices and resampling                                                                                                                                        |
| Tests           | Vitest                                                                     | Fast, TS-native                                                                                                                                                                |
| Lint/format     | ESLint (flat config, `typescript-eslint`) + Prettier                       | Standard                                                                                                                                                                       |
| Packaging       | `electron-builder` → NSIS installer + portable zip                         | GitHub Releases                                                                                                                                                                |
| Package manager | npm                                                                        | Lowest friction for contributors                                                                                                                                               |
| Node            | ≥ 20 LTS for development only                                              | End users get the packaged app                                                                                                                                                 |

Measured 2026-10-25: `onnx-community/whisper-base.en` at `q8` (76 MB) through transformers.js 4 + onnxruntime-node transcribes a 5.2 s clip in ≈1.5–1.8 s on the CPU, word-perfect; the model loads in ≈5 s once per launch. No need for the `whisper.cpp` fallback. Packaging (step 9): `onnxruntime-node`'s native binaries must be unpacked from the asar archive, and `sharp` (pulled in by transformers.js for images; its prebuilt libvips is LGPL) should be excluded since voice never uses it.

## 4. Repository layout

```
threadlight/
├─ .claude-plugin/
│  └─ plugin.json              # Claude Code plugin manifest (name, version, author, skills, hooks)
├─ hooks/
│  └─ hooks.json               # Claude Code hook definitions shipped with the plugin (§8)
├─ skills/
│  └─ setup/
│     └─ SKILL.md              # "set this up for me": checks, questions, install, verify (§9)
├─ scripts/
│  └─ install.mjs              # deterministic installer the skill calls; --check / --uninstall
├─ src/
│  ├─ main/                    # Electron main process (Node side)
│  │  ├─ index.ts              # app lifecycle, single-instance lock, windows, tray
│  │  ├─ windows.ts            # dot + panel BrowserWindows (frameless, transparent, top-most)
│  │  ├─ tray.ts               # tray icon + menu (settings, pause, quit)
│  │  ├─ claudeApp.ts          # is the Claude desktop app running? deep links (claude://)
│  │  ├─ hookServer.ts         # 127.0.0.1-only HTTP endpoint receiving hook events
│  │  ├─ hotkeys.ts            # talk toggle / open-composer / toggle-panel via globalShortcut
│  │  ├─ relay.ts              # background send: guard → claude --resume -p → result
│  │  ├─ settings.ts           # typed settings with defaults + schema validation (zod)
│  │  ├─ ipc.ts                # typed IPC handlers (single source: src/shared/ipc.ts)
│  │  └─ sessions/
│  │     ├─ tracker.ts         # merges hook state + transcripts + app records → Session[]
│  │     ├─ transcript.ts      # incremental JSONL reader (plan replay, interrupts, titles)
│  │     ├─ appRecords.ts      # reads Claude app thread records (titles, ids, archive flag)
│  │     ├─ hookState.ts       # in-memory + persisted hook states
│  │     └─ paths.ts           # every on-disk location in ONE place (§6)
│  ├─ preload/
│  │  └─ index.ts              # contextBridge: exposes the typed API, nothing else
│  ├─ renderer/                # React UI
│  │  ├─ index.html
│  │  ├─ main.tsx
│  │  ├─ dot/Dot.tsx           # the pulsing dot
│  │  ├─ panel/Panel.tsx       # header, session list, expand/collapse
│  │  ├─ panel/SessionRow.tsx
│  │  ├─ panel/SessionDetail.tsx
│  │  ├─ panel/ContextMenu.tsx # right-click: Compose / Open in Claude
│  │  ├─ composer/Composer.tsx # To-line, input, wave, send, mic, ticks
│  │  ├─ composer/useRecorder.ts
│  │  ├─ settings/Settings.tsx # every setting has a home here (§10)
│  │  ├─ theme.css             # design tokens (§11)
│  │  └─ i18n/en.ts            # all user-facing strings in one file
│  ├─ stt/
│  │  ├─ worker.ts             # utility process: loads Whisper, transcribes PCM
│  │  └─ index.ts              # interface: transcribe(Float32Array) → string
│  └─ shared/
│     ├─ types.ts              # Session, SessionState, PlanItem, RelayStatus, Settings
│     ├─ ipc.ts                # channel names + payload types
│     └─ match.ts              # fuzzy thread-name matching for voice commands
├─ test/
│  ├─ fixtures/                # SYNTHETIC transcripts/app records only (never real)
│  ├─ transcript.test.ts
│  ├─ tracker.test.ts
│  ├─ match.test.ts
│  └─ relay.test.ts            # with a fake CLI
├─ docs/
│  ├─ ARCHITECTURE.md          # this spec, kept current
│  ├─ HOW-IT-WORKS.md          # plain-English tour for learners
│  └─ images/                  # screenshots made with the demo profile only (§12)
├─ .github/
│  ├─ workflows/ci.yml         # windows-latest: install, lint, typecheck, test, build
│  ├─ workflows/release.yml    # on tag v*: build installer, draft GitHub Release
│  ├─ ISSUE_TEMPLATE/bug_report.yml   # asks for Claude app version + Threadlight version
│  ├─ ISSUE_TEMPLATE/feature_request.yml
│  ├─ pull_request_template.md
│  └─ dependabot.yml
├─ .editorconfig  .gitattributes  .gitignore  .nvmrc  .prettierrc
├─ eslint.config.js  tsconfig*.json  electron.vite.config.ts  electron-builder.yml
├─ package.json
├─ README.md  LICENSE  NOTICE  CHANGELOG.md
├─ CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  PRIVACY.md
```

Naming: files `camelCase.ts`, React components `PascalCase.tsx`, one exported concern per file, no `utils.ts` grab-bags.

## 5. Process model and security

- **Main process** owns all file reading, process checks, the hook server, hotkeys and relay. The renderer never touches the filesystem.
- **Preload** exposes one frozen object (`window.threadlight`) with typed methods generated from `src/shared/ipc.ts`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP (`default-src 'self'`), no remote content, `will-navigate` blocked.
- **Hook server** binds `127.0.0.1` on a configurable port (default 47615). It only accepts hook-event JSON (`session_id`, `hook_event_name`, …) and only updates in-memory state. It has **no** endpoint that sends messages.
- **Sending** (UI or hotkey) is in-process only in v1. A future local API for other apps (e.g. a voice assistant) must require a per-install token stored in the user profile, and is out of scope for v1.
- Relay passes the message as an argument array (never through a shell) to the user's `claude` CLI.

## 6. Data sources (all read-only)

Centralised in `src/main/sessions/paths.ts` so a Claude update means editing one file.

| Source             | Location                                                 | Used for                                                                      | Documented?              |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| Hook events        | delivered to the hook server (§8)                        | exact working / waiting / idle                                                | Yes (Claude Code hooks)  |
| Transcripts        | `~/.claude/projects/*/<session>.jsonl`                   | plan, current step, last action, last reply, interrupts, cwd                  | **No** — internal format |
| App thread records | `%APPDATA%/Claude/claude-code-sessions/*/*/local_*.json` | desktop title, `local_…` id, `cliSessionId`, archived, permission mode, model | **No**                   |
| Deep link          | `claude://claude.ai/epitaxy/<local id>`                  | "Open in Claude"                                                              | **No**                   |
| Claude app process | process list, image path not under `claude-code`         | show/hide the dot                                                             | n/a                      |
| Held-thread check  | `claude.exe` command lines containing the CLI session id | refuse to write to a thread the app holds                                     | n/a                      |

Rules carried over from the Python prototype:

- State = hook state if present; a thread with an interrupt marker (`[Request interrupted…`) after its last activity is **idle** (Stop has no hook event); "working" with no heartbeat for 10 min is **idle**; unhooked threads fall back to "transcript changed in the last 30 s".
- Plan is replayed from `update_plan` calls (`items`, `advance`, `done`, `start`) and closed by `wrap_up`.
- Archived threads are hidden. Lists show threads active in the last 24 h, max 10, working → waiting → most recent.
- Transcripts are read incrementally (byte offset), never fully re-read; scanning runs off the UI thread.

## 7. Features (v1 = parity with the prototype + hotkeys + settings)

**Dot** — 22 px, draggable, position remembered per display; pulses while any session works; hidden when the Claude app is not running.

**Panel** — opens in the dot's place (top-right corner anchored to the dot; flips when near screen edges); closes on any click outside or `Esc`. Header: "Active"/"Recent", counts, and the dot itself (click toggles Active/Recent). Rows: state dot, title, age, one-line stage. Click to expand: status, folder, last prompt, plan with ✓/●/○, "Now", result or last reply, Open ↗.

**Context menu** — right-click a row: Compose, Open in Claude.

**Composer** — hidden until Compose. Shows `To <thread>` and ×. Input with an in-field hint; Enter sends, Esc closes. Mic: click to record, again to stop; live level bars; transcript appended into the input. Ticks: `…` sending, `✓ Sent` delivered, `✓✓ Read` replied (reply shown on the row for 2 min), amber on failure with the reason.

**Talk hotkey** — default `Ctrl+Alt+Q` as a toggle (not `Ctrl+Alt+Space`: the Claude app's quick entry owns it) (press to start recording, press again to stop; auto-stops at 90 s); configurable. While recording the dot itself turns blue and breathes, and shows a spinner while transcribing (no extra window). The panel then opens with `showInactive()`, so a full-screen game keeps focus; Esc cannot reach an unfocused window, so the hotkey and × cancel, and an untouched panel closes itself 4 s after the reply. On stop: transcribe → parse `message|tell|send to <thread>[,:] <text>` → fuzzy-match against visible titles (`shared/match.ts`, token overlap + prefix bonus, threshold 0.6) → open panel with the composer filled → 3 s countdown ring (configurable 0–10 s; 0 only with an explicit setting) → send. Hotkey again or × cancels. No match → composer opens with the text and the list highlighted to pick.

**Relay guard** — refuse when the thread is held by the app (offer Open), when the CLI is missing, or when not signed in (show `claude auth login`). One message in flight per thread.

**Tray** — Show panel, Settings, Pause hotkeys, Check setup, Quit.

## 8. Hooks

Shipped in `hooks/hooks.json` with the plugin, so installing/uninstalling the plugin adds/removes them — the user's `settings.json` is never edited by hand. Events: `SessionStart` (idle), `UserPromptSubmit` (working), `PreToolUse`/`PostToolUse` (heartbeat), `Notification` (waiting if permission, else idle), `Stop` (idle), `SessionEnd` (remove).

Command: `curl.exe -s -m 1 --data-binary '@-' http://127.0.0.1:47615/hook/<Event>; exit 0`, written directly in `hooks.json` (no wrapper script). `curl.exe` ships with Windows 10 1803+, so no Node or Python is required, and a closed or absent Threadlight costs the session nothing (1 s cap, always exits 0). The server always answers `204` with an empty body, because some hook output is added to Claude's context. Missed events while the app is closed are covered by the transcript fallback.

Verified 2026-10-25: a plugin installed with `claude plugin install … --scope user` has its hooks run in Claude **desktop app** sessions started afterwards (events arrived and the session showed as hook-tracked). The command was also run by hand through Git Bash, Windows PowerShell 5.1 and PowerShell 7: all three deliver the event, and all exit 0 when Threadlight is closed. Claude Code runs hooks in Git Bash when installed, else PowerShell; hence `curl.exe` (in Windows PowerShell plain `curl` is an alias of `Invoke-WebRequest`), the quoted `'@-'`, and `; exit 0` rather than `|| exit 0`.

## 9. Setup skill ("I found this, set it up")

`skills/setup/SKILL.md` instructs Claude to:

1. Confirm Windows 10 1803+/11 and that the Claude desktop app is installed. Stop with a clear message otherwise.
2. Show what will change: hooks, autostart entry, ~150 MB speech model download, install location. Ask to proceed.
3. Ask (with defaults): talk key (`Ctrl+Alt+Q`), open-composer key, voice countdown, dot corner. `install.mjs --check-keys` tries to register each key and reports any already taken (Electron's `globalShortcut.register` returns false), so the user picks again before anything is saved. The app does the same check at every start and shows a tray warning instead of failing silently.
4. Run `node scripts/install.mjs --hotkey … --countdown … --corner …` (or the packaged installer when present).
5. Check sign-in with `claude auth status`; if signed out, run `claude auth login` and tell the user to finish in their browser. Never ask for or type credentials.
6. Start the app and verify: dot visible, at least one session listed, a hook event received (send a test prompt in the current session).
7. Report what was installed and how to uninstall (`install.mjs --uninstall`).

`install.mjs` is idempotent, prints every action, supports `--check` (diagnose only) and `--uninstall`, and never deletes anything it did not create.

## 10. Settings

Stored as JSON in `%APPDATA%/Threadlight/settings.json` (with a `version`), validated with zod; a bad field falls back to its default on its own. Every setting has a control (users are never told to edit files). There is no separate window: the panel's own card switches to a compact settings list (header gear or tray → Settings; ‹ returns, and a draft in the composer survives). Built in v1 (2026-10-25): talk hotkey (captured from a key press, clash-checked, old one kept on failure), voice countdown 1–10 s, open on hover or click, list window, max sessions, launch at sign-in, reset dot position, speech model status. Deliberately not settings in v1: the hook port (the plugin's `hooks.json` is static, so a changed port would silently break hooks), a second Whisper model (needs its own download/consent flow), microphone choice (the system default is used).

## 11. Design

Tokens (from the Pascal-style dark theme the prototype used), defined once in `theme.css`:
`--bg #171717  --raised #1e1e1e  --hover #212121  --border rgba(255,255,255,.10)  --fg #fafafa  --muted #a1a1a1  --faint #6b6b6b  --green #2ecc71  --red #e74c3c  --amber #f0ad4e  --accent #7fb2ff  --purple #a371f7  --radius 10px`.
Composer mirrors Claude's: `#2f2f2f` pill, `#454545` edge, blue mic disc. Font stack: `"Segoe UI Variable", "Segoe UI", system-ui`. Animations respect `prefers-reduced-motion`. Tight spacing: 10 px gutters, 6 px row padding.

## 12. Public-repo hygiene checklist

- [ ] `LICENSE` — MIT, `Copyright (c) 2026 Julius Deane`.
- [ ] `NOTICE` — third-party licences: Electron (MIT), React (MIT), transformers.js (Apache-2.0), Whisper weights (MIT, OpenAI); model weights are downloaded, not committed.
- [ ] README top: one-line pitch, GIF, **"Unofficial. Not affiliated with Anthropic."**, Windows-only, what it reads (§6), compatibility (tested Claude app version), install (via Claude / manual), uninstall, FAQ, licence.
- [ ] `PRIVACY.md` — what is read, that nothing leaves the machine, where settings/model live, how to remove all data.
- [ ] `SECURITY.md` — how to report privately (GitHub private advisories), scope (relay permission modes, hook server).
- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 with a contact method.
- [ ] `CONTRIBUTING.md` — setup, scripts, code style, "no real data in fixtures", commit style (Conventional Commits).
- [ ] Commits use the GitHub **noreply** email, not a personal address. Set `git config user.email` per repo before the first commit.
- [ ] `.gitignore` covers `node_modules`, `out`, `dist`, `.env*`, `*.log`, `settings.json`, `models/`, local screenshots.
- [ ] Screenshots/GIF recorded with a **demo profile** (`THREADLIGHT_DEMO=1` loads fixture sessions) — never real thread titles.
- [ ] Pre-publish scan: search the whole tree and history for personal names, drive letters, emails, tokens (`gitleaks` in CI).
- [ ] No trademarked logo; own icon. Name does not start with or contain "Claude".
- [ ] Unsigned binaries in v1: README explains the SmartScreen warning; code signing later.
- [ ] Versioning: SemVer, `CHANGELOG.md` (Keep a Changelog), tags `vX.Y.Z`.

## 13. Delivery plan

1. Scaffold repo + tooling + CI green on an empty app (dot window only).
2. Sessions core (`paths`, `transcript`, `appRecords`, `tracker`) with synthetic-fixture tests — port of the prototype's logic.
3. Dot + panel + detail + context menu UI.
4. Hook server + `hooks.json` + `hook.cmd`; verify desktop-app plugin hook loading.
5. Relay + composer + ticks.
6. STT worker + mic + push-to-talk + voice-command matching + countdown.
7. Settings window + tray + autostart.
8. Setup skill + `install.mjs`; full dry-run of "set this up" on a clean Windows user profile.
9. Docs, demo profile, screenshots/GIF, hygiene scan, v0.1.0 release.
10. Retire the Python prototype and move its hooks over to the plugin's.

## 14. Decisions and open questions

Decided (2026-10-25): name **Threadlight**; author **Julius Deane**; talk hotkey **toggle `Ctrl+Alt+Q`** (`Ctrl+Alt+Space` is taken by the Claude app's quick entry); repo **local only** for now.

Open:

1. **GitHub account** and its noreply email. Until then commits use author `Julius Deane` with a placeholder email; before the first push, the history is rewritten once to the account's noreply address (safe because nothing has been published).
2. Check that "Threadlight" is free on GitHub and npm before publishing.
