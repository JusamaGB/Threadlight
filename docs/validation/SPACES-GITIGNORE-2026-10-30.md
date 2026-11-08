# Shared Spaces ignore choice — 30 October 2026

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

Added Settings → Shared Spaces → Add to .gitignore, default off. Enabling the
setting exposes an unchecked creation checkbox; each new space makes its own
choice. Selection appends an anchored directory rule for that space only, for
example `/shared-spaces/private-ideas/`, in the selected workspace's `.gitignore`.
It works for nested workspaces and before a repository has been initialized.
Existing spaces and tracked files are not changed; switching off the setting
does not remove prior rules.

The backend enforces the setting and records the choice against the stable
creation request. Existing bytes, comments, negations and newline convention are
preserved. The rule is appended after existing negations; identical final rules
are not duplicated on retry. Nonregular/linked files, unsupported text encodings
and oversized files fail explicitly. An ignore-write failure retains the created
space identity so the same request can finish after the file is corrected.

Validation:

- 56 focused tests passed across spaceGitignore, Spaces and settings. Coverage
  includes a real `git check-ignore` invocation from a nested workspace, exclusion
  of only the selected directory, CRLF/BOM preservation, no-repository setup,
  linked-file/encoding protection, backend gating, retry and failure recovery.
- Isolated renderer `spaces-library` smoke passed against real local persistence.
  Checked the Settings switch, hidden/unselected creation states, keyboard selection,
  a fresh unchecked second space, and the actual `.gitignore` contents.
- Reviewed narrow-panel screenshots of Settings and the creation form in
  `C:/proof-temp/threadlight-gitignore-proof/`. No native app was launched or restarted.
- Focused lint, web TypeScript, production build and diff whitespace checks pass.
  Full Node TypeScript is blocked by the concurrent `test/audioEnergy.test.ts`
  importing renderer audio types outside the Node project's file list/DOM libs;
  no errors were reported in the ignore-setting implementation.

Updated Unreleased, README, Shared Memory guide and the ongoing Brainstorm test
working record. Changes are in the primary checkout; live acceptance follows the
user's deliberate restart.
