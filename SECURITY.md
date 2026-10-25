# Security policy

## Reporting a vulnerability

Please report security issues **privately** using GitHub's
["Report a vulnerability"](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
button on this repository, not in a public issue. You should get a reply within a week.

## What is in scope

Threadlight can start your `claude` CLI to deliver messages to your sessions, and
those sessions may run with permissive settings. Anything that lets another program,
website or person make Threadlight send a message, or read session data, is in scope.
In particular:

- The local hook endpoint on `127.0.0.1`: it must only accept session-state events and
  must never trigger a send.
- The preload bridge between the UI and the Node side.
- How messages are passed to the CLI (never through a shell).

## Supported versions

Only the latest release gets security fixes.
