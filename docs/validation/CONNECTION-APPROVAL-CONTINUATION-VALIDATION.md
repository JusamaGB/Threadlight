# Approval continuation verification — 29 October 2026

## Outcome and limitation

Implemented a bounded active-tool wait, not an idle-chat provider callback. No
supported local Codex stdio wakeup contract was established. The private desktop
composer channel and independent CLI resume were deliberately not used. Official
[MCP Events](https://developers.openai.com/plugins/build/mcp-events) documents
webhook-triggered continuation for cloud Work chats and dots, not this local
plugin. Claude runtime inbox delivery also requires prior enrollment and remains
subject to its production release gate; it cannot bootstrap pending approval.

## Receiving path proved

`test/memoryPlugins.test.ts` starts the actual Claude and Codex packaged stdio
bridges against an isolated authenticated MemoryServer. Two synthetic native chat
IDs share the bridge. A pending `memory_wait_for_approval` call receives a response
only for its exact connection after the test invokes the same approval service
used by the panel. Another chat remains pending. Approval is delayed beyond the
ordinary five-second bridge timeout. The returned signal is followed by real
`memory_connect` verification and a scoped `memory_briefing` call.

This demonstrates delivery of the correlated MCP tool result to an active caller.
It does not demonstrate a live model choosing to continue, or waking an idle chat.
No live user connection, provider process, foreground window or notification was
used as a fixture. No workflow or communication message is created.

Duplicate waits, repeated status/reopening, wrong native IDs/secrets, wrong grant
binding, direct revocation, rejection while waiting, approval immediately revoked,
expiry, replacement of an expired request and shutdown are covered. One signal is
claimed per ephemeral connection. Loss after claiming is recovered by status, not
signal replay. Actual access remains authenticated on every memory call.

## Checks

- Plugin packaging consistency and focused ESLint passed.
- Node and renderer typechecks passed.
- Memory plugin and security suites: 33 tests passed.
- Final focused stale/revocation/shutdown and generation replacement regression
  passed, followed by the node typecheck and final production build.
- No regular app or ChatGPT restart was performed.
- Final diff/format checks are limited to the relevant files; unrelated work remains.

## Activation

The current live app and loaded plugins are unchanged. To use this fallback later,
load the rebuilt primary app and refresh the plugin package through its supported
manager, then reconnect the host tools and create a fresh request. A simple host
restart does not update an old cached plugin package. This implementation does not
fix bridge server-key pinning across app restarts. Do not restart the live test just
to activate it. The cleaned request screen remains unchanged.

See [implementation specification](../specs/CONNECTION-APPROVAL-CONTINUATION-SPEC.md).
