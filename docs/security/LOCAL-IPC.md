# Local IPC security

Threadlight is a local desktop application. Its security boundary includes the
Windows account, the installed provider applications, and the installed plugin
code. It is not a sandbox against arbitrary code running as that same account,
an administrator, a debugger attached to a trusted process, or modified application
files. Do not describe the complete Codex coordination bus as authenticated.

## Threadlight protections

### Codex desktop connection

Before sending initialization or conversation data, Threadlight opens the pipe
with explicit anonymous Windows impersonation quality of service and verifies the
server process using that exact pipe handle. It requires the same Windows user
and logon, the OS-reported `OpenAI.Codex_2p2nqsd0c76g0` package, its expected
`app/ChatGPT.exe` executable, and a valid OpenAI OpCo, LLC Authenticode signature.
It retains the original pipe handle for all communication. It never checks one
connection and then reconnects for actual traffic.

The implementation currently supports native Windows x64 and the packaged Codex
desktop distribution. Unsupported distributions, unavailable identity information,
invalid signatures and mismatched logons fail closed. There is no environment
variable to skip verification. A successful signature is cached only for the
OS-identified package executable path for the life of the Threadlight process;
provider version changes produce a different path. Windows package integrity and
protection of installed application files remain part of the trust model.

Protocol responses must match the pending request's method and, for targeted
requests, the expected owner. Initialization must consistently identify the
assigned client. Frame sizes, outgoing buffers and pending requests are bounded.
These checks improve error handling and correlation; matching strings do not
authenticate another client on a router which accepts forged identities.

The native transport uses overlapped reads/writes and cancels outstanding I/O
before releasing its buffers and handles. The Claude native inbox also explicitly
disallows impersonating Threadlight's Windows token. Before inspecting or writing,
it also requires the pipe owner's Windows SID and authentication/logon ID to match
Threadlight's. Its existing PID/start-time, session-record and executable-hash checks
and its real-Desktop release gate remain in place. Claude relay prompts travel on
stdin, outside process command lines; provider output is bounded.

### Hooks

Both providers' hook POST routes now require authenticated encryption
(AES-256-GCM). The authenticated data binds requests to the HTTP method and route.
Requests include an expiry-checked timestamp and a nonce tracked in a bounded
replay cache. Replies are separately encrypted and bound to the request nonce.
An untrusted listener receives ciphertext rather than tool inputs and cannot
manufacture an approval or question answer without the key. Missing keys, wrong
keys, stale requests, malformed envelopes, replay and failed reply validation
produce no provider decision. Browser-origin and Host-header restrictions remain.

Each successful listener startup generates a new 256-bit key under
`%APPDATA%/Threadlight/hook-auth/<port>.key`. The directory has a protected Windows
DACL allowing only the current user, SYSTEM and Administrators; new files inherit
those permissions. Publication is atomic and happens only after the listener
successfully binds. Failure to establish the protected credentials disables the
listener. Keys are never put in hook command lines or emitted in diagnostics.

These are **user-scoped credentials**, not proof of a particular Claude/Codex
session or process. A hostile process with access to the same user's credential
files can still forge hook traffic. Existing card/session checks remain necessary.
The unauthenticated, browser-filtered `GET /status` remains available for the
installer and contains only basic diagnostic counts/version data.

### Shared memory and owned MCP connections

The separate shared-memory connection now has server authentication. Both packaged
bridges encrypt enrollment secrets, bearer capabilities, memory bodies and Claude
runtime registrations before sending them. A listener without the bootstrap key
cannot decrypt those requests or manufacture accepted pairing/MCP replies.
Requests bind to the protocol version and exact loopback origin; their route and
capability are inside the encrypted envelope. Timestamps and bounded nonce tracking
reject stale/replayed requests. Replies bind to the request nonce and origin.
Redirects, unauthenticated replies and raw HTTP MCP routes are rejected. No write is
automatically retried after a lost response.

The public listener accepts only encrypted POSTs at `/secure-memory`; `/mcp`,
`/communication` and `/plugin/*` are logical destinations inside the envelope, not
plaintext compatibility routes. Human pairing approval and per-call connection IDs
remain required. The bootstrap key does not itself grant memory access. Scope,
expiry and revocation are checked after the complete upload, and existing checks
for long-running communication remain. Browser Origin/Referer headers (including
empty values), unexpected Host headers, oversized bodies and excessive concurrent
requests are rejected. Aggregate buffered request bytes are bounded.

Each successful memory listener startup publishes a fresh 256-bit key atomically to
`%APPDATA%/Threadlight/memory-auth/server.key`, with the same protected Windows DACL
as hooks. A failed bind cannot rotate credentials. Bridges pin the key on first use;
a server restart requires restarting/reconnecting the bridge and fresh human pairing.
There is no plaintext fallback. The optional endpoint/key-file environment overrides
are trusted launcher configuration for isolated tests, not remotely supplied input.

Threadlight-owned delegation and communication clients, the chat reader,
space-context reader and app-control server use the same authenticated transport.
Provider-facing MCP uses a stdio proxy. Its short command line contains only script
and private configuration paths; bearer and server keys stay in protected files,
not Claude/Codex arguments or prompts. Independent protected directories are
`thread-read-auth`, `space-context-auth` and `app-control-auth` alongside `memory-auth`.
Each caller's private configuration is removed on close, and all that listener's
proxy files are removed on shutdown. Memory startup removes its own stale proxy
files after acquiring the fixed port; stale owned-service files after a crash have
no live server/capability. Credential directories must not be committed or shared.

Manual enrollment exports this stdio configuration too, without returning the bearer
to the renderer. It is tied to the current app instance; generate fresh configuration
after restart. Revocation immediately prevents further calls, including from a proxy
that has already read its private configuration. Local delegation continues using
its existing scoped, expiring task capabilities.

These are account-scoped service credentials. Another process able to read or modify
that user's files can impersonate the service or a bridge. This is not provider
attestation or a sandbox for hostile code running as the same user. A paired chat's
label and native-chat association remain human-declared, not cryptographic identity.

## Upgrade both app and plugins together

Build the application and refresh both installed plugin packages through their
normal plugin managers. Review/trust the changed hook definitions in each provider;
new or reopened sessions must load them. Do not bypass hook trust. The new helper
requires Node 22.16+ on PATH, like the shared-memory bridge.

Old plaintext shared-memory clients and curl-based hooks are intentionally rejected
by the new servers. Refresh both complete plugin packages, including the new
`memory-transport.mjs` asset, then reconnect their MCP processes. New hooks
discard plaintext replies from an old server. A mismatched installation therefore
loses hook-driven status/cards until refreshed; it does not silently fall back to
unauthenticated decisions. Normal provider behavior continues when a hook returns
no decision. The application restart rotates the keys, and each helper invocation
reads the current key. Existing authenticated holds retain their original reply
key until resolved or disconnected.

Building this change does not refresh global plugin caches or restart live apps.
Use the existing installation instructions for each provider. Do not copy keys
between accounts or commit the hook-auth directory.

## Codex-side limitations

The installed Codex desktop 26.1023.6621.0 coordination router was reviewed on
29 October 2026. Its Windows pipe allowed a non-admin same-account process to
connect and initialize without credentials. Isolated tests of the installed router
identified missing socket-to-sender binding on some paths and missing binding of
responses to the expected responding socket. No spoofed traffic was sent to live
chats. This is evidence for that build, not a guarantee about future versions.

Required upstream work includes authenticated/authorized client registration,
mandatory initialization before routing, deriving sender identities from the
connection, binding responses and discovery answers to their expected connection,
and reviewing pipe ACLs and per-user/per-logon naming. Client-supplied labels and
random request IDs are not substitutes for those checks. Threadlight cannot add
these protections to Codex's router, and it does not change that application's
pipe permissions or installation.

Verifying the router process does not authenticate every participant connected to
it. Another same-account process can still join the genuine bus; it may be able to
forge fields that satisfy Threadlight's additional correlation checks. Treat the
native desktop integration as requiring a trusted local account until Codex
enforces the missing boundaries. This patch does not make provider-side claims
of ownership cryptographically trustworthy.

## Scope and validation

The former separate shared-memory server-authentication gap is addressed in this
follow-up. The remaining trust boundaries are same-account code, the installed
provider/plugin binaries, human-declared enrollment identity and upstream Codex
router authentication. The real Claude Desktop inbox acceptance gate is still
closed; synthetic transport tests do not authorize enabling it. This change does
not add server authentication to arbitrary third-party MCP servers configured by
the user. CDP remains test-observer tooling, not a production transport requirement.
Do not enable debugging listeners for normal operation.

See [Claude and shared-memory security validation](../validation/CLAUDE-MEMORY-SECURITY.md)
for the follow-up's test scope, remaining limits and activation requirements.

Regression coverage includes a real disposable Windows pipe rejected before any
initialization bytes, wrong-method/owner replies, authenticated helper round trips,
replay/expiry/tampering/stale keys, credential ACL inspection and key rotation,
existing question/message behavior, and native Claude inbox behavior. The opt-in
`node test/live/codex-ipc-security.proof.mjs` initializes the real verified desktop
connection six times without chat operations and checks native-handle cleanup.
There is no claim of an end-to-end cross-user or remote exploitation test, nor a
complete application security audit.

References: [Windows pipe access rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
[Windows CreateFile and SQOS](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew),
[Codex plugin-hook environment and trust](https://learn.chatgpt.com/docs/hooks#plugin-bundled-hooks).
