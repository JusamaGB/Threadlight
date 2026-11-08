# Security policy

## Report privately

Use GitHub's **Report a vulnerability** action under this repository's Security tab
when available. Do not put credentials, private transcripts or exploit details in
public issues. If private reporting is unavailable, open a minimal issue asking for
a private reporting channel without including the vulnerability itself.

This is a small, early-stage project; response times are not guaranteed.

## Scope

Threadlight can read local chat/workspace data and, through explicitly authorized
features, send provider messages and invoke tools. Its security boundaries include:

- Electron windows, preload IPC and allowed navigation;
- verified native provider connections and message/approval ownership;
- authenticated encrypted local hook, shared-memory and Agent connections;
- project enrollment, access scopes, revocation and delivery receipts;
- isolated artifact previews and workflow authority.

Report paths that permit unintended data access, message dispatch, approval,
execution or cross-project access. Ordinary chat text, tool output and documents
are untrusted content, not authority to control Threadlight.

## Limits and supported scope

The current source-preview branch receives fixes. There is no stable/LTS support
commitment. Provider protocols include private, changing interfaces. Threadlight
cannot protect against every hostile process already running as the same Windows
user or against an upstream provider compromise. See
[the local IPC model and tested limits](docs/security/LOCAL-IPC.md).

Use preview builds on work you can recover. Keep normal backups. Do not assume a
passing test suite is a comprehensive security audit.
