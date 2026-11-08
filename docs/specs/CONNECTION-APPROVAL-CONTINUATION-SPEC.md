# Connection approval continuation

29 October 2026. Scope: ordinary human-approved plugin enrollment.

## Existing paths and decision

- `memory_connect` creates an ephemeral request with a bridge-owned secret and
  optional native chat UUID. Panel-only `MemoryConnections.approve` creates the
  grant. `/plugin/mcp/:id` authenticates that connection on every call.
- Communication delivery requires separate workflow authorization and may use
  admitted CLI resume. Neither is appropriate for ordinary connection setup.
- The human composer uses `NativeCodexMessages` and the private desktop coordination
  pipe. This task excludes raw/private IPC and competing resume processes, so that
  route is not used for approval callbacks.
- Official [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
  supports webhooks for cloud Work chats and dots, not this local stdio plugin.
  [CLI queue](https://learn.chatgpt.com/docs/cli/reference) documentation does not
  establish attachment to the current desktop owner. Historical independent
  attachment evidence is in `docs/Codex/CODEX-STAGE0-RESULTS.md`.

## Implemented supported fallback

Add `memory_wait_for_approval(connectionId, chatId, waitMs)` to both packaged
bridges. After showing the code, a chat can keep a bounded tool call outstanding
(up to 50 seconds per call, only until the five-minute request expires). Human
approval completes that exact call through the existing authenticated HTTP and
stdio response path. This resumes an active tool caller; it does not wake an idle,
closed or disconnected chat. No MCP notification is advertised as a wakeup.

Require the supplied native UUID to equal the UUID stored on the request, and the
approved grant's assignee to equal that provider-qualified UUID. The human still
approves explicitly. Authenticate the grant immediately before returning a signal.
The caller checks its same connection, then loads its briefing; this permits only
continuation of connection setup, not unrelated work.

One active wait per connection; one approval signal per connection generation.
Retries after a claimed signal report already delivered without another signal.
A lost response can be recovered through ordinary status/briefing. Denial,
revocation, expiry, mismatched binding and shutdown produce no approval signal.
No durable callback survives restart because enrollment itself is ephemeral and
old grants are revoked on startup. Older identity-free requests retain manual
status checking. No workflow configuration or request-screen controls change.

## Verification boundary

Use real packaged stdio bridges against isolated authenticated MemoryServers,
including two simultaneous synthetic identities and lifecycle failures. This
proves tool-result delivery, not an idle provider turn or live user acceptance.
A supported host callback contract and isolated native wakeup proof remain required
before claiming automatic idle-chat approval notifications.
