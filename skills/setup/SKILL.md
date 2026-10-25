---
name: setup
description: Set up Threadlight on this Windows PC from its source folder - check the PC, show what will change, ask for the talk hotkey and a few preferences, run scripts/install.mjs, check sign-in, start the app and confirm it works. Also checks an existing install (--check) and uninstalls it. Use when someone says "set this up", "install Threadlight", "is Threadlight working?", "check my Threadlight setup" or "uninstall Threadlight".
---

# Set up Threadlight

Threadlight is an unofficial companion for the Claude desktop app on Windows: a status dot
that opens into a panel of Claude Code sessions, with background sends and voice. This skill
installs it from a source checkout with `scripts/install.mjs`, which does the actual work.
Your job is to explain, ask, run the script and report back plainly.

## Ground rules

- **Ask before changing anything.** Step 2 lists every change; nothing runs until the person
  says yes.
- **Never ask for, type or read credentials.** Signing in to Claude Code happens in their
  browser.
- **Run only `scripts/install.mjs`, `claude auth status` and `claude auth login`.** Do not edit
  Claude's settings files, the registry or `%APPDATA%\Threadlight` by hand; the script records
  what it adds so `--uninstall` can take back exactly that.
- **Report the script's output faithfully.** If a line starts with ✗, say what failed and what
  to do; do not carry on as if it passed.

## 0. Find the checkout

The folder that holds `scripts/install.mjs` and `package.json` with `"name": "threadlight"`.
Usually it is the current working directory. If it is not there, ask where they cloned or
unzipped Threadlight. Run every command below from that folder.

If they only want to know whether it works, skip to **Checking an install**. To remove it, see
**Uninstalling**.

## 1. Check the PC

Run `node scripts/install.mjs --check`. Its first block confirms Windows 10 1803+ or 11,
Node 20+, `curl.exe`, the Claude desktop app and the Claude Code CLI. If any of those shows ✗,
stop and explain the fix (for example: install Node 20 or later from nodejs.org; install the
Claude desktop app). The rest of the output says what is already set up, which helps with
step 2.

## 2. Show what will change and ask to go ahead

Tell them, briefly, that the script will:

- install the app's packages and build it inside this folder (`npm ci`, `npm run build`), if
  not done already;
- install the **Threadlight plugin** for Claude Code (`claude plugin install`, user scope). Its
  hooks tell Threadlight which sessions are working. They post to Threadlight on this PC
  only (127.0.0.1) and cost a session nothing when Threadlight is closed;
- save their choices in `%APPDATA%\Threadlight\settings.json`;
- optionally add a **start at sign-in** entry for Threadlight;
- start Threadlight (a small dot in a corner of the screen, plus a tray icon).

Also say: nothing leaves the PC; the voice feature needs a 76 MB speech model, which is only
downloaded later, the first time they use voice and agree to it; and everything can be undone
with `node scripts/install.mjs --uninstall`.

Ask whether to go ahead. Stop if they say no.

## 3. Ask for their preferences

Ask these together in one short message, each with its default, and accept "defaults":

1. **Talk hotkey**: default `Ctrl+Alt+Q`. Needs Ctrl, Alt or Win plus a key. (Not
   `Ctrl+Alt+Space`: the Claude app's quick entry uses it.)
2. **Talk mode**: Toggle (press to talk, press again to send; default) or Push to talk (hold
   to talk, let go to send).
3. **Send countdown**: seconds before a spoken message sends, so a misheard one can be
   cancelled; 1 to 10, default 5. (Hold, which waits for Send instead, can be switched on later in
   Settings.)
4. **Dot corner**: top right (default), top left, bottom right or bottom left.
5. **Start at sign-in**: yes or no (default yes).

Write the hotkey the way Electron spells it: `Control`, `Alt`, `Shift`, `Super` (the Win key),
then the key, joined with `+`, e.g. `Control+Alt+Q`, `Control+Shift+F9`, `Alt+Super+T`.

Check that the hotkey is free before anything is saved:

```
node scripts/install.mjs --check-keys Control+Alt+Q
```

✓ means free (or already Threadlight's own). ✗ "already used by another program" means
another app has it: ask for a different one and check again.

## 4. Install

Run, with their answers:

```
node scripts/install.mjs --hotkey Control+Alt+Q --talk-mode toggle --countdown 5 --corner top-right --autostart
```

Use `--no-autostart` if they said no to starting at sign-in, and `--talk-mode hold` for push
to talk. The script prints each step. It may take a few minutes the first time, while it
installs packages. Running it again is safe: it only changes what is not right yet.

If it ends with ✗, report the reason it gives. Common ones: a hotkey taken since it was checked
(ask again), `npm ci` failing (usually no internet, or an old Node), or a "threadlight" plugin
source that points at a different folder (the message gives the command to remove it; ask
before running it).

## 5. Check sign-in

Sending messages from Threadlight runs the Claude Code CLI, so it must be signed in. Run
`claude auth status`. If `loggedIn` is not true, run `claude auth login` and tell them to
finish signing in in the browser window it opens, then run `claude auth status` again.

## 6. Confirm it works

1. Ask them to look for the **dot** in the corner they chose. It only shows while the Claude
   desktop app is open. Hovering over it (or clicking, if they chose click) opens the panel
   with their recent sessions.
2. The plugin's hooks only reach Claude Code sessions **started after** it was installed. Ask
   them to start a new session in the Claude app (or send a prompt in one started after the
   install), then run `node scripts/install.mjs --check`. The last lines should say Threadlight
   is running and that hook events have arrived.
3. If no events arrive: make sure the session was started after the install, then check again.

## 7. Report

Say in a few lines what was installed, where their settings are, the talk hotkey and how to
use it ("press Ctrl+Alt+Q, say 'message docs site, check the build passed', press again"), and
how to undo it all: `node scripts/install.mjs --uninstall`.

## Checking an install

Run `node scripts/install.mjs --check` and explain any ✗ or ! lines with their fix. It changes
nothing.

## Uninstalling

Confirm first, then run `node scripts/install.mjs --uninstall`. It stops Threadlight, removes
the start-at-sign-in entry, and removes the plugin and its source only if this script added
them. Settings and the speech model stay unless they also want those gone: then add
`--remove-data`, which deletes `%APPDATA%\Threadlight`. The checkout folder itself is left;
they can delete it afterwards.
