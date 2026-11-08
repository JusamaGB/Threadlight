---
name: setup
description: Install, check, repair or remove the Threadlight Windows app and its selected Claude Code or Codex integration from a source checkout.
---

# Set up Threadlight from source

Use a durable checkout of https://github.com/JusamaGB/Threadlight on the user's Windows x64 computer. If you can only read GitHub or run commands on a hosted computer, give the user the Windows commands.

1. Check that Node.js 22.16 or later, Windows curl.exe, and the selected provider are installed. Codex users need a compatible native codex.exe from Codex Desktop or on PATH. Let the user handle sign-in. Claude Code users need Claude Desktop and the Claude CLI. Git is needed to clone the repository; a downloaded source ZIP also works.
2. From the source folder, run `node scripts/install.mjs --check --providers codex` for Codex alone. Use `claude` or `claude,codex` for those installations. Missing app packages, build output and plugin registration are expected on first install.
3. Honor requested preferences. Check a hotkey with `node scripts/install.mjs --check-keys Control+Alt+Q`. The installer accepts `--talk-mode hold|toggle`, `--countdown`, `--corner`, and `--autostart` or `--no-autostart`. When no preference is specified, retain the defaults.
4. Run `node scripts/install.mjs --providers codex` with the same selection. It installs the checkout's dependencies, builds and launches Threadlight, registers the selected plugin and saves the provider choice. If asked to quit an existing Threadlight instance, let the user finish their current work.
5. Run the provider-specific check again. For Codex, review the plugin hooks in `/hooks`, open a new local Codex chat and verify it appears in Threadlight. For Claude, check `claude auth status` and a new Claude Code session. Report observed startup, plugin registration and hook activity separately.
6. To uninstall, use `node scripts/install.mjs --uninstall`. Saved settings and project data are retained by default.

If a check fails, explain the failing item using the installer output. Reuse the same checkout for repairs. Plugin installation, sign-in and hook trust are separate checks. Use `--remove-data` only when the user explicitly asks to erase their Threadlight data.
