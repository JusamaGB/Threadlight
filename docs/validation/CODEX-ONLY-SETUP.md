# Codex-only Windows setup

On 8 November 2026 a disposable Windows 10 x64 account installed this source candidate from an extracted directory containing spaces. The account had Node 22.23.4, Git, curl.exe and a native Codex CLI. It started with no Threadlight settings, dependencies, build output, Claude Desktop or Claude CLI.

- `node scripts/install.mjs --providers codex` installed dependencies, verified the pinned Electron archive, built and launched the app. Settings selected only Codex and set the Agent provider to Codex.
- The Codex CLI reported `threadlight-codex@threadlight-local` version 0.2.1 installed and enabled. The app status responded with its package version and the Codex hook status endpoint returned HTTP 200.
- `node scripts/install.mjs --check --providers codex` completed successfully and reported the unsigned account separately. No Claude profile was created. Native sign-in, hook trust and receiving events from a real signed-in chat require the user's own account.
- `node scripts/install.mjs --uninstall` removed the installer-added marketplace and kept the user's settings. This check ran in the disposable account.

A second disposable Windows account tested the combined 0.1.0-alpha.1 candidate with the proposed dependency updates, including Electron 45.2.1. It registered and enabled plugin 0.3.1 with only Codex selected. The running app returned its package version, its Codex hook endpoint returned HTTP 200, the setup check succeeded and uninstall retained settings. This account was unsigned and had no Claude installation.
