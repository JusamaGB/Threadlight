# Threadlight for Codex

This plugin reports local Codex activity to Threadlight on `127.0.0.1:47616`.
It does not change Codex's databases or session files. The Claude plugin and its
endpoint on port 47615 are separate.

## Enable

Use a current Windows Codex desktop app and its signed-in native `codex.exe` CLI.
The initial compatibility check used CLI `0.164.0-alpha.11.1`. Threadlight needs
Node 22.13+ for development; its Electron runtime includes SQLite.

From the Threadlight checkout, register and install the local marketplace:

```powershell
codex plugin marketplace add .
codex plugin add threadlight-codex@threadlight-local
```

Review and trust the installed hooks in Codex's hook controls (`/hooks` in the
interactive CLI). Installing alone does not grant hook trust. Do not enable a
global trust bypass. New or resumed sessions load the plugin; already loaded
desktop chats may require reopening after their writer is released. See the
[Codex plugin commands](https://learn.chatgpt.com/docs/developer-commands) and
[hook trust documentation](https://learn.chatgpt.com/docs/hooks).

In Threadlight, enable **Settings → Applications → Codex**. The Claude and Codex
toggles are independent: both on shows a combined list with blue Codex and orange Claude edge tints;
both off pauses chat monitoring. Upgrading preserves the previous selection;
new installs default to Claude only. Drafts stay in memory with their chat;
quitting Threadlight clears them. Claude, Codex and the combined view each keep
their own workspace selection.

The existing `scripts/install.mjs` still installs the Claude plugin. These Codex
steps are separate and are not run automatically by the provider toggle.

## Behavior

- State comes from hooks, `state_5.sqlite`, optional `thread_history_1.sqlite`,
  bounded session JSONL tails and desktop activity metadata under `CODEX_HOME`
  (or `~/.codex`). Database connections are read-only and never migrate data.
- Background sending uses `codex exec resume <exact-id> -`, with the message on
  stdin and no shell. It keeps the saved model and loads the user's Codex settings
  and permissions. It never adds sandbox, approval or hook-trust bypass flags.
- Live writers are detected with a read-only Windows lock probe plus CLI process
  checks before sending. Live chats offer **Copy and open Codex**. A writer race
  is refused by Codex; Threadlight reports the error and never retries it silently.
  Sent means a turn started; replied requires a successful completed turn.
- Permission-request cards can allow once or deny. Stop hooks can hold a final
  paragraph ending in a question mark and continue with the user's answer.
  A card's nonce prevents a stale answer from resolving a different request.
- Holds release after 60 seconds, on exit, when Codex is toggled off, when their client
  disconnects, or when opened from Threadlight. Because there is no reliable
  persisted foreground-chat identifier, bringing the Codex/ChatGPT window forward
  conservatively releases all Codex holds. Release returns no decision, never allow.
- Native `request_user_input` cards have no documented answer-through-hook
  contract. They show the question/options and preserve a typed answer for
  **Copy and open Codex**. An expired Stop card uses the same fallback.
- Open uses `codex://threads/<id>`. Workspace following uses last recorded user
  activity, not a claim about the exact foreground tab. Remote/cloud chats are
  outside this local-file adapter. Claude's hosted Agent and usage meter remain
  Claude-only. Codex PR badges and background task inventory are not inferred.

Hook ports accept local tools, reject browser-origin requests, and are not exposed
on the network. If Threadlight is absent, hook commands exit cleanly after a short
timeout. Hooks carry tool inputs and messages locally; none are sent to a service
by Threadlight. Messages sent through Codex use the user's OpenAI account.

## Validation and removal

Use only disposable chats when testing sends or answers. A local-PC smoke check
confirmed that a CLI-resumed turn appeared in the desktop transcript. An attempt
while that chat was loaded failed with an active-writer conflict before a new turn
started. A real Stop hook accepted a synthetic answer and the model continued.
Approval allow/deny, timeout/disconnect and stale-card handling have synthetic
regression coverage; no production tool approval was exercised.

Run `npm run check` and `npm run build` for the local preflight. Tests use generated
databases and fake CLI output rather than personal Codex data. To remove the plugin:

```powershell
codex plugin remove threadlight-codex@threadlight-local
codex plugin marketplace remove threadlight-local
```

Removing the plugin leaves chats and Threadlight settings intact. Turning Codex
off releases its holds; turning Claude on alone does not release Codex cards.
