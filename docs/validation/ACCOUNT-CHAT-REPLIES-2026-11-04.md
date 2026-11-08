# Ordinary chat replies and automatic updates — 4 November 2026

Implemented in the primary checkout. The regular app was not restarted here.
These changes do not add Kimi execution, Computer tasks, or Triple/Quad layouts.

## Live acceptance

The user explicitly authorized one message, “Threadlight integration test. Reply
with exactly: OK.”, to ChatGPT's **Test Thread** and Perplexity's **Just testing**.
The production service and adapters used the existing desktop sign-ins. No new
chat, API key, top-up or Computer task was used.

- ChatGPT acknowledged the selected chat identity. Reads reported active during
  generation, then idle. A subsequent production read found exactly one test
  prompt and the assistant's “OK.” response. The current desktop's reader exposed
  the completed message after generation, not incremental tokens.
- Perplexity's first envelope lacked its required streamId. An empty-envelope
  validation request confirmed JSON-RPC -32602 rejection before dispatch. After
  correcting the envelope, the single authorized message reached the same existing
  chat and returned “OK.”. A production read found exactly one test prompt.
- Perplexity's successful stream head has status 200 but no entryId. The first
  acknowledgement check therefore conservatively reported uncertainty. The final
  implementation checks a new saved entry, exact submitted text and matching
  conversation context. That check was verified against the actual saved reply
  and previous entry, and the observed head shape is covered by the adapter test.
  No additional generation was used to retest the acknowledgement correction.
- Both final reads reported idle and available reply capability. Perplexity Active
  mapping uses the installed app's pending/completed thread-status contract;
  its transient pending state was not captured in this short live reply test.

Provider versions: Codex desktop 26.1027.3384.0; Perplexity package
2026.10.37378.0 / native server 26.10.3. These private interfaces remain version
dependent. Provider tokens and full conversation bodies are absent from this record.

## Implementation and checks

Discovery polls every five seconds while the panel is visible; open conversations
poll every two seconds. List polling retains reader ownership and history cursors.
Updates preserve older messages, reading position and drafts. The shared composer
retains typed drafts locally through navigation/restart and clears them only after
acknowledgement. Confirmed sent text appears while provider history catches up.

Main-process delivery records bind source, chat, operation ID and prompt digest.
Pending intent is persisted before dispatch. Unknown delivery survives restart and
blocks further sends until the user checks the native chat. No automatic resend
occurs. Explicit invalid-method/parameter rejection is distinguished from ambiguity.

Focused service, adapter and IPC tests cover selected-chat scoping, response
identity, activity, history cursors, native send arguments, the missing-entryId head,
duplicate operation replay, changed-prompt rejection and interrupted delivery.
Isolated UI checks cover both providers in Active, updating open messages,
retained history/drafts, shared composers, successful delivery, failure recovery
and no automatic resend. These UI checks use synthetic IPC.

Final local validation: 21 focused service/adapter/IPC tests passed; the reply UI
proof and existing account-chat UI regression passed; focused ESLint, renderer
TypeScript, formatting, production build and diff checks passed. Full main-project
TypeScript still reports the pre-existing audio DOM types and audio/Kimi test
project-inclusion errors recorded in the initial reader validation. No account-chat
type errors were reported.

## Remaining limitations

Automatic snapshot refresh is not token streaming. The desktop can report working
before updated message text is readable. Ordinary-chat replies wait for the current
response to finish; steering/cancellation, attachments, approvals, rich widgets and
shared-memory enrollment are not implemented. Native apps retain those controls.
Account chats still lack verified filesystem workspace associations. This evidence
does not establish complete parity with the mature Codex integration.
