# Agent grouped turns — 7 November 2026

This record describes the earlier grouped view. The [continuous Agent reader](AGENT-CONTINUOUS-LIVE.md) supersedes it.
Each actual user request starts a turn containing its messages, activity, source
receipts and exactly anchored communication cards. Earlier turns default closed
with their actual last reply as a preview; the latest defaults open. Explicit
expansion choices survive feed updates and history navigation. A new pending card
revision reopens its owning turn. Missing or unloaded anchors remain in explicit
Conversation updates rather than being attributed to a guessed request.

Agent replies and returned card bodies render Markdown, safe web links, tables and
collapsible code. Code has a Copy action; selected conversation text uses the
shared Copy context menu and keyboard entry point. Raw HTML and remote images are
not loaded. The expanded Agent no longer repeats the unformatted last reply in the
voice caption; recording captions remain available. Existing request validation,
response correlation, historical read-only behavior and provider routing remain.

## Local checks

- 13 unit tests passed across `agentTurns` and `conversationEvents`, covering real
  request boundaries, explicit/missing anchors, partial history, legacy anchors,
  stable keys, orientation-envelope presentation and existing event behavior.
- All TypeScript projects and focused ESLint passed. Diff whitespace checks passed.
- Production build passed. The regular renderer loaded `index-DJ6j1Edt.js`.
- Isolated `agent-grouped` UI checks passed: default/manual folding, pending older
  turns, exact approval response, formatted links/code/tables, emoji, code and
  selection copying, keyboard access, draft retention, history safety, source
  routing and panel bounds. Optional project-draft adapters are explicitly absent
  from the main-Agent fixture to match the production API.
- Isolated `agent-decision`, `conversation-events` and `brainstorm-chat` regressions
  passed: compact provider approval summaries, independent native questions,
  disappearing requests, returned results, conversation isolation, separate project
  drafts, caret restoration and failed-send retention. Assertions now check the
  visible compact status and expand Details for the underlying status record.

These isolated checks use synthetic provider IPC. They send no live provider
messages and do not establish fresh live-provider approval or speech acceptance.

## Regular running app

Before restarting, the main Agent, Spaces Agent, microphone and relays were idle;
the isolated observer was stopped. Restart used the app's normal restart action,
retaining the primary checkout as the launch source. The launcher recorded a new
main process at 15:15:31 UTC; the loaded renderer was checked at 15:15:34 UTC.
Codex remained selected and the saved voice setting remained `local-stt`.

At 15:15:48 UTC, checks on actual saved Agent history in the regular app passed:
four request groups, latest open, earlier groups collapsed, mouse and Enter-key
toggle, and no horizontal overflow. Returned to the current Agent composer
afterward. No conversation was resumed or message sent. Live pending decisions,
speech, and live source navigation were not exercised in this presentation task.

Screenshots, the restart record, original files and hash manifest were retained outside the checkout.
All 837 pre-existing files were compared against that manifest: only the ten
intended existing source/test/documentation files changed; 827 others were
byte-identical. Five new implementation/test files and this evidence document
were added. No commit, reset or worktree operation was performed.
