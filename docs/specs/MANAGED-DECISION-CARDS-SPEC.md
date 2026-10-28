# Threadlight-managed decision cards

Date: 28 October 2026. Scope selected by the user: future questions created by
Threadlight tools. Existing Codex-native questions retain their clipboard/open
fallback; the [desktop connection investigation](../Codex/CODEX-DESKTOP-AUTH-20261028.md)
does not establish a native response route.

## User flow

An approved, linked Claude or Codex chat asks a human question through the
Threadlight plugin. Its row immediately shows **Needs your input**. Expanding it
shows the question, suggested choices, an optional typed response, **Send answer**
and **Dismiss**, using the existing compact card styling. No choice is submitted
by default. The existing header close button only collapses the card.

Sending saves the answer against the exact request ID and generation. The asking
agent collects it through its existing MCP connection and continues its current
work. No clipboard, foreground switch, background resume or second agent is used.
Multiple pending questions on a thread appear in creation order, one at a time.
Answering or dismissing one reveals the next; provider-native attention is retained
underneath and becomes visible again when managed questions are gone.

## Protocol and access

- `threadlight_ask_question`: existing project-question tool, now supports
  `answerDelivery: "tool"` and `allowOther: true`. Use `audience: "human"`, the
  enrolled space ID, question `body`, optional `choices` and a stable `operationId`.
- `threadlight_read_question`: exact `id` and `generation`, optional `waitMs` up to
  25 seconds. Returns the durable question with `pending`, `answered` or `expired`.
  Only its asker or the local human can collect it. Repeat a bounded read when still
  pending; there is no automatic wakeup after the agent ends its turn.
- `threadlight_cancel_question`: asker or human withdraws the exact pending card.
  Cancellation returns `expired` with its reason, never an implied answer.

The human must approve the plugin connection, link it to the intended chat and
grant project-wide writable access with workflow communication permission. The
model cannot nominate an arbitrary sender through tool arguments. Every read
rechecks authorization, and a waiting HTTP read also checks connection revocation.
Only the human IPC route can answer a tool-delivered card. These questions never
authorize native permission requests.

The packaged bridges allow 35 seconds for the bounded question-read request;
ordinary requests retain their five-second timeout. Questions and answers use
the existing communication database. No provider files or databases are written.
The legacy `answerDelivery: "message"` route remains unchanged.

## Lifecycle and failure behavior

Pending tool questions expire after one hour or an app restart. Answered records
survive restarts. Generation mismatch, already-resolved cards and revoked access
fail without sending anything. A duplicate ask with the same operation and input
returns the current record, including an answer that arrived after the first call.
Answer retries retain the operation ID and exact payload. A lost response leaves
an error and retry action; it does not silently dismiss the card or send twice.

Pending metadata is projected onto cached provider snapshots before provider lists
are combined. Communication events publish the changed snapshot immediately;
opening a view does not scan provider storage or fetch each card independently.

## Validation

- Focused service tests: typed answer, exact source/generation, duplicate operation,
  cancellation, expiry, restart recovery and revocation while waiting.
- HTTP MCP integration: actual authenticated request/answer/read round trip,
  connection revocation, and zero provider deliveries.
- Packaged Claude and Codex stdio bridges: approved synthetic enrollment, linked
  target, real HTTP wait beyond five seconds, human answer returned to the original
  caller, and no queued message. No account/model calls in these tests.
- Isolated renderer: live service-backed card on the correct row, typed submission,
  failed-response retry with identical operation, dismissal, and native fallback.
- Snapshot projection: recent, retained lookup and nested workspace rows; expired,
  answered and unrelated requests do not overwrite provider data.

The runtime must load the rebuilt app and refreshed plugin assets before real
chats can use these tools. Source/build verification is not proof that an already
running app or cached MCP process has reloaded them.

Local result: 64 focused tests passed across the service, HTTP integration,
snapshot projection, conversation and packaged-bridge suites. The isolated card
UI check, TypeScript checks, focused lint, formatting, plugin parity and build
also passed. The three plugin assets (bridge, protocol and skill) were backed up
and updated in both installed plugin caches. On 28 October 2026, Codex was fully
reopened and this chat's live tool inventory exposed the updated ask, read and
cancel question tools. Threadlight was relaunched at 12:35 London time after it
was found stopped following the Codex restart. Claude's connection refresh is
still pending. No real provider conversation was used as a card round-trip test.
