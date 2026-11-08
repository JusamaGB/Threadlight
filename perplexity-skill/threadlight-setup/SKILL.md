---
name: threadlight-setup
description: Set up, verify, repair or remove the Threadlight Windows app from source. Use for Threadlight installation requests from a repository link or for connecting Claude Code, Codex or Perplexity to an existing installation.
---

# Set up Threadlight on Windows

Locate the user's durable source checkout containing `scripts/install.mjs` and `package.json`. For a first installation, clone the supplied Threadlight repository into a suitable folder on their PC. The project repository is https://github.com/JusamaGB/Threadlight. Run setup from the checkout. A plugin cache can be replaced during updates.

Check where commands will run. Setup needs the user's Windows x64 PC, Git and Node.js 22.16 or newer. If the chat has only a hosted shell or read access to GitHub, give the user the Windows commands and use their reported results. Sign-in, hook trust and approval of project access belong to the user.

Determine which integrations they want. Use `claude` for local Claude Code, `codex` for Codex or ChatGPT through a compatible Codex desktop installation, and `perplexity` for Perplexity desktop conversations. Combine choices with commas.

1. From the source folder run `node scripts/install.mjs --check --providers codex`, substituting the user's list. Explain missing prerequisites. Missing packages, build output and plugins are expected on first install. Install and sign in to the selected provider apps as needed.
2. Explain that setup installs dependencies, builds and launches the Windows app, and registers plugins for selected coding providers. Perplexity uses the signed-in Windows application. With the user's installation request, run `node scripts/install.mjs --providers codex` using their choices. Honor requested hotkey, corner, countdown and sign-in startup preferences. If setup reports an existing running app must close, let the user finish current work.
3. Run the same provider-specific check again. Open the panel from the tray or dot. For existing installations confirm the choices under **Settings → Providers shown** and **Chat providers shown**.
   - **Claude Code.** Check `claude auth status`, start a new Claude Code session and confirm a hook event appears. The plugin is `threadlight@threadlight`.
   - **Codex.** Check `codex login status`. Review Threadlight's hooks in `/hooks`, open a new Codex chat and check that it appears in Threadlight. The plugin is `threadlight-codex@threadlight-local`. Ordinary ChatGPT discovery also needs a compatible signed-in desktop installation and an existing local Codex chat.
   - **Perplexity.** Open the signed-in Perplexity Windows app in the same Windows session. Enable Perplexity under Chat providers shown and look for a known chat in Recent with the Chat or All filter. Check `docs/PERPLEXITY.md` in the installed revision for validated versions. Computer task authorization is separate and optional. Ordinary Perplexity chats receive supported briefs and return replies through Threadlight. Shared-memory enrollment is available to Claude Code and Codex.
4. For shared memory, ask the intended Claude or Codex chat to request a connection. The user matches its code and approves the intended space in Threadlight. Report app startup, provider discovery, hook trust and pairing individually from what you observed. Repair a missing step and retry from the same checkout.

For removal, confirm the scope and run `node scripts/install.mjs --uninstall` from the checkout. Settings and project data are kept by default. Use the data-removal option only when the user specifically asks to erase their saved Threadlight data.
