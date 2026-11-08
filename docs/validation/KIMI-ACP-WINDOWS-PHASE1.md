# Kimi ACP Windows proof: Phase 1A

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

Date: 4 November 2026. Status: **Phase 1A complete; Phase 1B NOT RUN**.
This is a probe and preparation checkpoint, not provider integration or acceptance
of Kimi's live Stop/Play, permissions, ownership or recovery behavior.

## Authority and baseline

The Phase 0 Review and Phase 1A Executor Directive authorizes six repository paths,
isolated artifact preparation and supported non-inference inspection. Model usage
authorization is zero prompts. No login, credential changes, session creation,
restoration, live tools or model calls were performed against Kimi.

Primary checkout: `C:/dev/threadlight`, branch `main`, starting HEAD
`1dc0be85a35954089db2a6ce580c718bc4513cdc`. The contract read gate revalidated the
Phase 0 records, current root AGENTS and relevant workflow, authority, immutable
candidate verification, communication/recovery and owned-process contracts.
The working contract hashes recorded in the cumulative progress file still apply.
No subordinate instructions or applicable diff-log helper were found. The four
proposed new files were absent; the index was empty. The original 96 dirty tracked
and 64 untracked paths remained unchanged before edits and at final preservation
verification. Only the following six paths belong to this phase:

- `test/live/kimi-acp.proof.mjs`
- `test/fixtures/fake-kimi-acp.mjs`
- `test/kimiAcpProbe.test.ts`
- `docs/validation/KIMI-ACP-WINDOWS-PHASE1.md`
- `docs/specs/KIMI-INTEGRATION-PROGRESS.md`
- `updatedifflog.md`

The commit introducing this report is the Phase 1A commit; obtain its full identity
with `git log --diff-filter=A -1 --format=%H -- docs/validation/KIMI-ACP-WINDOWS-PHASE1.md`.
The checkpoint response records the concrete resulting hash.

## Artifact identity and source correspondence

**PASS — source inspection and artifact verification.** Registry:
`https://registry.npmjs.org`; exact package: `@moonshot-ai/kimi-code@2.4.1`.
Tarball:
`https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.4.1.tgz`.
The downloaded 18,742,688 bytes match declared SRI:

```text
sha512-z0py3AxbV9ykOB3Pgh2FiycZbMy7XSAXH4Kb1yfyhhmk+l9xH8H9raakVvCGMYLVxxEQGitQLcgOh8clLVYUTw==
```

All preparation and raw evidence is outside the checkout at this actual path,
called `$prep` in the commands below:

```text
C:/proof-work/kimi-phase1a
```

Installed metadata confirms package name/version and `bin.kimi = dist/main.mjs`.
The actual entry point is:

```text
C:/proof-work/kimi-phase1a/runtime/node_modules/@moonshot-ai/kimi-code/dist/main.mjs
```

Entry SHA-256:
`fd15d5c9b48892bb4f1d5fe82df9f790c8c19a44ca9a81054cc592b6fb9e2c90`.
The isolated `runtime/package-lock.json` SHA-256 is
`7dfee229a1b8d354de84fd58af1f4eb39a197d396b0fba8fc631d358fbd035c8`.
`evidence/dependencies.json` records the 35 installed packages, versions, resolved
URLs, integrity values and scripts; the lock also preserves platform-optional
resolution records. The main package's installed integrity equals the tarball SRI.

`npm audit signatures` against this isolated installation exited 0: 35 verified
registry signatures, four verified attestations; JSON output has no invalid or
missing results. Registry signature key ID:
`SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`.
The verified Kimi SLSA provenance subject matches the tarball digest and identifies:

- Repository: `https://github.com/MoonshotAI/kimi-code`.
- Commit: `2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7`.
- Workflow: `.github/workflows/release.yml`.
- Ref: `refs/heads/release/2026-10-30`.
- Invocation: `https://github.com/MoonshotAI/kimi-code/actions/runs/41035609402/attempts/1`.

Thus the versioned registry artifact is verified and its verified provenance
identifies the audited source commit. This is build provenance, not an independent
reproducible build or proof that every inspected source behavior occurs at runtime.
Absence of `gitHead` did not trigger a source rebuild or floating substitution.

Raw records: `artifacts/registry.json`, `artifacts/kimi-code-2.4.1.tgz`,
`artifacts/attestations.json`, `artifacts/unpacked/package`,
`evidence/signatures.json`, `evidence/signatures.txt`,
`evidence/dependencies.json`, `runtime/package-lock.json` and
`source/artifact-excerpts.txt`, all beneath `$prep`.

Sources consulted: [pinned manifest](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/apps/kimi-code/package.json),
[postinstall](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/apps/kimi-code/scripts/postinstall.mjs),
[release workflow](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/.github/workflows/release.yml)
and [npm provenance verification](https://docs.npmjs.com/viewing-package-provenance/).

## Installation, state and process boundaries

**PASS — source inspection.** Inherited npm settings were inspected before install;
global was false, but the ordinary prefix pointed at roaming npm. The actual install
used an explicit local working directory, private exact-version manifest, empty
user/global npm config files, a dedicated cache and these options:

```text
# Working directory: $prep/runtime
npm.cmd install --global=false --ignore-scripts --no-bin-links --no-audit --no-fund --registry=https://registry.npmjs.org/ --cache "$prep/npm-cache" --userconfig "$prep/empty-user.npmrc" --globalconfig "$prep/empty-global.npmrc"
npm.cmd audit signatures --registry=https://registry.npmjs.org/ --cache "$prep/npm-cache" --userconfig "$prep/empty-user.npmrc" --globalconfig "$prep/empty-global.npmrc"
```

The package postinstall's global-install behavior was inspected, never executed.
All lifecycle scripts were disabled, including dependency scripts. The only
installed lifecycle entry was Kimi's postinstall; the native clipboard optional
package was prebuilt. No global shim, PATH, Node installation, Threadlight manifest,
Threadlight lockfile or account configuration was changed. An initial prefix-based
install command failed before installation; the explicit local-CWD command above
succeeded. No tooling migration was needed.

Inspection of the downloaded bundle established `KIMI_CODE_HOME` as the supported
data/config/auth/log path override and `KIMI_DISABLE_TELEMETRY=1` as supported.
The probe preserves normal system locations rather than changing HOME/USERPROFILE;
the provider receives an environment whitelist that excludes inherited credentials
and provider overrides. Every real operation requires a new directory and creates
its own `state` and `project` subdirectories. Existing directories and altered entry
hashes are rejected. This is application state isolation, not an OS filesystem or
network sandbox. No claim of a complete machine-level write trace is made.

The existing `ownedProcess.ts` and `windowsProcessJob.ts` are reused unchanged via
the installed TypeScript transpiler, with local module scope and no build output or
global require hook. On Windows, the helper assigns a gated launcher to a private
job before launching the absolute Node executable and JavaScript entry with literal
arguments and `shell: false`. Cleanup terminates only that owned job and checks its
active count, including descendants. It never kills by executable name. This does
not establish the shell Kimi would use for live tools or remote-work cancellation.

## Probe and fixture contract

**PASS — source inspection and fixture tests.** Importing the `.mjs` is inert.
The CLI accepts only `initialize`, `version` or `help` with explicit absolute
installation/new-run paths and an entry SHA-256. There is no real prompt, login,
session-create, restore, permission-approval or live-task API. Merely discovering
credentials or installation does not launch anything. Ordinary Vitest discovery
uses the fixed fake executable exclusively; a spawn-blocking import test enforces
the inert boundary even with synthetic credentials in the environment.

Transport is UTF-8 newline-delimited JSON, as implemented by the bundled ACP SDK's
`ndJsonStream`, including its final-line behavior. The probe handles split UTF-8,
combined/interleaved frames, typed request IDs, opaque session IDs, reverse
permissions, duplicates, unknown/late responses, EOF, process exit and bounded
waits/output. Records contain event metadata rather than prompts or arbitrary
provider log text. No uncertain request is automatically replayed.

Fixture prompts are tied to registered sessions. Cancellation requested, prompt
terminal result, process exit, cleanup confirmation and uncertainty are separate
observations. A cancel write does not settle a turn. Permissions require a matching
pending turn and explicit unexpired one-shot selection; missing/expired approvals,
stopped/disconnected turns and unanswered requests become cancelled. Explicit
denial stays a denial; duplicate IDs/answers do not act twice. These are probe
semantics demonstrated with a fake, not Kimi product guarantees.

## Verification: static, runtime, behavior, contract

| Layer    | Status and evidence kind                                 | Actual result                                                                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static   | PASS — source inspection                                 | Syntax, scoped ESLint, Prettier, allowlist/diff inspection; no production/dependency edits or implicit real execution.                                                                                                                                                                                          |
| Static   | PASS — source inspection/typecheck                       | Focused TS test check with the repository base strict settings and only the new test.                                                                                                                                                                                                                           |
| Static   | FAIL — existing repository typecheck                     | Node project reports six existing audio-related errors; no probe-test diagnostic. Details below.                                                                                                                                                                                                                |
| Runtime  | PASS — fixture test                                      | Fake subprocess launch, stream handling, orderly and forced cleanup on native Windows.                                                                                                                                                                                                                          |
| Runtime  | PASS — actual non-inference runtime observation          | Exact Kimi artifact version/help and ACP initialization under Windows PowerShell 5.1; all final operations exit 0 with owned cleanup confirmed.                                                                                                                                                                 |
| Behavior | PASS — fixture test                                      | 14 tests: request/session correlation, concurrent sessions, opaque IDs, fragmented UTF-8/interleaving, duplicates, denial, missing/expired/unanswered permissions, delayed cancel settlement, disconnect uncertainty/no replay, malformed output, owned timeout cleanup, identity/state guard and inert import. |
| Behavior | NOT RUN — actual live-provider observation               | Account/model access, editing, live permissions, foreground/background Stop, ownership/admission and recovery/continuation.                                                                                                                                                                                     |
| Contract | PASS — source inspection and local preservation evidence | Six allowed files only; original 160 changed files preserved; no login, inference, app restart, production integration, push or PR.                                                                                                                                                                             |

Commands actually run from `C:/dev/threadlight`:

```text
node --check test/live/kimi-acp.proof.mjs
node --check test/fixtures/fake-kimi-acp.mjs
node node_modules/eslint/bin/eslint.js test/live/kimi-acp.proof.mjs test/fixtures/fake-kimi-acp.mjs test/kimiAcpProbe.test.ts
node node_modules/prettier/bin/prettier.cjs --check test/live/kimi-acp.proof.mjs test/fixtures/fake-kimi-acp.mjs test/kimiAcpProbe.test.ts docs/validation/KIMI-ACP-WINDOWS-PHASE1.md docs/specs/KIMI-INTEGRATION-PROGRESS.md updatedifflog.md
npm.cmd run test -- test/kimiAcpProbe.test.ts
node node_modules/typescript/bin/tsc --project "$prep/probe-tsconfig.json"
node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit --tsBuildInfoFile "$prep/evidence/node.tsbuildinfo"
git diff --cached --check
```

The Node typecheck exits 2: missing DOM types `AnalyserNode`, `AudioNode`,
`AudioContext` in `src/renderer/lib/audioEnergy.ts` and `test/audioEnergy.test.ts`,
plus TS6307 because that renderer module is not in the Node project file list.
These paths were already changed before Phase 1A and were left untouched.
`evidence/typecheck.txt` retains the six diagnostics. The final focused check exits
0 (`probe-tsconfig.json`, `evidence/probe-typecheck.txt`); the final fixture run is
14/14 in `evidence/fixtures-final.txt`. No app build, UI proof or broad test rerun
is warranted for this test/probe-only change.

**Actual non-inference runtime observation:** Node executable
`C:/Program Files/nodejs/node.exe`, v22.23.4, win32/x64; package requires >=22.19.
The tested PowerShell 5.1 wrapper is `$prep/run-inspection.ps1`. It invokes that
Node executable, the absolute probe path, operation, `$prep/runtime`, fresh run
path and recorded entry hash. The following invocation pattern was executed under
Windows PowerShell 5.1, not inferred from PowerShell 7:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -File 'C:/proof-work\kimi-phase1a\run-inspection.ps1' -Operation initialize -RunName initialize-owned-ps51
```

For any authorized repeat, choose a new run name; the existing name is deliberately
refused. The same wrapper was tested with `version` and `help`. Evidence beneath
`$prep`: `version-final-ps51/report.json` (launcher 252),
`help-final-ps51/report.json` (launcher 19172), and
`initialize-owned-ps51/report.json` (launcher 19464). Read-only Windows process
inspection recorded actual runtime PID 17988, parent 19464, exact Node/entry/`acp`
command and creation times in `evidence/owned-processes.json`. Final process checks
confirmed both had gone. PIDs are historical observations, never future kill targets.
After the final CLI exit-status check was tightened, `initialize-commit-ps51/report.json`
also confirmed protocol/version, exit 0 and cleanup using the committed probe code.

Version output was `2.4.1`. Initialization returned protocol version 1 and
`agentInfo` Kimi Code CLI/2.4.1. Advertised metadata: loadSession; image and embedded
context prompts (audio false); session list/resume/close/delete/fork/additional
directories; MCP HTTP/SSE; logout; terminal account-login route with the isolated
home in its environment. These are advertisements, not exercised capabilities.
Only `initialize` was sent. Each final state directory contains zero files;
stderr for initialization was zero bytes, exit 0, cleanup confirmed, prompt count 0.
Earlier runs and manifests remain as raw evidence, including a corrected initial
PowerShell wrapper quoting failure. No existing user state was opened to make this
pass. No provider session was created or restored.

## Phase 1B proposal — requires new authorization

Before execution, the maintainer must choose the Kimi account/access route and authorize
its use in a dedicated new state directory, approve a model, and supply an explicit
usage/spending allowance (including whether account-quota consumption is permitted).
The observed route is normal Kimi account device-code login. An API-key route is
not assumed available; establish it separately if selected. Keep credentials out
of logs, Git and prompts. Do not reuse the existing user's state directory.

After authorized authentication, obtain supported model identifiers from the
runtime's account-backed model/configuration metadata. Record the offered list,
chosen identifier and effective model reported by the disposable session; do not
guess a model name from this version number. Check the response's supported
configuration fields before sending a model-selection operation.

Propose at most **12 foreground prompts and 20 elapsed minutes** after readiness,
with staged authorization to stop after any failed exercise. These are client-side
operational limits, not a monetary ceiling. Provider loops, retries, background
work and continuation can consume additional usage. No runtime-enforced hard spend
cap has been verified in Phase 1A. Confirm any account-side cap and its actual
enforcement before relying on it; otherwise the maintainer must approve a stated exposure
and stop condition. Do not invent a monetary amount or describe local termination
as proof that remote billing stopped. Log available usage observations with their
delay/coverage limitations.

The current probe intentionally has no live-task switch. Phase 1B authorization
must also cover the smallest probe extension for explicit authenticated operations,
prompt counters/deadlines, evidence and owned cleanup; review/test those gates
before the first model prompt. No automatic live suite or retries on uncertainty.
Use disposable projects and sessions only, with one host process per exercise when
task-wide cleanup cannot otherwise be attributed safely.

| Order | Exercise and proposed foreground prompt budget                             | Evidence and acceptance boundary                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Minimal authenticated session and streaming (1)                            | Record initialize/session IDs, exact selected/effective model, streamed sequence and terminal result; no project writes. Account readiness is a separate non-prompt gate.                                                                                                                  |
| 2     | Controlled tool permission approval, then denial (2)                       | Match request ID, session, turn and offered option; show one approved harmless action and absent side effect after denial; retain tool results without secrets.                                                                                                                            |
| 3     | Controlled edit and check (1)                                              | Synthetic repository with recorded initial commit/tree/hash, exact allowed file, before/after diff and deterministic check output. Prepare evidence for Threadlight's existing immutable-candidate verification; do not invent another result system.                                      |
| 4     | Cancel during generation, then a foreground command (2)                    | Timestamp cancel dispatch, last event, terminal response, owned command PID/creation and actual command exit. Missing terminal result stays unresolved even if local cleanup succeeds.                                                                                                     |
| 5     | Background/subagent settlement (1)                                         | Record each owned job/child identity and lifecycle; target cancellation while an independent harmless test-owned sentinel survives. Verify command settlement and late events separately from foreground completion. Budget all additional model work, not only the one foreground prompt. |
| 6     | Restore, then one explicit continuation (2: initial turn and continuation) | Save isolated native session ID, close owned host, restore without an implicit prompt, then submit exactly one authorized continuation. Match history, source state and usage; no automatic replay.                                                                                        |
| 7     | Disposable-session ownership/disconnect cases (up to 3)                    | Observe second attachment/admission behavior and lost-response cases using only the new isolated sessions. Report native concurrency separately from future Threadlight admission guarantees; reconcile uncertainty before any next prompt.                                                |

Each exercise records artifact/entry/lock/probe/helper hashes, Node version, literal
arguments, cwd/state, source tree, request/session/permission IDs, event times,
terminal outcomes, owned process identities, cleanup and independent sentinel
status. Keep synthetic content public and redact credentials. Never attach to or
terminate the running Threadlight session.

On timeout/disconnect: stop admissions, revoke pending approvals, mark unknown
outcomes uncertain and attempt cancellation only on the known live connection.
Wait a bounded settlement interval, close stdin, then use the owned Windows job
cleanup and verify emptiness. Preserve evidence/state for inspection; do not replay
or restore automatically. Clean up each independent sentinel through its own owner
in a finally path. Local process exit does not prove remote task or charge closure.

If stock ACP cannot establish task-wide Stop, stop escalation and report the
smallest enforceable restriction/extension with evidence. Possible candidates for
later review are a verified runtime-level disablement of background tools, or an
isolated one-session host that can be retired with explicit loss-of-continuation
semantics. Neither is currently established. A prompt asking for no background
work is not enforcement. Persistent Goal controls and arbitrary live tool-shell
behavior remain outside this Phase 1A proof.

## Checkpoint

Brainstorm's bounded writes/drafts/already-authorized operations and their guards
remain intact. Guided verification already uses immutable candidate trees and
should receive future Kimi evidence. Unfinished Perplexity and shared wiring remain
untouched. The regular Threadlight application was not restarted; its loaded
revision and active task state remain unverified. No supported product capability
changed, so no CHANGELOG/README edit is needed or included. Phase 1B remains NOT RUN.

## Phase 1B checkpoint — live controls implemented; access gate blocked

4 November 2026. This entry supersedes the earlier proposed Phase 1B procedure
where it describes implemented controls. It does not turn Phase 1A observations
into live-provider evidence. Starting main HEAD:
`12856c8e04b6ed481fc5d0a790b4ba6f9ffb2a08`. The six permitted paths were clean before
this phase; the index was empty and 160 unrelated changed paths were inventoried.
Current instructions/contracts and the three existing probe files were reread.
No additional worktree, production change or dependency change was needed.

### Account decision and product clarification

After the extension, focused tests and live-operation diff review were concrete,
the executor asked the section 6.1 account/allowance question. the maintainer replied that
he does not believe any Kimi account/API/server/local-model access is established,
and wants open-source users to choose local, server or Moonshot API options in
Settings. No access route, included allowance, paid budget or account-setup
authorization was supplied. No credential was requested in chat.

**Phase 1B is partial. Live execution is BLOCKED:** ENVIRONMENT_LIMITATION (no
established access) and AMBIGUOUS_INTENT (route/usage allowance not selected).
Account-cap enforcement evidence is also EVIDENCE_MISSING. No login, real session,
prompt, continuation or live permission approval ran; actual usage is zero prompts
and no observed provider usage. No account purchase, plan change or overage change.
Continue within this same Phase 1B when access and allowance are established; no
extra preparation phase or planning-chat round trip is required.

The temporary CLI installed in Phase 1A is an agent runtime, not installed model
weights. Proposed Settings must distinguish **agent execution location** from
**model connection**. This is a product direction, not authorization to edit the
production Settings files in this six-file assignment.

| Model connection choice     | Meaning and current evidence                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi account / Moonshot API | Hosted inference. Official CLI documentation supports managed OAuth and Kimi Platform API credentials; account access and billing must be established separately.                   |
| Local model endpoint        | A separately installed compatible inference server on the user's machine. Installing the CLI alone does not provide this. Hardware/model/tool-calling suitability must be verified. |
| Server model endpoint       | A user-controlled compatible inference endpoint on another machine. This does not by itself move project files or agent commands to that server.                                    |

The pinned [provider documentation](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/configuration/providers.md)
describes Kimi and OpenAI-compatible provider types and configurable base URLs.
The pinned [setup guide](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/guides/getting-started.md)
distinguishes account login from Platform API keys.
Moonshot's [Kimi K2 deployment documentation](https://github.com/MoonshotAI/Kimi-K2#4-deployment)
provides a separate model-serving route. These establish configuration/design
options, not tested Threadlight support for every endpoint. Remote **agent** hosting,
remote execution and remote-work termination remain outside this Windows proof.

### Implemented live gate and state ownership

The CLI retains the Phase 1A operations and adds explicit
`live prepare|login|discover|restore|prompt|continue ABS_PLAN_JSON` operations.
The module exports `prepareLiveExercise`, `loginLiveExercise`, `openLiveExercise`
and separately fixed-fake preparation/open functions. Import and ordinary tests
remain inert with respect to Kimi. `live prepare` creates synthetic files and
ownership/configuration records only; it does not launch Kimi.

The plan selects the verified installation, exercise ID/root, operation and, for
authenticated operations, a non-secret the maintainer decision reference, account route,
region, authorization expiry, model-discovery policy and allowance. The current
login implementation is deliberately limited to the supported account device-code
route. API-key and custom/local endpoint setup are researched proposals, not falsely
advertised as implemented probe routes. Their future support requires explicit
credential/endpoint scope and equivalent tests before use.

Real launch rechecks the pinned package entry and lock hashes. State and workspace
must be created by this probe under the established preparation area's `phase1b`
directory. An independent ownership anchor binds the exercise/root/runtime/home/
workspace; an HMAC-sealed mutable record also binds native session identity and
operation history. A file lease excludes a second owner across processes. Mutable
counters are read after acquiring that lease, preventing stale reads from rolling
back another connection's completed turn. Copied/forged/mismatched state is refused.
Stale leases and unresolved operations require reconciliation, never automatic
deletion/replay. These local records prevent accidental adoption and mixing; they
are not an OS security boundary or cryptographic proof of a human chat decision.

The operator must record a real user decision; fixtures are explicitly marked and
cannot authorize the real path. No authorization record was created for this run.
Installation identity stays separate from disposable state. A changed allowance
cannot silently reopen a previously authorized exercise. Account-cap evidence can
be added without changing the already-approved route or allowance.

Session restoration is separate from prompting. After discover/restore, model
choices come from `configOptions`; the probe rejects an unoffered identifier and
requires returned confirmation of both the effective model and manual permission
mode. It requires fresh confirmation for each connection. Continuation requires
a recorded prior terminal turn and a new explicit operation ID. Repeated IDs return
the saved outcome; changed content with the same ID is rejected.

Before sending, the probe durably reserves the prompt count and operation identity.
Disconnects become uncertain and block new admissions. A cancel write remains a
request until a terminal result arrives. Deadline/user-stop cleanup retires only
owned processes and does not fabricate provider settlement.

### Limits, permissions and evidence

- **Enforced by the probe:** at most 12 aggregate foreground prompts (including
  continuation); at most 20 minutes from first authenticated session operation;
  authorization expiry; one active operation/owner; no automatic replay; bounded
  request/output waits; owned process cleanup. Smaller authorized bounds are allowed.
- **Inference gate:** an independently verified account-cap evidence reference must
  match the chosen account route and allowance mode. The code checks the binding,
  not an account billing system. The executor must establish the evidence before
  recording it. A JSON assertion alone does not establish a provider spending cap.
- **Runtime configuration, source-inspected only:** ask for every tool; deny Agent,
  Task, web and cron tools; task limit 1, no keepalive or automatic Bash backgrounding,
  bounded task timeout/steps, zero configured step retries. Actual enforcement is
  NOT RUN. Subagent work is currently disallowed rather than claiming a per-task
  registry limit proves an aggregate limit across descendant agents.
- **Approvals:** only an exact predeclared approval-display hash can receive
  `allow_once`. It must match the current request, operation and expiry. Explicit
  denial stays denial; permanent/session-wide approval is unavailable. Unknown
  displays remain unapproved. Native ACP supplies display content rather than full
  structured tool arguments, so a display hash is not proof of filesystem scope.
  The executor must review its complete action before declaring a hash. No blanket
  tool approval or remote tool operation is permitted.
- **Evidence:** probe/helper/runtime/config hashes, Node/args/cwd/home, account-route
  decision reference, model/session/operation IDs, before/after synthetic file hashes,
  terminal/uncertain outcomes, streamed updates, available usage fields and cleanup.
  Common credential fields/token patterns are redacted from saved run evidence;
  the login flow is displayed transiently and not copied into a transcript artifact.
- **Observational/unproved:** provider charges, actual token use, background/subagent
  settlement, native exclusivity, remote completion and runtime tool enforcement.
  No local timer is represented as a monetary cap.

Prepared exercise root:
`C:/proof-work/kimi-phase1a/phase1b/exercise-01`.
Its `project` contains only `task.txt` and `check.mjs`; its `state` contains only
the control `config.toml`. Native session/model are null, prompt count is 0 and
authorization hash is null. Preserve this state; do not replace it with an ordinary
user Kimi home. The account decision can be recorded later without recreating it.

Raw Phase 1B evidence is under the sibling `phase1b` directory: `artifact-binding.json`,
`fixtures.txt`, `prepare-plan.json`, `run-live.ps1`, preservation inventories and
final source/check hashes. Artifact verification again matched the actual tarball's
SHA-512 to the provenance subject and the expected repository/commit, not just the
historical signature counts. The installed entry/lock hashes still match Phase 1A;
no reinstall, update or repeated signature-network audit was needed.

### Live procedure after the gate is satisfied

1. Establish the chosen account/endpoint and allowance through a supported local
   setup flow. For the currently implemented route, use explicit `live login` and
   let the maintainer complete device-code sign-in. Do not purchase credit or enable overage.
2. Verify allowance enforcement and that the runtime retained the control config.
   Formatting/semantic changes to that config currently fail closed and need review;
   do not bypass the check just to make a login pass. If the selected allowance
   cannot be enforced, stop before inference and propose a provider-side hard cap
   or a separately authorized suitable self-hosted endpoint. Do not assume either
   exists or is free.
3. Use `discover` to create the owned disposable session and obtain its offered
   models. Choose and confirm a supported effective model; the maintainer need not know an
   identifier in advance. The 20-minute aggregate clock begins at this session step.
4. Execute one minimal streaming prompt, then permission approval/denial and a
   controlled `task.txt` change with the predetermined `check.mjs`. Record actual
   side effects and command results before making an enforcement claim. Only exact
   reviewed displays may be approved using the controller's live permission methods.
5. Use the controller's operation-bound `cancel` during generation/foreground
   command; observe terminal result, command activity and cleanup independently.
   A separate driver can call these methods; the CLI does not auto-approve requests.
6. Background/subagent exercises are BLOCKED until a reviewed enforceable scope is
   available. The current stricter zero-subagent configuration must not be weakened
   on the strength of a prompt. Any later bounded exercise needs an independent
   test-owned sentinel and its separate finally cleanup.
7. Close/restore without prompting, inspect history/source state, then submit one
   explicit continuation. Repeated operation IDs must not send again. Characterize
   native competing connections only in disposable state under an explicit owned
   test arrangement; the current exclusive probe lease itself is not native proof.
8. On lost delivery or missing settlement, stop admissions, revoke approvals,
   preserve evidence/state and retire only owned processes. Reconcile before any
   further prompt. Do not consume the remaining allowance merely because it exists.

The earlier seven-exercise budget totals at most 12 foreground prompts, not a
requirement to spend them. A material uncertainty stops escalation. No session has
yet reached step 1. API/custom-endpoint and remote-agent operations are not silently
substituted for the current login route.

### Capability assessment at this checkpoint

All actual live rows below have no effective model/session because no access was
authorized. Their common evidence is the empty owned session ledger, rejected
missing-authorization launch and the user's access clarification. Fixture evidence
comes from the focused test file and `phase1b/fixtures.txt`.

| Requirement                           | Fixture/control evidence                                         | Actual live-provider status and integration consequence                                   |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Account/model discovery and streaming | PASS: offered-model selection and fake streamed events           | BLOCKED: no account; no availability claim.                                               |
| Permission approval/denial            | PASS: exact one-shot scope, duplicate suppression, denial/expiry | BLOCKED: no real side effects observed; do not advertise enforcement.                     |
| Controlled edit/check/source binding  | PASS: before/after source hash capture                           | NOT RUN: no provider edit/check; later bind evidence to immutable candidate verification. |
| Foreground-turn cancellation          | PASS: cancel requested remains pending until settlement          | BLOCKED: native cancellation unproved.                                                    |
| Foreground-command termination        | PASS: owned timeout/descendant cleanup                           | NOT RUN: no live Kimi command or tool-shell observation.                                  |
| Background-task settlement            | No provider-equivalent fixture claim                             | NOT RUN: local host cleanup is not task-wide settlement.                                  |
| Subagent settlement                   | Configured restriction: subagents denied                         | BLOCKED: aggregate scope and lifecycle not established.                                   |
| Process-job cleanup                   | PASS: fixture descendants retired; independent sentinel survives | Phase 1A non-inference PASS only; Phase 1B live cleanup NOT RUN.                          |
| History restoration                   | PASS: sealed owned state reopened without a prompt               | BLOCKED: native restore execution behavior unproved.                                      |
| Explicit continuation                 | PASS: counted and persisted; duplicate ID never resubmits        | BLOCKED: native continuation/unrepeated work unproved.                                    |
| Native concurrency                    | PASS: probe lease and per-operation admission                    | NOT RUN: not evidence of native exclusivity.                                              |
| Uncertain delivery                    | PASS: disconnect persists uncertainty; reopen cannot replay      | BLOCKED: actual provider receipts/reconciliation unproved.                                |
| Remote execution/termination          | Outside proof                                                    | NOT RUN; no support claim.                                                                |

### Verification and Stop decision

Static PASS: six-file scope, syntax, scoped ESLint/Prettier, focused strict TS test
check, reviewed live diff and staged whitespace/diff checks. The pre-existing six
audio-related repository type errors remain a historical baseline limitation; the
broad Node check was not rerun and no unrelated fix was made.

Runtime PASS (fixture): subprocess/state ownership and cleanup. Windows PowerShell
5.1 actually ran the `run-live.ps1` wrapper for `prepare` (exit 0) and an unauthorized
`discover` (expected exit 1, before any Kimi launch). TOML syntax was parsed locally.
Authenticated Kimi runtime, native tool shell and model operations: NOT RUN.

Behavior PASS (fixture): 28/28 focused tests, including the original 14. Added
authorization, owned-state/tamper/reuse, explicit continuation/idempotency, persistent
uncertainty, exact approvals/denial/late revocation, aggregate count/deadline,
separate spending gate, competing owners, model selection and config-change refusal.
Contract PASS: user clarification honored; no live authorization inferred; original
work and running app preserved; only six allowed files committed; no push or release.

Final local commands (checkout `C:/dev/threadlight`):

```powershell
node --check test/live/kimi-acp.proof.mjs
node --check test/fixtures/fake-kimi-acp.mjs
node node_modules/eslint/bin/eslint.js test/live/kimi-acp.proof.mjs test/fixtures/fake-kimi-acp.mjs test/kimiAcpProbe.test.ts
node node_modules/prettier/bin/prettier.cjs --check test/live/kimi-acp.proof.mjs test/fixtures/fake-kimi-acp.mjs test/kimiAcpProbe.test.ts
node node_modules/typescript/bin/tsc --project "$prep/probe-tsconfig.json"
npm.cmd run test -- test/kimiAcpProbe.test.ts
git diff --check -- test/live/kimi-acp.proof.mjs test/fixtures/fake-kimi-acp.mjs test/kimiAcpProbe.test.ts docs/validation/KIMI-ACP-WINDOWS-PHASE1.md docs/specs/KIMI-INTEGRATION-PROGRESS.md updatedifflog.md
```

Here `$prep` is the absolute Phase 1A preparation root recorded above, not the
`phase1b` subdirectory. The final fixture run passed 28/28 in 16.67 seconds.
`phase1b/final-checks.json` records command outcomes; preservation baseline/precommit/
postcommit inventories and `final-source-hashes.json` bind the checkpoint. All six
original Electron processes retained their IDs and 08:06 creation times at the final
check; no app restart was performed. The loaded app revision remains unverified.

**Task-wide Stop is not established.** Only probe-owned local process retirement is
demonstrated by fixtures (and Phase 1A non-inference observation). Do not admit Kimi
to production task execution on this evidence. The smallest current enforceable
restriction is no live production admission. A future runtime extension must expose
task-owned descendant identities and aggregate admission/settlement, or prove a
restricted one-session host can be retired with explicit continuation-loss semantics.
Remote service termination remains a separate unresolved capability.

### Proposed first production slice: connection setup with capability gates

Proposal only, incorporating the maintainer's settings direction. Add non-secret connection
profiles and explicit readiness/unsupported states without enabling agent execution.
Separate agent host from inference endpoint. Initial supported agent-host selection
would be local; remote agent hosting remains visibly unavailable until its own proof.
Offer planned model-connection choices for managed account, Moonshot API and compatible
local/server endpoints, with per-route setup/verification status. Credentials stay
in the runtime's supported local authentication/configuration path; do not put API
keys into general settings or repurpose unfinished Perplexity credential storage.

Proposed code/test paths, all relative to `C:/dev/threadlight` (none edited here):

| Existing/new path                                              | Proposed symbols/responsibility                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| New `src/shared/kimi.ts`                                       | `KimiConnectionProfile`, `KimiCapabilityAssessment`: explicit host/endpoint/auth-route fields and individually evidenced capabilities.   |
| Existing `src/shared/settings.ts`                              | `settingsSchema`: optional disabled-by-default non-secret Kimi setup profile; preserve Claude/Codex defaults and unrelated settings.     |
| Existing `src/main/settings.ts`                                | `SettingsStore`: atomic profile persistence using the existing settings service.                                                         |
| New `src/main/kimi/runtime.ts`                                 | `inspectKimiRuntime`: absolute runtime identity/version/hash and setup readiness; no implicit login, model request or arbitrary shell.   |
| Existing `src/main/communication/admission.ts`                 | Proposed `kimiCommunicationAdmitted`: fail closed while native ownership/Stop evidence is absent; preserve `codexCommunicationAdmitted`. |
| Existing `src/shared/ipc.ts`                                   | `IPC`, `ThreadlightApi`: typed explicit read-only Kimi readiness operation.                                                              |
| Existing `src/main/index.ts`                                   | Register readiness handler with current sender/frame guards; reuse `updateApplicationSettings`.                                          |
| Existing `src/preload/index.ts`                                | Typed readiness bridge only; no general command/config-file access.                                                                      |
| New `src/renderer/settings/KimiSettings.tsx`                   | Contextual connection choices, setup status and concrete next action; no unsupported-capability claims.                                  |
| Existing `src/renderer/settings/SettingsView.tsx`              | Mount the Kimi settings section using existing settings conventions.                                                                     |
| New `test/kimiSetup.test.ts`; existing `test/settings.test.ts` | Profile validation/migration, identity mismatch, redaction, no automatic launch/network/inference and denied admission.                  |
| New `test/ui/kimi-settings.smoke.mjs`                          | Isolated settings UI proof; never restart the regular app.                                                                               |

Future execution adapters must reuse `spawnOwnedProcess`/`stopOwnedProcess`,
`OwnedRequests`, CommunicationService/store admission and uncertain-delivery records,
then feed existing ChangeWorkflowService immutable candidate/check/versioned-result
mechanisms. They must preserve opaque native IDs and keep execution-provider identity
separate from inference endpoint choice. This setup slice does not add Kimi to the
active `Provider` union/catalogue or replace those systems prematurely.

Acceptance: save/reopen profiles without secrets or inference; unknown/mismatched
identity fails closed; existing provider defaults and Brainstorm authority remain
unchanged; unavailable remote hosting and missing live capabilities are clear; local
versus hosted inference is accurately described; tests/UI proof pass before shipping.
Settings/model discovery must never silently enable a paid route or consume quota.
When user-visible setup is authorized, update CHANGELOG/README and guides in that
same future scope. No such user-visible change occurs in this checkpoint.

Collision warning: `src/shared/settings.ts`, `src/shared/ipc.ts`, `src/main/index.ts`,
`src/preload/index.ts` and `SettingsView.tsx` already contain unfinished shared work,
including Perplexity integration. Re-read and coordinate ownership before any future
edit. Do not reset or replace these files to implement this proposal.

## Phase 2B — real Kimi runtime with a scripted model endpoint

4 November 2026. This checkpoint establishes **Real Kimi runtime with a scripted
model endpoint**. It is separate from the fake ACP tests above and from real
model/provider validation, which remains NOT RUN. Production execution is disabled.

### Configuration and pinned contract

The saved `kimiSetup` is persisted and reloaded by the actual SettingsStore before
the probe calls `src/main/kimi/config.ts`. A scoped TypeScript loader imports that
same implementation; the probe does not duplicate its mapping. No saved-schema,
runtime-inspector, provider-union or production-dispatch change was needed.

| Saved route                | Runtime translation                                                                     | Evidence                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Local model / local agent  | Exact loopback endpoint, `openai`, exact wire model, independent model/provider aliases | Structural tests plus actual scripted HTTP/ACP exercise PASS                  |
| Server model / local agent | Exact supplied endpoint, `openai`, exact wire model                                     | Structural mapping PASS; real connection/authentication NOT RUN               |
| Moonshot API / local agent | Unchanged `https://api.moonshot.ai/v1`, `kimi`, exact wire model                        | Structural mapping PASS; API authentication NOT RUN; no managed-account login |
| Any remote agent           | `unsupported-runtime-location`                                                          | PASS; no local launch pretending to be remote                                 |

Missing endpoint/model/package path, exact-model context/capability metadata or
explicit endpoint-bound credential material returns incomplete configuration.
`auth:none` remains an explicit unsupported readiness requirement; it is never
silently converted to a credentialed route. No account or environment credential
discovery is performed. TOML receives only the designated `api_key_env` reference,
never supplied secret material. No credential UI or renderer exposure was added.

Fixture-only facts are model `threadlight-scripted-model`, context size 32768 and
`tool_use`. They are deliberately declared synthetic data, restricted to that local
model, never defaults for arbitrary real models. Operator-supplied facts must match
the exact model. The only fixture credential is an explicitly synthetic non-secret
value passed to the isolated child and bound to the owned server endpoint.

Contract sources: the pinned [configuration documentation](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/configuration/config-files.md),
[provider documentation](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/configuration/providers.md)
and inspected packaged schema/readiness/tool implementation. Current retry control
is `max_attempts_per_step=1`; deprecated `max_retries_per_step` is not emitted.
The translation also sets four steps per turn, manual permission, Write-only tools,
one task, no keep-alive/automatic backgrounding, no telemetry/title generation,
empty hooks/extra discovery paths, and disabled merged/built-in product skills.
These are conservative isolated-proof controls, not production execution admission.

### Actual runtime result: PASS for the four declared scenarios

The retained unmodified 2.4.1 package and lock were checked again, without installation
or upgrade. Entry SHA-256:
`fd15d5c9b48892bb4f1d5fe82df9f790c8c19a44ca9a81054cc592b6fb9e2c90`.
Lock SHA-256:
`7dfee229a1b8d354de84fd58af1f4eb39a197d396b0fba8fc631d358fbd035c8`.
ACP initialization reported 2.4.1. Absolute Node 22.23.4 and entry paths, literal
`acp` argument, `shell:false` and the existing owned Windows process job were used.
Normal configured-provider readiness succeeded; no `disableAuth`, package patch,
fake ACP peer or substituted internal requester was used.

The server was created by this operation on `127.0.0.1` with an ephemeral port.
Only POST `/v1/chat/completions` is accepted. It validates the model, streaming flag,
synthetic bearer shape and scenario transitions, bounds bodies/requests/lifetime,
and records synthetic requests without Authorization headers. The operation accepts
only runtime/run paths, not an arbitrary model endpoint or authentication override.
Imports are inert; the actual runtime is opt-in via the `scripted` CLI operation.

| Scenario | HTTP requests | Actual observation                                                                                                                                 |
| -------- | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream   |             1 | Scripted SSE text updates; ACP `end_turn`                                                                                                          |
| Approve  |             2 | Runtime advertised `Write` with `path`/`content`; expected one-shot permission allowed; actual file created; ACP `end_turn`                        |
| Deny     |             2 | Separate expected Write denied once; intended file absent; scripted terminal follow-up; ACP `end_turn`                                             |
| Cancel   |             1 | Held SSE response, explicit ACP cancellation, ACP `cancelled`; response closed without normal finish by process settlement, before fixture cleanup |

The workspace was newly created, so neither target file existed beforehand.
Approved content matched exactly; its SHA-256 was
`9e4c2f2a92dbd8f117e7aac728c2bff7c41c463a18c39a7a507b710ba956145a`.
`deny.txt` remained absent. Exactly two expected permission requests were observed.
Cleanup reported `owned_processes_settled`, exit code 0, then zero fixture sockets.
This is foreground cancellation evidence only, not task-wide Stop or proof of
background/subagent/remote settlement. No assertion of immediate TCP abort timing
is made: the socket snapshot is taken after process settlement.

Aggregate use: **4 prompts, 6 HTTP requests, 5776 ms**. Limits: 8 prompts, 24
requests, ten minutes, one active operation, no subagents/background scenarios.
A durable budget and exclusive lease span runs; uncertain delivery is reserved
before each prompt and prevents automatic replay until a terminal receipt. The
successful run ended with `uncertain:false`. No additional run was needed.

Fresh probe-owned state, workspace and child-only home/profile/app-data directories
exclude existing account, hook, skill and MCP discovery; an empty MCP file and a
workspace root marker were supplied. Parent credential/redirection variables are
not inherited. One explicit provider/model and its endpoint-bound synthetic key
prevent configured external model/account fallback; no fallback was observed.
Ancillary outbound traffic was not captured at OS level, so this does **not** prove
zero outbound network activity. No real model, account, paid usage or weights were
used. No synthetic usage is presented as real token/cost measurement.

Raw evidence remains outside Git under `<proof-root>/phase2b/run-01/report.json`,
with disposable synthetic state retained for inspection. Config SHA-256:
`bfa5ea98af77d502101e4e9d96abe846cb20cab7c8f0ec6eac8fa3c314de4047`.
The report binds mapper/probe/fixture/shared-schema source hashes; final local audit
confirmed those exercised sources remain byte-identical.

### Actual Electron roundtrip: PASS, isolated scope

The opt-in `node test/ui/kimi-settings.smoke.mjs --electron` builds the actual
preload and KimiSettings renderer with the extracted current main settings/inspection
handlers and actual update/apply functions. Actual Electron IPC reaches the actual
SettingsStore in temporary app data. The representative local draft saved to disk,
the main store reloaded that disk file, a renderer reload returned the saved model,
and explicit inspection verified the retained local package. No model call occurred.

Unrelated app lifecycle effects are inert in this harness; full regular application
startup and all Settings routes are not claimed by this check. Sender/frame guards
remain in the extracted inspection handler. Renderer HTTP(S) requests are blocked.
The normal app was not restarted or rebuilt in place.

Initial harness attempts failed because Vite's SSR output filename differed from
the launch path and then because `zod` remained external to the temporary folder.
Both produced visible Electron error dialogs. Explicit output names, bundled app
dependencies and pre-launch import validation corrected those defects. A hidden
window screenshot wait then timed out; native capture with unthrottled rendering
corrected it. Failure evidence is retained alongside the passing result outside Git.
The final candidate screenshot visibly shows Saved and Version verified.

### Verification hierarchy and remaining gates

- **Static PASS:** scoped syntax, ESLint, formatting, exact alias/provider/model
  mapping tests, strict focused TypeScript and final diff review. No dependency change.
- **Runtime PASS:** actual pinned Kimi/HTTP/ACP and owned cleanup above; actual
  isolated Electron save/reload/inspection. Full main/preload/renderer production
  build passes in the independent candidate archive, without changing regular `out/`.
- **Behavior PASS:** 62/62 focused tests (31 probe and 31 setup) in the isolated
  HEAD-plus-owned-files candidate, plus the four real-runtime scenarios and Electron
  roundtrip. Fake ACP cases remain a separate category; ordinary tests never launch
  the actual Kimi package. Working-tree tests also passed 62/62 before final alias
  assertion strengthening. Phase 2A's historical 48/46 count distinction is unchanged.
- **Contract PASS:** all 160 unrelated dirty files remain byte-identical to the
  captured baseline. Nine owned paths were initially clean/new. Candidate uses a
  Git archive, not another worktree; it excludes unfinished Perplexity/workflow hunks.
  No provider admission, regular app restart, account use, paid service or download.
- **Real model/provider NOT RUN:** actual local/server service compatibility and
  Moonshot API authentication; model quality, tool behavior and usage remain unknown.
- **Execution admission BLOCKED:** task-wide Stop, background/subagent settlement,
  actual restoration/continuation guarantees and remote termination remain open.

The six historical unrelated audio type errors were not repaired or rechecked with
a broad suite. No push, PR, merge or release is authorized. Next: select one actual
endpoint and its exact model/auth/metadata, extend the isolated live-route proof,
and authorize operational bounds and any applicable paid allowance. No account is
needed for this completed scripted proof. Production execution stays disabled.

Focused commands (paths supplied explicitly in the local harness environment):

```text
node --check test/live/kimi-acp.proof.mjs
node --check test/fixtures/fake-kimi-model-server.mjs
node --check test/ui/kimi-settings.smoke.mjs
node node_modules/eslint/bin/eslint.js <six changed code/test paths>
node node_modules/prettier/bin/prettier.cjs --check <six changed code/test paths>
node node_modules/typescript/bin/tsc --project <phase2b>/snapshot-tsconfig.json
npm run test -- test/kimiAcpProbe.test.ts test/kimiSetup.test.ts
node test/live/kimi-acp.proof.mjs scripted <absolute retained runtime> <fresh owned run>
node test/ui/kimi-settings.smoke.mjs --electron
npm run build
git diff --check -- <nine owned paths>
git diff --cached --check
```

The runtime command ran once against the primary mapper sources. Tests, Electron
and build also ran in the independent candidate archive; type checking targets that
candidate. Electron uses explicitly supplied existing Playwright and pinned package
paths; screenshots/results go to an external output folder. No dependency install
is part of these commands. The final checkpoint reply supplies the resulting commit.

## Settings/workspace workflow — Stage 1 checkpoint (4 November 2026)

PASS: the actual SettingsView is open in a separate native Electron review window.
Opt in with `node test/ui/kimi-settings.smoke.mjs --electron --review`, supplying
existing Playwright, pinned package, output paths and `THREADLIGHT_PREVIEW_REVISION`.
Close the owned window normally to retire that preview and remove its temporary
profile. The review remains available while subsequent authorized work proceeds.

Started at `d30fc552d4ba1822f6f6550f2c70427aa620eced`, main, empty index. Exact scope:
`test/ui/kimi-settings.smoke.mjs`, this validation/progress record pair and
`updatedifflog.md`. The candidate is a Git archive of HEAD plus those owned files,
not a worktree. Current tested Settings/Kimi components and actual preload/main
handlers/SettingsStore are used; unfinished Perplexity/layout hunks are excluded.
No production UI change was needed, so no README/changelog addition in this stage.

Static PASS: syntax, ESLint, Prettier, reviewed scope and diff. Runtime PASS: actual
Electron builds main/preload/Settings renderer in a unique temporary output folder.
No regular output, watcher, single-instance lock or application profile is reused.
Only get/update Kimi settings and metadata-inspection handlers are registered;
unrelated lifecycle effects are inert, other controls inactive, non-Kimi patches
rejected and renderer HTTP(S) blocked. This is profile/process separation, not OS
isolation. The existing Kimi entry hash still matches the pinned 2.4.1 artifact.

Behavior PASS: actual save, disk reload, renderer reload and verified local package
inspection; all three connection choices and separate remote-agent draft inspected.
Remote selection has no local inspection action. No model request or authentication
occurred. Screenshot reviewed in `outputs/kimi-review-stage1/native-settings.png`;
result JSON records base revision, main source hash, every built asset hash and
owned process/profile identity. Loaded label: `d30fc552 + Stage 1 review runner`.
Persistence and inspection are real; initial configuration is synthetic.

Contract PASS: all 160 freshly inventoried unrelated changed files byte-identical;
index initially empty, only four owned clean paths committed. Regular Electron
processes retained their original identities; live tasks were not stopped. Preview
alone is deliberately left open for review. No source ZIP, push, provider discovery,
paid inference, runtime upgrade, global system change or production execution.

Read contracts: AGENTS, CONTRIBUTING, UI-GUIDELINES, LOCAL-IPC, current Kimi records,
GUIDED-CHANGE-WORKFLOW-SPEC, THREAD-COMMUNICATION-SPEC and current Brainstorm operating
guide; inspected Settings/IPC, admission and owned-process sources. Current scoped
Brainstorm write/runtime authority is preserved. No diff-log helper was found.
Environment inventory found Windows 10 Pro, a stopped Ubuntu WSL2 distribution and
a Windows Sandbox executable; none yet establishes the required OS boundary.

Next: implement the account-free, simulated Kimi workspace through Settings, keeping
production execution disabled. No further permission is needed for that stage.

## Settings/workspace workflow — Stage 2 checkpoint (4 November 2026)

PASS: Settings → Kimi → Open workspace preview now opens a real renderer workspace.
Settings stays reachable and both the Settings draft and example instruction survive
navigation. A persistent Simulated activity label and disabled Run Kimi control keep
this separate from admitted execution. All task/session/project identities and file
contents are synthetic. No IPC, network, filesystem, enrollment or persistence API
is used by the workspace; only local React state changes. Current Brainstorm
permissions, production provider selection, task dispatch and admission are untouched.

Started at `728ba054eecff8ec416006ba7ce9c1da901f98d9`, main, empty index, fresh
160-file preservation inventory. Exact scope (13 paths):
`src/renderer/settings/SettingsView.tsx`, `src/renderer/settings/KimiSettings.tsx`,
new `src/renderer/kimi/KimiWorkspace.tsx`, `KimiWorkspace.module.css`, `preview.ts`,
new `test/kimiWorkspace.test.ts`, new `test/ui/kimi-workspace.check.mjs`,
`test/ui/kimi-settings.smoke.mjs`, `README.md`, `CHANGELOG.md`, the Kimi validation
and progress records, and `updatedifflog.md`.

The small Settings wrapper owns navigation; no Panel/IPC refactor. Reused Settings
controls, theme tokens, focus conventions, Tip and the existing StackedDiff component.
The preview fixture is separate from the view, in memory only; no parallel task,
verification, result or scheduler store was added. Examples display no real checks
as passed. Future real results must use existing versioned evidence infrastructure.

Static PASS: scoped lint/format/syntax and strict candidate TypeScript including
actual Settings caller. Runtime PASS: actual isolated Electron Settings/bridge/store
path and workspace renderer; independent full main/preload/renderer candidate build.
Behavior PASS: 35/35 focused settings/workspace tests. Electron exercised empty,
blocked, streaming, permission approval/denial, stop-requested, settled, uncertain,
explicit continuation, completed, failed and restored-history states. Restored
history remained paused; uncertain continuation stayed disabled; denial showed no
changed file. Changed content/diff and second-file selection worked. Navigation
preserved the example draft. Workspace interactions left the real temporary settings
file unchanged. The one initial ambiguous text locator was fixed in the test.

Native visual review at 1100 and 420px passed; the narrow file/result area is reachable
by scrolling and keyboard focus works. Evidence is in `outputs/kimi-review-stage2`,
including `workspace-review.png`, `workspace-narrow.png`, and the final-check narrow
files capture. Result JSON records state coverage; native result binds every asset,
source revision and owned preview process/profile. Loaded label: `728ba054 + Stage 2
workspace`. The owned review window remains available, with Settings navigation;
close it normally to remove its temporary profile. The earlier Settings-only review
was closed and its temporary profile removed. A separate final automated preview
closed successfully after the extended narrow-file check.

Contract PASS: 157 unrelated dirty files are byte-identical. Three deliberately
edited shared files (SettingsView, README, CHANGELOG) equal their captured contents
plus only declared transformations; their old hunks are preserved. Candidate blobs
are made from committed HEAD plus those same edits, excluding all unrelated hunks.
No full-file unchanged-hash claim is made for those three files. The source build
uses a Git archive, not a new worktree. No dependency changes or regular output
replacement. Original regular Electron processes and active work were preserved.
README/changelog now describe only the available simulated workspace. No push,
account, paid call, model download or production Kimi execution.

Next: verify the existing Windows Sandbox boundary and run the scripted proof inside
it if viable. An enabled executable alone is not an isolation proof. Real API access,
live-provider acceptance remains pending; no paid operation is admitted.

## Settings/workspace workflow — Stage 3 checkpoint (4 November 2026)

Start: `bdb090b81b6b71ec9357dd9ae9869890bf17e371`, main, empty index.
Exact scope: `src/main/kimi/config.ts`, `test/kimiSetup.test.ts`,
`test/kimiAcpProbe.test.ts`, `test/live/kimi-acp.proof.mjs`,
`test/fixtures/fake-kimi-model-server.mjs`, this validation report,
`docs/specs/KIMI-INTEGRATION-PROGRESS.md`, `updatedifflog.md`; new
`test/live/kimi-sandbox.ps1`, `test/fixtures/kimi-sandbox-guest.ps1`,
`test/fixtures/kimi-api-fetch-guard.mjs`. The last path was added to the recorded
allowlist before editing for a fixed-route test guard, not a general proxy.
No new production capability: Stage 2 already updated README/CHANGELOG for the UI.

Static: isolated candidate is HEAD plus owned paths, excluding unrelated work.
Focused lint, format, syntax and strict TypeScript checks passed; initial final
candidate tests passed 72/72. After synthetic-only RPC diagnostics were added,
the probe suite passed 38/40 with two 5-second timeouts during VM startup (one
cleanup also reported EBUSY). Both affected tests passed a focused rerun after
guest retirement, with normal timeouts. No fixture processes remained. Stage 2's
full candidate production build is the UI build evidence; no full-suite claim.

Runtime: used the already-enabled Windows Sandbox on Windows 10 Pro 19045.
No feature installation, reboot, shared WSL shutdown or host firewall change.
Guest Windows 10 Enterprise/WDAGUtilityAccount, configured 2048 MiB, observed
2047 MiB; CPU allocation remains the facility default. Software graphics;
clipboard, audio, video and printer redirection disabled. Only curated read-only
input and fresh writable evidence are mapped. Evidence is an intentional host
artifact channel, not zero sharing. No checkout, home, provider profile, SSH
agent or general host command interface. Relevant Threadlight SettingsStore,
configuration and process helpers, probe, Kimi, endpoint and project run inside
the guest. ACP filesystem/terminal callbacks are not advertised. No hooks, MCP,
extra skills, automatic titles or telemetry. This is a probe-level integration,
not an Electron UI-to-Kimi execution proof.

Pinned Kimi 2.4.1 entry SHA-256:
`fd15d5c9b48892bb4f1d5fe82df9f790c8c19a44ca9a81054cc592b6fb9e2c90`.
Lock SHA-256: `7dfee229a1b8d354de84fd58af1f4eb39a197d396b0fba8fc631d358fbd035c8`.
Guest checked both. Existing Node, Koffi and Git Bash binaries were curated into
the temporary package, with no global installation. Payload v4 SHA-256:
`09301e9deaa12ddf7986c4e31659dd9f3894e3b5d6dd2803d9970d8ceeaa54ec`.
Payload source matches the candidate byte-for-byte. Initial preparations found
an omitted Koffi native dependency, then missing Git Bash at session creation.
The diagnostic receipt confirmed rejected RPC -32603. All three had zero model
prompts/requests; no uncertain inference was replayed. Their evidence is retained.

Behavior: offline-run-04 passed streaming, approved Write with exact expected
content/hash, denied Write with absent target, foreground `cancelled`, owned
process settlement and zero endpoint sockets: four prompts/six scripted requests.
The Kimi wire rehearsal passed one request, no tools, actual
`max_completion_tokens=4096`, 8,835 request bytes, no guard rejection. Total five
prompts/seven scripted requests, no uncertainty. Model was
`threadlight-scripted-model`; guest endpoints `http://127.0.0.1:49674/v1` and
`http://127.0.0.1:49677/v1`. These are synthetic responses from the real runtime.

Offline boundary: no adapter; external TCP failed; synthetic host-only file and
process invisible; read-only input write refused. Host file/input hashes stayed
unchanged and host sentinel process stayed alive until owned cleanup. Guest
reported zero remaining owned Node processes and retired; launcher exited 0.
These probes are evidence, not an absolute escape guarantee. Guest shutdown
watchdog is 12 minutes, host retirement deadline 15 minutes. Cleanup never stops
shared Hyper-V/WSL services. No generated executable runs from the evidence map.

API preparation: fixed `https://api.moonshot.ai/v1`, `kimi-k3.1-pro`, Kimi protocol,
explicit 1,048,576 context metadata and always-thinking capability. Mapper now
honors always-thinking metadata and optional validated 1..4096 output limit.
Pinned requester uses SDK maxRetries=0; one attempt/step, one step, no tools,
titles/telemetry/hooks/MCP. Test-only fetch guard validates fixed HTTPS route,
model, streaming, output cap, no tools, <=32,768 request bytes, and durably
reserves one request before transport. Redirects and further requests are refused,
including after uncertain delivery. One session, one prompt, ten-minute deadline.
The four-operation live batch is deferred; this smaller first compatibility test
avoids building a multi-operation billing/transport platform.

`moonshot-single` and launcher Live mode are prepared, not executed. They require
current explicit numerical authorization, a passed guest network check, and a
dedicated key entered with a hidden secure prompt inside the disposable guest.
It becomes child-process environment material, never ordinary settings, arguments,
fixtures or evidence. Clipboard remains disabled; enter the key manually. No
managed-account login. Revoke the dedicated key after testing; never send it in
chat. No real credential or authorization record was created here.

The rehearsal tests the pinned wire encoder against the owned fixture, not
Moonshot authentication. Current K3.1 documentation uses `reasoning_effort`
(default max); the pinned Kimi trait emits nested thinking enabled. No low-effort
mapping is claimed. Real service acceptance and reasoning/answer streaming are
unverified. Live evidence will include operation, requested model, source/runtime
hashes, request receipt, terminal outcome, ACP updates including any reported
usage, unchanged project entries, and cleanup. Provider billing and remote
request settlement are separate from local cancellation and guest shutdown.

Pricing checked 4 November 2026: input $2/MTok, output $10/MTok, cached input
$0.20/MTok, cache writes $2/MTok (5m) or $4/MTok (1h). Numeric table verified in
the public page's embedded component data. Conservative estimate: 35,000 input
tokens (margin above byte-bounded input), full input plus higher cache-write rate,
and 4,096 output tokens = $0.25096 before tax; rounded planning figure $0.30.
This is an estimate, not a tokenizer guarantee or exact monetary cutoff. Public
minimum funding is $1; taxes depend on checkout jurisdiction. Account-specific
checkout is unavailable without an account. Proposed allowance: $1 before tax,
funded by the user, no automatic recharge. No purchase is authorized yet.

Sources: [Windows Sandbox configuration](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file),
[K3.1 guide](https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart),
[pricing](https://platform.kimi.ai/docs/pricing/chat),
[minimum funding](https://platform.kimi.ai/docs/pricing/limits),
[API key console](https://platform.kimi.ai/console/api-keys).

Contract: original six Electron processes retained their start times. No ordinary
app restart, output replacement, worktree, push, PR, purchase, paid inference,
model download or production enablement. Stage 1/2 review windows were closed
normally and temporary profiles removed; both previews can be reopened with the
supplied isolated launcher. Its source matches Stage 2 commit bdb090b8.
Production Kimi remains disabled. Background/subagent settlement, task-wide Stop,
remote inference termination, provider billing, real authentication/compatibility
and full application startup remain unproved.

Online preparation PASS (online-preflight-04): a fresh guest booted with networking
and no provider/credential present; it first confirmed ordinary external access.
Then guest-only firewall defaults became inbound/outbound Block, explicit address
ranges denied every other IPv4 destination, non-TLS API ports/UDP/ICMP were denied,
and IPv6 binding was disabled. These explicit denies override regenerated Windows
packaged-app allow exceptions, which are listed in the receipt rather than hidden.
Allowed addresses were the current public API DNS results 104.18.28.136 and
104.18.29.136, TCP 443. A hosts entry avoids opening DNS egress. Effective policy was
read back; TCP to 1.1.1.1:443 and the host gateway 172.20.144.1:443 failed. A keyless
HTTPS GET to https://api.moonshot.ai/v1/models returned 401. No inference endpoint
was contacted. This is an address restriction plus the separately tested fixed-URL
Kimi fetch guard, not a claim that a shared CDN IP uniquely identifies a domain.
The boundary receipt labels its initial connectivity observation as BEFORE policy.
Every future Live launch repeats these checks before accepting a key. Earlier
preflight attempts stopped on a rejected rule prefix, regenerated allow exceptions,
and a PowerShell parameter-set mismatch. All were unpaid and retired normally.

Preservation: at this observation, 150 of the 160 baseline unrelated files remain byte-identical.
10 advanced concurrently; none was edited or staged by this work:

- `CHANGELOG.md`
- `README.md`
- `src/main/perplexity/service.ts`
- `src/renderer/panel/Panel.tsx`
- `src/renderer/settings/PerplexitySettings.module.css`
- `src/renderer/settings/PerplexitySettings.tsx`
- `src/shared/ipc.ts`
- `test/live/perplexity-computer.proof.cjs`
- `test/perplexity.test.ts`
- `test/ui/providers.smoke.mjs`

Their latest hashes are retained separately; do not overwrite them with baseline
copies. The empty index and exact scoped candidate were rechecked before staging.
The evidence bundle contains final offline/online host and guest receipts, scripted
results, request guard observation and source/build identities. No paid call occurred.

Next gate: EVIDENCE_MISSING — API account/key provision and explicit numerical
usage authorization. The prepared first operation is one no-tool prompt, not the
four-operation batch. Ask only after this checkpoint for a dedicated user-funded
API account and proposed $1 allowance before tax; estimated usage below $0.30,
subject to the stated limits. No automatic recharge or uncertain replay. Production
Kimi execution remains disabled.

Final admission review tightened the authorization minimum from $0.25 to $0.30,
so it covers the rounded conservative estimate. The focused authorization check
passed (1/1); no runtime behavior or transport guard changed. Observed guest
evidence remains bound to payload v4. Prepared payload v5 includes only that
authorization predicate/test change, SHA-256 `79b2670c7912448f5e64e9d10b7d468252fbddafadc04abcb6da0cd90fb5cf67`; it was not submitted to a
provider. Reopened native preview passed and remains available, source bdb090b8,
with fresh evidence under `outputs/kimi-preview-reopened`. Close its window for
owned profile cleanup.

Concurrent preservation addendum: three newly observed unrelated paths were also
left untouched and excluded from staging: `docs/PERPLEXITY.md`,
`docs/validation/PERPLEXITY-2026-11-04.md`, `test/ui/perplexity.smoke.mjs`.
