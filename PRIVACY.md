# Privacy

Threadlight runs entirely on your PC.

- **No telemetry, no analytics, no accounts, no servers.**
- **It reads**, without changing them: your Claude Code session transcripts
  (`%USERPROFILE%\.claude\projects\`) and the Claude app's thread records
  (`%APPDATA%\Claude\claude-code-sessions\`), to show titles, status and progress.
- **It receives** session-state events from Claude Code hooks on `127.0.0.1` only.
- **Codex support** reads local session JSONL, SQLite thread/history databases and
  desktop activity metadata under `CODEX_HOME` (or `~/.codex`), read-only. Its separate
  hook endpoint receives activity and held requests on `127.0.0.1:47616`. Background
  messages run the user's signed-in `codex exec resume`, covered by their agreement
  with OpenAI. Threadlight does not copy authentication files or alter Codex databases.
  Composer and answer drafts remain in memory until Threadlight exits.
- **It sends** your messages to your own sessions by running your own `claude` CLI.
  That is the same as typing the message into Claude yourself, and is covered by
  your agreement with Anthropic.
- **Voice** is recorded only while you have the microphone on, is transcribed locally
  and is never saved to disk.
- **Network:** the only download is the speech model, once, at setup, after you agree.

## Where its own data lives

- Settings: `%APPDATA%\Threadlight\settings.json`
- Speech model: `%APPDATA%\Threadlight\models\`

Uninstalling removes both, along with the hooks and the sign-in launch entry that
setup added.
