# Shared provider messaging — 4 November 2026

Implemented in the primary checkout; the regular application was not restarted.
This work extends the existing communication service, rather than creating a
second group, permission system or message store.

## Current behavior

- The destination contract accepts existing Claude/Codex IDs and separate
  `chatgpt:<uuid>` / `perplexity:<uuid>` identities. Identical native UUIDs from
  different providers are not interchangeable.
- Human-configured workflow membership and DM permission allow an enrolled sender
  to address an ordinary chat through the existing message tools. The journal
  retains operation identity, per-target delivery state, sender and reply linkage.
- The account transport uses the same connection and durable send receipts as the
  ordinary-chat composer. A per-chat lease prevents competing composer writes
  while a reply is collected. Native-app interference is detected through history.
- Completion requires a new exact prompt anchor, subsequent non-truncated text,
  no intervening user turn and explicitly idle provider status. Old replies,
  acceptance alone and unknown provider state are insufficient. Uncertainty does
  not trigger resend. A provider result is recorded in the original sender inbox.
- Account chats retain their native model, have no filesystem association and
  receive no shared-memory credentials. They cannot be assigned tool-dependent
  coordination, result acceptance or saved-output work. Ordinary messages remain
  available for bounded thinking/research requests.
- Workflow selectors retain saved identities after their discovery list unmounts.
- Native rate-limit errors now retain the connection, display a clear local error,
  and enforce a one-minute cooldown. They previously surfaced as format errors.

## Live evidence

The user named ChatGPT's **Test Thread** and authorized a Perplexity conversation;
the existing **Just testing** conversation was selected. No new chat was created.

**Perplexity:** one message passed through production `AccountChats`,
`AccountChatTransport`, `CommunicationService` and a disposable `MemoryStore`.
The provider returned the test marker; the journal reached `completed` and stored
one correlated result addressed to the original sender. This was an isolated
proof Shared Space, not enrollment into or access to the user's existing spaces.

**ChatGPT:** production discovery attempts encountered native `Too many requests`
before dispatch; no adapter test prompt was sent. The available Codex app messaging
tool then sent one authorized prompt to Test Thread. An initial read still showed
the older conversation; a later read showed the exact new prompt and expected
marker in a completed turn. This proves the native send/read path, not completion
through the new Threadlight account transport. That production live gate remains
open until discovery can run without the rate limit. The message was not resent.

The installed plugin's legacy enrollment request was rejected for missing the
new project destination. No memory content was accessed, no enrollment was approved,
and no credentials or raw IPC were used to bypass that check. Repository inspection
and isolated test stores are independent of shared-space access.

## Local checks

- 80 tests passed across the focused account service/adapter/IPC, new account
  communication, communication service/real caller and workflow integration suites.
- An earlier focused run including packaged-plugin tests passed 84 tests.
- `communication-roles` browser proof passed against the actual renderer with
  synthetic IPC: discovery, ordinary-chat role selection, current native model,
  disabled unsupported work authority and selection retention after saving.
- Focused lint, main/renderer/browser TypeScript checks, generated plugin
  consistency, production build and diff checks passed during implementation.
- The older full `communication` browser scenario reaches a stale composer selector
  after switching to Handoffs: that view now uses compact communication and has no
  DM composer. The new targeted role scenario explicitly tests the changed UI;
  the older full scenario is not reported as passing.

No PR was opened, nothing was pushed, and no live provider model was changed.

## Remaining scope

The API and journal are shared, but provider capability is not universal. Ordinary
ChatGPT/Perplexity chats cannot initiate arbitrary group messages through this
adapter because they are not tool-connected participants. The reply collector
does not wake an idle sender; an active sender reads its correlated inbox result.
Kimi, ordinary Claude chat, remote hosts, native attachment/approval parity and
guaranteed usage savings are not added by this change. Future adapters must prove
their identity, delivery and reply behavior instead of borrowing another provider's
identity or permissions.

Documentation updated: README, CHANGELOG, account-chat guide, canonical/shared
plugin skill and generated protocol, UI proof guide and this validation record.
