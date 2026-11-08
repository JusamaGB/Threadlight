# Kimi provider and IDE integration: cumulative progress

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

## Objective, authority and checkpoint

Date: 4 November 2026. Input: user-supplied Master Seed for Astra, Revision 1.
Phase 0 establishes the local baseline and prepares a bounded Windows runtime proof.
This record is cumulative; retain earlier phase entries when adding later evidence.
The separate root `updatedifflog.md` describes only the latest cycle.

Phase 0 source/environment reconciliation is complete. Documentation validation and
the scoped commit are recorded below. Phase 1 is proposed, not authorized. No Kimi
implementation, dependency change, runtime installation, billable model task,
regular-app restart, Perplexity completion, push, PR, merge or deployment occurred.

Accepted design: independent Kimi provider and adapter, no Codex pipe dependency;
Threadlight owns project/task authority, UI and durable continuation; Kimi owns
its execution and native history. Reuse current enrollment, communication,
assignment, output-version, reviewer and recovery mechanisms. Preserve legacy
Claude/Codex identities. Unknown provider identities must fail closed. Native
session IDs remain opaque until verified. Foreground hosted Agent and per-task
coding execution remain distinct. Local runtime hosting does not imply local
model inference. Linux headless is later; macOS is deferred.

No architectural decision was changed. One material audit conflict was discovered:
current local Brainstorm supports bounded note writes and previously authorized
workflow operations. The seed's blanket read/propose description is no longer an
accurate description of the working tree. Preserve existing code and guards;
Phase 1 does not exercise or extend Brainstorm. Planning review should explicitly
reconcile this wording before Phase 2.

## Baseline and environment

- Repository: `https://github.com/JusamaGB/Threadlight.git`, verified origin.
- Checkout: `C:/dev/threadlight`, the primary checkout named by current AGENTS.
- Branch: `main`; starting HEAD: `08972786aea41d9a5906338e12f655439fc04ec7`.
- Audit: `602e1d2dc48ba0c1e2c07ad8d1b4bd6cfa4e7723`, confirmed ancestor.
  `git rev-list --count <audit>..HEAD` returned 21; committed delta is 263 files.
  No reset or checkout switch was used.
- One registered worktree. Existing state: 96 modified tracked files, 64 untracked
  files (160 individual paths); index empty. Directory-collapsed status had 154 rows.
  An in-session SHA-256 inventory covers all 160 pre-existing changed files.
- Important dirty areas: workflow engine/editor and Handoffs, Brainstorm/notes,
  enrollment and plugin bridges, local-change reconciliation, composer/voice,
  UI changes, dependencies, and Perplexity. These remain other work.
- Inspection and potential Kimi verification host: native Windows 10,
  build 19045, Win32NT. Inspection shell: PowerShell 7.6.5. Windows PowerShell
  5.1.19041.6456 is also installed and was queried without launching a task.
- Regular Threadlight: six Electron processes whose executable belongs to the
  primary checkout's installed Electron. The main process was observed running.
  Its exact loaded build/source revision was not established.
- Claude and Codex desktop/runtime processes also exist. A sanitized process
  inventory found no identified live-proof/UI-test process outside this inspection
  command; this does not establish that all hosted tasks are idle. No private
  transcripts or app databases were opened to infer task activity. Any future
  restart needs a fresh authoritative active-work check; none is authorized here.
- PATH Node: 22.23.4; Git: 2.49.0.windows.1; Git Bash executable exists at the
  standard Git for Windows location. Python 3.12 and Bun 1.4.4 were also observed
  but are not requirements for the proposed npm runtime route.
- No `kimi` command on PATH; no executable in the checked user-local bin,
  .kimi/bin, .kimi-code/bin, roaming npm shim or LocalAppData Programs/kimi
  locations. This is a bounded discovery result, not proof no copy exists anywhere.
  No Kimi process was found. No installed Kimi version, account access or effective
  model was verified. No credential store was read.
- Proposed harness launch is a Windows Node child process with literal arguments,
  `shell: false`, and an isolated cwd. Kimi's documented Windows tool shell is
  Git Bash; that differs from the PowerShell inspection/user-instruction shell.
  Actual ACP terminal routing and shell selection need runtime evidence.

## Contract Read Gate

Read current root AGENTS, its working diff and CLAUDE pointer, CONTRIBUTING,
relevant architecture/security sections of SPEC, task/identity/admission/recovery/
authority sections of THREAD-COMMUNICATION, PROJECT-PARTICIPANTS, enrollment and
handoff sections of SHARED-MEMORY-PLUGINS, authority sections of SHARED-SPACE-
KNOWLEDGE, THREAD-DIFF and superseding LOCAL-CHANGE-TRACKING section 24 plus the
local reconciliation amendment, GUIDED-CHANGE-WORKFLOW, AGENT-WORKFLOW,
WORKFLOW-BRAINSTORM-INTEGRATION, WORKFLOWS, BRAINSTORM-OPERATING-GUIDE, and the
relevant workflow/lifecycle/reconciliation validation records.

The governing working revisions are below; HEAD alone is insufficient for dirty
and untracked instructions. Historical validation counts were read as history,
not rerun or represented as current passes.

| Path                                                     | Repository revision                                  | Read working SHA-256                                               |
| -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `AGENTS.md`                                              | HEAD blob `d6f3fd6a2f587645f1b12f511d880bc9d45b1fdc` | `c7b71715e83d9070e1bb5972e9f21002e49837c355f124f2111d729a4f65f63c` |
| `CLAUDE.md`                                              | HEAD blob `ae0be3ce455b5d5d03989ecb9551698f71630127` | `e8829f983cb31b3691b34cd02658735acc657d3ede3a2046c868411493229f26` |
| `CONTRIBUTING.md`                                        | HEAD blob `c60868c7056cf533d82ad7525a4186ca3002db48` | `478c4f9519b3304c7eef80ee9b11819707edeb0f0f5ca140fb841a535f33a9e1` |
| `docs/specs/SPEC.md`                                     | HEAD blob `1be7ce7fd9b035274ef38a79694a3e704fef6230` | `5be78b703940efa085e19c50f4552ecaab132bc36eeedf78ce4e5ba5c550d9d4` |
| `docs/specs/THREAD-COMMUNICATION-SPEC.md`                | HEAD blob `4cebe9b8ef8c6d19d0310c60aaa19f91f780f32e` | `fde96b367cdce081991ce7febfd6bdb52d55e07ae8d9f4155f761ede386f18e2` |
| `docs/specs/PROJECT-PARTICIPANTS-SPEC.md`                | HEAD blob `4e666997a36d434c3ab7de65f1f0f88ead1119d1` | `4df360b6e07ba890582695129ec5baf91a673f459fc92dce8676959aa8007d77` |
| `docs/specs/SHARED-MEMORY-PLUGINS-SPEC.md`               | HEAD blob `9b01596fa68cf016fb9344c2481f283b7a44878d` | `838a461f3bae9733c6d98b2f16bd5cefc9edf8a88112ab70b1b5ef55310927a2` |
| `docs/specs/SHARED-SPACE-KNOWLEDGE-SPEC.md`              | HEAD blob `73ec5f7d32dab3fb2612152a0d90c28d99020cba` | `71da23487a35886f75cb647909e29edc50b7b88449b1d71c32765771bd4ca940` |
| `docs/specs/THREAD-DIFF-SPEC.md`                         | HEAD blob `2a90e8adea102213a214d140194acb8efec3a888` | `7a8285224cd952c036278899d0f35422066f030f84357b82c0b2a836e2085a4f` |
| `docs/specs/LOCAL-CHANGE-TRACKING-SPEC.md`               | HEAD blob `50f1860a7eb3850fdea2ab3d274ea23cd4654dbb` | `2b39945ee450ae0765013ca62e811cf9d1eebec8f27e14b661ea48494d1130c1` |
| `docs/specs/GUIDED-CHANGE-WORKFLOW-SPEC.md`              | HEAD blob `c8c72d73bf3aeb98238cf72ae74be9f406442838` | `b6bde6b9135a863c9504b02b8e96f7a470cd6ea75bfbe2f6f0308274a5db5936` |
| `docs/specs/AGENT-WORKFLOW-SPEC.md`                      | Untracked local record                               | `6cfe562123ea9e88939f6a6b6d717b295fa8e0370f77484a73b8d1fc8b7a431d` |
| `docs/specs/WORKFLOW-BRAINSTORM-INTEGRATION.md`          | Untracked local record                               | `947dc4b46174a3dad3e82aa50f9f9b2adedfb5e374e25c618920e43ca3f1ea54` |
| `docs/WORKFLOWS.md`                                      | Untracked local record                               | `10886cd37f4eb9f344a51907a12f0ca2327c546a79427086fcbba162e0f3c666` |
| `docs/BRAINSTORM-OPERATING-GUIDE.md`                     | Untracked local record                               | `e5f03110edf6963dda48ec8a3227d282b4467fea616f9b7f0280106bc6809036` |
| `docs/validation/AGENT-WORKFLOW-VALIDATION.md`           | Untracked local record                               | `1313b666b69ac43451d0ce019e3aaf54c7a51b9b02e250777bcf0452c09f80a0` |
| `docs/validation/WORKSPACE-RECONCILIATION-2026-10-29.md` | HEAD blob `baa92dcc47558a020829cfbce602975667e06972` | `48cdb41c1013a13de55b3332c956ce550db0d9632d8123c81a289eaed8569e4a` |
| `docs/validation/AGENT-PROCESS-LIFECYCLE.md`             | HEAD blob `2542716bafd00700e393978a6ebcf833894a1d0f` | `9765056d59138eb84f39d1658bbbd81432620931d9dbcad1ccbaaca27465fff4` |

No ancestor AGENTS was found at the drive root or General directory. The repository
instruction-file search found only root AGENTS; no subordinate AGENTS,
theexecutor.md, othello_directive.md, existing Kimi progress record, cycle log or
diff-log PowerShell helper was found in the source/documentation/script scope.
The two discovered PowerShell scripts are the app launcher and a Codex auth probe,
not diff-log helpers. Optional absences do not block Phase 0.

Current restrictions: primary checkout only, no extra worktree, preserve shared
dependencies and unfinished work, isolate UI tests, focused preflight, typed
main/preload/renderer access, no private transcripts or credentials in Git, and
no shipped-feature claims from specifications. AGENTS has an uncommitted UI-guideline
addition; no UI is changed here. Its existing documentation rules do not require
a changelog/README update for this planning-only cycle.

The hosted workflow contract's historical implementation permission is not new
authorization for this assignment. The guided-change service's new-branch rule
describes that product feature; this assignment explicitly permits a scoped local
documentation commit in the existing checkout.

## Source reconciliation and implementation map

Statuses classify inspected source, not end-to-end runtime acceptance.

| Requirement                       | Classification                                                                    | Actual source/call path and consequence                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider identity/routing         | Existing, requiring extension                                                     | `src/shared/types.ts:Provider`; `src/shared/providers.ts:PROVIDERS, providerName, sessionProvider, workspaceFolder`. Unknown non-Codex IDs currently fall back to Claude; non-Claude names fall back to Codex. Replace only actual two-provider assumptions and preserve old IDs.                                                                                        |
| Settings and persisted enums      | Existing, requiring extension                                                     | `src/shared/settings.ts:settingsSchema` provider enums/migration; `src/shared/spaces.ts`; `src/main/memory/connections.ts`; `src/main/agent/threadEvidenceStore.ts`. Keep worker provider enablement separate from foreground Agent provider.                                                                                                                            |
| Discovery/history/timeline        | Existing, requiring extension                                                     | `ProviderSnapshots` initializes Claude/Codex; `src/main/index.ts` registers their readers; `registerThreadTimeline` calls ClaudeReadAdapter/CodexReadAdapter and restricts thread IDs with a UUID-shaped regex. No Kimi discovery/history adapter found.                                                                                                                 |
| Session/workspace identity        | Existing, requiring extension                                                     | `CommunicationCatalog.find` uses provider-qualified Codex IDs and bare Claude IDs; enrollment `chatId` uses UUID schemas; `projectParticipants` infers provider from prefixes. Add explicit provider/native-ID mapping without coercing Kimi IDs to UUIDs.                                                                                                               |
| Project ownership/visibility      | Existing, applicable; Kimi extension needed                                       | `projectParticipants`, `MemoryView`, `CommunicationView`, local `HandoffsCanvas` and `ProcessRunDetails` show grants, assignees, states, pinned inputs/outputs and run evidence. Enrollment is not runtime admission.                                                                                                                                                    |
| IPC/permissions                   | Existing, requiring extension                                                     | `src/shared/ipc.ts` → `src/preload/index.ts` → main-process handlers with sender/frame checks. Native requests use `OwnedRequests`, holds and `CommunicationService`. Kimi permission callbacks need session/turn/generation correlation; never replay approvals.                                                                                                        |
| Dispatch/admission                | Existing, requiring extension                                                     | `index.ts` constructs `CommunicationCatalog`; `startMemory` builds `CommunicationService`; `tick/schedule` enforce policy, accepted dependencies, input revisions, model, resources and destination readiness. `codexCommunicationAdmitted` pins one tested binary SHA; Claude runtime inbox has its own route. Kimi requires its own installed-runtime ownership proof. |
| Submission/reviewer acceptance    | Existing, applicable                                                              | `CommunicationService.execute('submit_assignment_result')` pins assigned-folder output revisions; `accept_assignment` checks human/configured reviewer. `MemoryStore` supplies versioned items. Provider turn completion is separate.                                                                                                                                    |
| Durable receipts/recovery         | Existing, applicable; task continuation extension needed                          | `CommunicationStore.operation` deduplicates actor/operation/digest transactionally; constructor makes interrupted deliveries unknown and queued deliveries held. `MemoryDispatcher` preserves uncertain outcomes. No Kimi objective/checkpoint/session continuation binding exists.                                                                                      |
| Workflow engine since audit       | Existing local, applicable with limits                                            | Untracked `src/main/workflows/engine.ts:ProcessEngine` and `storage.ts`, plus dirty communication wiring, journal nodes before effects and recover uncertain operations. `control_process` pause holds future work; cancel aborts directly owned script operations, retains issued assignments. This is not task-wide native cancellation.                               |
| Hosted Agent lifetime since audit | Existing, requiring careful reuse                                                 | `AgentService.interrupt/resume`, `spawnOwnedProcess`, `windowsProcessJob`; committed `bc9fc84` added Windows job containment/retirement. Service resume restores a conversation; it does not submit the unfinished task objective. Whole owned-process shutdown is not a proved Kimi per-session pause.                                                                  |
| Selected-task Stop/Play           | Missing for Kimi                                                                  | Existing `MemoryView` pause/authorize, workflow run controls, Agent Stop and queued-message resume have distinct scopes. No Kimi settlement tracker, owned-child registry, continuation generation or task-level Stopping→Paused proof exists.                                                                                                                           |
| Diff attribution                  | Existing, requiring Kimi extension                                                | `ThreadChanges` uses `ClaudeDiffReplay/readCodexThreadDiff`; committed local changes service supplies immutable comparisons and partial coverage; local `ThreadReconciliation` adds bounded historical patch matching. Attribution is available recorded operations, not every write or exclusive authorship.                                                            |
| Checks bound to source            | Existing, requiring result integration                                            | `ChangeWorkflowService` prepares an immutable candidate Git tree, checks an exported tree and invalidates changed candidates; `runProjectCheck` and `WorkflowCheck` retain result/output. Workflow scripts retain cwd/args/exitCode/stdout/stderr. Connect these artifacts to pinned assignment results rather than rebuilding verification from prose.                  |
| Durable review evidence           | Existing, requiring extension                                                     | `ThreadEvidenceStore` is a bounded journal of thread-read evidence, not a general test-certificate store. Versioned result items and guided candidate records are better reuse points. Capture relevant untracked/uncommitted bytes and checks before mutable current-diff views change.                                                                                 |
| Brainstorm                        | Existing local; material audit conflict                                           | `spaceContext.ts:SPACE_TOOL_POLICY/BRAINSTORM_INSTRUCTIONS`, `SpaceContextService` and scoped Agent tools now expose note-write, draft-write and authorized-runtime operations. Human authorization/reconciliation are absent from hosted tool inventory, and arbitrary shell stays disabled. Preserve these current bounds pending planning review.                     |
| IDE surface                       | Existing, requiring extension; general editor/terminal missing in inspected scope | Thread navigation, conversation, diffs, file-open links, guided candidate review, previews and workflow graph exist. No general source editor, arbitrary project file navigator or interactive terminal integration was found in renderer/IPC/dependencies. Composer textareas and script-output views are not those features. Scope later UI against these surfaces.    |

Relevant committed additions since audit include guided candidate validation/local
review, local change recording/comparisons, IPC security and hosted process ownership.
Working-tree changes add workflow execution, scoped Brainstorm operations, Handoffs,
automatic change reconciliation and Perplexity. None is inferred to be running
merely because it exists on disk.

## Kimi and Perplexity findings

Kimi: no implementation or progress document found in tracked/current source,
tests, scripts, package metadata and documentation; no Kimi-named source paths.
Git HEAD tree search likewise found none. Ignored dependencies, backups, private
runtime storage and unrelated repositories were not exhaustively searched.

Perplexity: substantial unfinished local implementation, absent from HEAD and the
audit. Six untracked main modules under `src/main/perplexity/` implement
`PerplexityService`, encrypted `PerplexityVault`, OAuth/MCP `PerplexityComputer`,
desktop discovery and verified Windows pipe identity. Untracked
`src/shared/perplexity.ts`, `PerplexitySettings.tsx/.module.css`,
`test/perplexity.test.ts` and `test/live/perplexity-computer.proof.cjs` accompany
dirty main registration, preload, shared IPC and SettingsView wiring.

Source behavior: read-only desktop discovery uses only status/snapshot RPC and
currently admits desktop version 26.10.3; a separate OAuth connection supports
Computer send/read/cancel with discovered tools. It records mutation identity
before network I/O, retains uncertain sends, refuses blind replay and requires
explicit reconciliation. Settings marks it Preview. It does not add Perplexity to
the shared Claude/Codex Provider union or project workflow participant adapters.

No live Perplexity behavior is newly verified. No dedicated completed validation
record or Kimi/Perplexity changelog/README entry was found in the searched docs.
Next concrete continuation, outside this assignment: its owner should review
the untracked implementation with its dirty wiring, run
`npm run test -- test/perplexity.test.ts`, focused lint/typechecks, then
inspect the explicit live proof and authorization needed for account sign-in
and its optional billable send; finish preview/limitations documentation.
Do not run that live proof casually: it uses production encrypted storage.

Shared collision points for later Kimi work are `src/main/index.ts`,
`src/shared/ipc.ts`, `src/preload/index.ts`, `SettingsView.tsx` and dependencies.
Re-read and merge only scoped changes. The Perplexity desktop pipe is specific
to Perplexity; it is not the Kimi transport.

### Working-source evidence stamps

These hashes identify important unpublished source as read. They do not replace
the preserved working files or imply a runnable clean checkout.

| Path                                        | Working SHA-256                                                    |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `src/main/communication/service.ts`         | `0cea186a09ace3dc233a7d8d3d62bd8a8fb26d1a2b1a94d2c52537f07b83d913` |
| `src/main/memory/connections.ts`            | `dd74e1ee448fd07fd5631de69391f41326fd90296964d547c4faf6d4d721c3ef` |
| `src/main/spaces/context.ts`                | `23c76957a3b7ad37471cdcc2d3ca141fd9bc3f04e779f8318937328a01da6de8` |
| `src/shared/spaceContext.ts`                | `5a790facc4f1fbbb48dc1d8bb44e8055fd3dd47ec53a8d8f2e7ca2174b7211b8` |
| `src/main/workflows/engine.ts`              | `c2b634446e81cb33c12bf8410902e9c481281356fdff325d091dfed79d7f6b93` |
| `src/main/sessions/threadChanges.ts`        | `de9a932999dd12e3efdd8560cc0017254a76580f9272f5f2d7dbb312503d856c` |
| `src/main/sessions/threadReconciliation.ts` | `ed9e32b1df158568f5df49b1a6f7c462d3aeb1eae8c54d4dcc6bcc03cb521c76` |
| `src/main/perplexity/service.ts`            | `92519b6787e07228a203c86b8566318ffba8852ba583b95ee3a8ba44a8885b88` |
| `src/main/perplexity/discovery.ts`          | `21542460e433d4a978a8e5e8769778903eca4018016a3875f96b10d3714a9c4b` |
| `src/main/perplexity/computer.ts`           | `905130f47c6aa4cb893e4fcd4981e541c872465bf5c9f539242e54fba4ee3741` |
| `src/main/perplexity/verifiedPipe.ts`       | `865f082fc37e3b1ef3d43caa474ccf7fdbf011635ff1291fc584a4e6054ae942` |
| `src/main/perplexity/vault.ts`              | `d6bb64f35ad2743ce1971e7e4bb104058818638dd2e07ee215f0182d38963272` |
| `src/main/perplexity/integration.ts`        | `e265fad859cc9b55dceb42a0fdd9c49f243cfceee35a599ec921fa6d400cfa7c` |
| `src/shared/perplexity.ts`                  | `db0726e0be0b89316c8506e051bf5226ef8b47a66f88355832c1a837a72ed58d` |
| `test/perplexity.test.ts`                   | `7633f30e9884b0b71802e91eb98e01fba7c416d5a23d7c7358d15d43616bf0f8` |
| `test/live/perplexity-computer.proof.cjs`   | `454b3b66a9ebc449ae3a5846db5940e9d4c539cbeec9538d09060af2ce4f1b48` |

## Proposed Phase 1: native Windows runtime proof

### Pin, dependencies and launch

Candidate: `@moonshot-ai/kimi-code@2.4.1`, source reference
`2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7`. The pinned app package declares
version 2.4.1 and Node >=22.19.0; PATH Node 22.23.4 meets that package requirement.
Building the monorepo instead requires Node >=24.15.0 and pnpm 10.33.0; do not
confuse build dependencies with the packaged runtime. No runtime is installed yet.

Recommended Phase 1 route: an isolated local npm installation under the approved
probe work directory, using the exact package version, retained lockfile and
registry integrity metadata. First verify published package provenance/source
correspondence to the pinned commit. The browser registry lookup failed, but a
read-only Windows registry metadata request succeeded: version 2.4.1, Node
`>=22.19.0`, no gitHead field, integrity
`sha512-z0py3AxbV9ykOB3Pgh2FiycZbMy7XSAXH4Kb1yfyhhmk+l9xH8H9raakVvCGMYLVxxEQGitQLcgOh8clLVYUTw==`.
No package was downloaded or executed. Source/package equivalence is therefore
still unestablished. If the published artifact cannot be tied to the audited source,
stop that step for review rather than silently substitute another release. The
official install script selects latest; do not execute it unpinned.

Launch the pinned package's `dist/main.mjs` with the absolute Node executable,
arguments `acp`, `shell: false`, hidden window and disposable workspace.
Record actual executable/package hashes, version, effective config and initialize
response. Do not change Threadlight dependencies, global PATH or the regular app.
Use Git for Windows Bash for native tool execution where the runtime chooses it;
record the actual shell. Also test advertised ACP terminal callbacks separately.
A synthetic callback implementation cannot prove runtime-native shell behavior.

Account: normal user-authorized Kimi Code OAuth or supported API access, sufficient
quota, and an effective model ID returned by actual runtime/account configuration.
Do not infer an ID from “Kimi K3 Pro”, print credentials, or use a different
account/provider silently. Network inference location must be recorded separately.

Proposed bound for approval: at most 12 foreground prompt calls, one concurrently
active background subagent, and 20 minutes of active live exercise. Choose/confirm
the account's spend ceiling before billable calls; stop at the first bound reached.
No unrestricted goal loop. An exhausted bound returns partial evidence, not a pass.

### Exact proposed write scope (not created in Phase 0)

| Path                                         | Status                 | Intended change and verification                                                                                                                                                                                         |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/live/kimi-acp.proof.mjs`               | New                    | Explicit opt-in stdio probe, runtime/version/account gates, redacted evidence, session/turn/permission/terminal ownership, deadlines and cleanup. Validate parsing/correlation with fake transport before any real task. |
| `test/fixtures/fake-kimi-acp.mjs`            | New                    | Deterministic protocol peer for malformed frames, delayed terminal settlement, duplicate/late events, permission races and connection loss. Never labelled Kimi runtime evidence.                                        |
| `test/kimiAcpProbe.test.ts`                  | New                    | Focused behavioral tests of the probe, including non-UUID session IDs, stale generations, no duplicate prompt, denied permissions and uncertain outcomes. No production adapter.                                         |
| `docs/validation/KIMI-ACP-WINDOWS-PHASE1.md` | New                    | Redacted capability/evidence matrix with native Windows runtime fingerprint, command/cwd/result/log references and gaps.                                                                                                 |
| `docs/specs/KIMI-INTEGRATION-PROGRESS.md`    | Existing after Phase 0 | Append Phase 1 decisions, commit and evidence; preserve this baseline.                                                                                                                                                   |
| `updatedifflog.md`                           | Existing after Phase 0 | Replace cycle entry after preserving significant findings in progress.                                                                                                                                                   |

No `src/`, plugin, package.json or package-lock.json edits are proposed for Phase 1.
If production changes or a runtime fork are needed, report the smallest separate
scope and stop for review.

Disposable probe artifacts, outside tracked source, are explicitly proposed as
`work/kimi-phase1/runtime/` (package lock, integrity and installed package),
`work/kimi-phase1/project/` (synthetic `calc.mjs`, `calc.test.mjs`,
`heartbeat.mjs`, Git baseline and scoped outputs), and
`work/kimi-phase1/evidence/` (manifest.json, redacted events.jsonl,
checks.json and process-settlement.json) beneath the execution chat's work directory.
These are not additional Threadlight worktrees. The probe must refuse the real
Threadlight checkout as its edit target. Raw tokens and private native history
must not enter the evidence or repository.

### Exercises and acceptance evidence

| Exercise                     | Required observable evidence                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch/initialize            | Windows OS/architecture, shell, exact package/source/executable fingerprints, command/cwd, agent version and negotiated capabilities. Unsupported methods fail explicitly.                                                                                             |
| Account/model/session        | Auth readiness without secrets, actual selected model/config options, opaque session ID and canonical fixture cwd; no model substitution.                                                                                                                              |
| Stream and permissions       | Ordered session/turn/tool IDs, streamed deltas, one allowed and one denied safe operation; denial produces no denied side effect. Pending approval across reconnect remains unresolved until the correct current flow answers.                                         |
| Controlled change/check      | Small synthetic edit, before/after content hashes and patch, actual test command/cwd/exit code/bounded output and checked source manifest. Source mutation after check invalidates its coverage.                                                                       |
| Foreground generation cancel | Timestamp cancel request separately from prompt terminal event; record terminal reason and late events. No “Paused” from acknowledgement alone.                                                                                                                        |
| Foreground command cancel    | Bounded heartbeat command, PID/owned descendants, exit/output settlement and post-cancel artifact observation. Keep Stopping/uncertain if evidence is incomplete.                                                                                                      |
| Background/subagent cancel   | One bounded child that remains active while foreground returns; record task/agent IDs, shell/process ownership and post-cancel side effects. Determine whether stock ACP observes and settles all owned activity. Test an unrelated disposable sentinel remains alive. |
| Restore versus continuation  | Save session ID; close probe connection/process only, relaunch pinned runtime, load with replay then resume without replay; demonstrate restoration causes no new prompt. Send exactly one explicit continuation and retain prior edits/objective.                     |
| Ownership and failure        | Two clients trying the same disposable native session, duplicate prompt/cancel, delayed events and disconnect; establish exclusive ownership or safe refusal. Lost receipt remains uncertain until authoritative reconciliation, never blind retry.                    |
| Recovery limits              | Verify process restart with pending approval/command and workspace changed while paused. Identify what stock session history recovers and what Threadlight must persist in Phase 3.                                                                                    |

Protocol-fixture results prove client handling only. Real-provider results require
the actual pinned Kimi runtime, verified account/model and native Windows commands.
This phase does not yet prove Threadlight UI Stop/Play, app restart recovery, Spaces
delivery or cross-agent acceptance; those remain later phases.

Acceptance: complete capability map with PASS/FAIL/NOT RUN/BLOCKED per exercise,
timestamped correlation and settlement evidence, preserved synthetic change/check
snapshot, source pin, explicit limitations and a recommendation on stock ACP.
If stock ACP cannot establish task-wide settlement, return the smallest supported
extension or enforced execution restriction with evidence. A prompt saying “avoid
background work” is insufficient. Windows job retirement is a candidate containment
mechanism for a separately owned process, not proof of remote cancellation,
per-session safety or retained continuation.

### Relevant existing checks and proposed execution order

Actual package scripts: `test` runs Vitest, `typecheck` runs Node and renderer
TypeScript, `lint` runs ESLint, `plugins:check` checks generated bridge assets,
`build` runs electron-vite, and `format:check` checks formatting.

Phase 1: first syntax/schema/allowlist checks and fake-protocol tests with
`npm run test -- test/kimiAcpProbe.test.ts`; focused lint/format on the new
probe/test/fixture; then approved real-runtime exercises; finish scoped diff
checks. Typecheck the added TS test through the repository command and distinguish
pre-existing errors. No app build is needed without app source changes.

Later affected-test map, not a request to run it now: providers/providerSnapshots/
settings, communication/communicationIntegration, memoryPlugins, spaces/spaceContext,
agentRun/agentCodex/ownedProcess, threadDiff/localChanges/threadReconciliation,
changeWorkflow/changeWorkflowChecks, workflowGraph/workflowIntegration.
Existing UI proof routing is documented in `test/ui/README.md`; use isolated
fixtures when later UI changes are authorized. Do not rerun broad suites for
these documentation-only records.

## Phase 0 verification and cycle record

### External pinned sources consulted

- [Kimi package manifest](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/apps/kimi-code/package.json): version and packaged Node requirement.
- [Monorepo manifest](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/package.json): source-build Node/pnpm requirements.
- [Windows installation guide](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/guides/getting-started.md): Git Bash and floating installer behavior.
- [ACP reference](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/reference/kimi-acp.md): stdio, session restoration, explicit prompts, permissions and terminal methods.
- [ACP session source](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/packages/acp-server/src/session.ts): cancel dispatch is asynchronous and distinct from terminal settlement.
- [Subagent source](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/packages/agent-core-v2/src/agent/tools/agent/agentTool.ts): background registration omits the foreground abort signal.

These are pinned source findings, not observations of an installed runtime.
The seed's separate persistent Goal feature remains outside the ACP proof scope;
no TUI Goal control is assumed to be a standard ACP method.

### Verification outcomes

Static: source paths/symbols and current contracts inspected; audit ancestry PASS;
dirty-state inventory PASS; optional-contract/helper discovery PASS; only two
documentation paths allowed.

Checks run in the primary checkout:

- PASS: `git merge-base --is-ancestor 602e1d2dc48ba0c1e2c07ad8d1b4bd6cfa4e7723 HEAD` (exit 0).
- PASS after scoped formatting: `node node_modules/prettier/bin/prettier.cjs --check docs/specs/KIMI-INTEGRATION-PROGRESS.md updatedifflog.md`.
- PASS: `git diff --cached --check`; staged names/stat/diff inspected, containing only these two new records.
- PASS: SHA-256 comparison of all 160 pre-existing dirty/untracked file paths against the pre-write inventory; no content differences. The original index was empty; only this assignment's two paths were staged.
- PASS: named contract/source references and future-file labels reviewed; source-only conclusions remain separate from runtime claims. Inspection caught and corrected a Markdown blockquote caused by an unquoted version constraint.

Before committing, repeat only the affected document checks and verify the same
starting HEAD and exact two-file staged scope. After committing, inspect commit
paths, empty index and preservation inventory. The final report records that result.

Runtime: environment/process/dependency metadata observed on native Windows.
Kimi launch, ACP negotiation, account/model and cancellation: NOT RUN, outside
Phase 0; executable/account evidence unavailable. Existing application build
identity and active task state remain uncertain.

Behavior: Kimi edit/check, Stop/Play, background settlement, duplicate events,
restart and cross-agent review NOT RUN. No historical document is a fresh pass.

Contract: only records may change; other staged/unstaged/untracked work must retain
its pre-write hashes. No runtime/install/send/restart/implementation authorization
was inferred. Brainstorm conflict is documented for later review, not “fixed”.

Historical workflow validation reports a Node typecheck issue around
`test/audioEnergy.test.ts`; it was not rerun here and is not asserted current.
No broad unit suite, build or UI proof is warranted for Phase 0.

### Completed phases and commits

- Phase 0: this record and the cycle log are the only permitted changes.
  The resulting commit is the commit introducing this file; retrieve it with
  `git log --diff-filter=A -1 --format=%H -- docs/specs/KIMI-INTEGRATION-PROGRESS.md`.
  The checkpoint report provides its concrete hash. No self-referential commit
  hash is embedded before the commit exists.
- Phases 1–5: not authorized or started.

### Next authorized work

None beyond Phase 0 final verification/commit/checkpoint. Recommended next instruction:
authorize the six-file Phase 1 probe/evidence scope, isolated pinned runtime
installation and bounded live exercises using a verified account/model with an
agreed spend ceiling. Preserve the running app and unrelated work. Return the
capability map and stop before provider integration.

## Phase 1A — accepted corrections and completed preparation

Date: 4 November 2026. This appended entry supersedes the earlier Phase 0
authorization/next-work statements while retaining them as checkpoint history.
Phase 0 was accepted as a reported planning checkpoint; its concrete commit is
`1dc0be85a35954089db2a6ce580c718bc4513cdc`, also Phase 1A's starting HEAD on `main`.
The reviewer had not independently inspected the unpushed checkout; this executor
revalidated it locally before editing. The index was empty, all four proposed new
files were absent, and the original 96 dirty tracked plus 64 untracked paths still
matched their preservation hashes. No reset, stash, cleanup or new worktree occurred.

### Accepted corrections

- Brainstorm's current bounded note writes, workflow drafts and already-authorized
  workflow operations supersede the seed's blanket read/propose-only description.
  Preserve these capabilities and guards. Before Phase 2, refresh the actual
  `SPACE_TOOL_POLICY`, SpaceContextService/server actor and workflow call-path map;
  do not extend or remove authority incidentally for Kimi.
- Guided verification already checks an immutable candidate tree. Future Kimi
  result evidence should connect to ChangeWorkflowService and existing verification
  records, not replace them because the older audit omitted the capability.
- Unfinished Perplexity implementation and its shared integration points remain a
  separate workstream and are preserved.
- Phase 1 is split: **1A** is probe/artifact/isolation/non-inference preparation;
  **1B** is separately authorized bounded live work after account, model and usage
  decisions. Completion of 1A does not prove live Stop/Play, permissions, background
  cancellation, ownership or restoration.

### Contract read gate and implemented scope

Read the previous cycle log and this cumulative record, current AGENTS and relevant
current workflow, Brainstorm authority, guided candidate verification, communication,
recovery and owned-process contracts before editing. Revalidated applicable
instruction discovery, package/test commands, available dependencies and file
ownership. The contract hashes in the Phase 0 table remain current. No applicable
PowerShell diff-log helper was found.

Implemented only the six authorized paths: `test/live/kimi-acp.proof.mjs`,
`test/fixtures/fake-kimi-acp.mjs`, `test/kimiAcpProbe.test.ts`,
`docs/validation/KIMI-ACP-WINDOWS-PHASE1.md`, this cumulative record and the overwritten
root `updatedifflog.md`. No production/dependency/shared wiring edits. No user-facing
feature changed, so CHANGELOG/README updates are neither needed nor within scope.

The opt-in probe imports inertly and accepts only version/help/initialize against
an explicit verified entry in a fresh isolated directory. Session/prompt/permission
exercise APIs are restricted to the fixed deterministic fake. Real prompting,
authentication and restoration have no exposed path. It reuses existing Windows
owned-process helpers unchanged, separates cancel dispatch/terminal result/exit/
cleanup/uncertainty, and never automatically replays unknown outcomes. NDJSON framing
was verified in the actual downloaded SDK implementation. Permissions remain tied
to a live fixture turn and expiring explicit selection; denial and revocation do
not become approval. Evidence avoids arbitrary provider text/credentials.

### Artifact, isolation and observed runtime

Exact package `@moonshot-ai/kimi-code@2.4.1` from `https://registry.npmjs.org`;
downloaded tarball bytes match declared SHA-512 SRI. Verified registry signatures
and provenance identify audited commit
`2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7`, repository and release workflow.
This establishes artifact/build provenance, not an independently reproduced build
or live proof of inspected source behavior. No floating substitution or source
rebuild was needed for absent `gitHead`.

Actual preparation root:
`C:/proof-work/kimi-phase1a`.
The private `runtime` directory contains the exact local installation and its own
lockfile; 35 installed package records and integrities are retained in
`evidence/dependencies.json`. Scripts and bin links were disabled; npm global mode
was explicitly false with empty dedicated config files and a dedicated cache.
No global PATH/shims, Node installation, account configuration or Threadlight
dependencies changed. Supported `KIMI_CODE_HOME` was verified in the downloaded
bundle; normal HOME/USERPROFILE remain intact and inherited credentials are excluded.
This is application state isolation, not an OS sandbox.

Actual non-inference runtime observation: absolute Windows Node v22.23.4 and exact
entry hash, literal arguments, `shell: false`, dedicated `project`/`state` per run.
Windows PowerShell 5.1 ran the supplied wrapper for version/help and initialize.
Version 2.4.1, protocol 1 and advertised capabilities were observed without login or
session creation; final runs exited 0 with owned job cleanup confirmed. The captured
initialize launcher/runtime PIDs were 19464/17988, recorded with parent/creation/
command identity; both exited. State directories contain no files. These are
metadata and process observations only, not live behavior acceptance.

The detailed validation report contains exact tarball SRI, entry/lock hashes,
provenance, install/run/check commands, evidence filenames, advertised capabilities,
test failures and the concrete Phase 1B procedure.

### Verification and remaining gate

- Static PASS: exact allowlist, syntax, scoped ESLint/Prettier, focused strict test
  typecheck and staged diff/whitespace inspection. No implicit real/live execution.
- Static FAIL, pre-existing: Node project typecheck reports six audio DOM-type/
  project-inclusion errors in `audioEnergy.ts` and its test. Evidence retained;
  no new probe-test diagnostics or out-of-scope fixes. Focused probe typecheck passes.
- Runtime PASS, fixture test: fake launch/shutdown and owned timeout cleanup with
  a surviving independent test-owned sentinel.
- Runtime PASS, actual non-inference runtime observation: verified local artifact,
  version/help/ACP initialization and Windows cleanup under PowerShell 5.1.
- Behavior PASS, fixture test: 14/14, including out-of-order responses, separate
  sessions, opaque IDs, interleaving/UTF-8, duplicate messages, explicit denial,
  expired/missing/unanswered approval, pending cancellation, lost connection without
  replay, malformed output, ownership cleanup, entry/state refusal and inert import.
- Behavior NOT RUN, actual live-provider observation: account/model, real tools,
  edits, foreground/background cancellation, restoration/continuation and admission.
- Contract PASS: original 160 changed files preserved, running app not restarted,
  Brainstorm/Perplexity untouched, zero real prompts/login/account changes and only
  six permitted files staged/committed. No push, PR, release or deployment.

Commands and evidence are in `docs/validation/KIMI-ACP-WINDOWS-PHASE1.md`. No broad
suite/build/UI run was warranted by these probe-only changes. The Phase 1A commit
is the commit introducing that report; the checkpoint response records its hash.

**Next gate:** stop after the Phase 1A commit/report. the maintainer must authorize the
account/access route, supported effective model and explicit spending/quota
allowance before Phase 1B. Proposed 12 foreground prompts and 20 minutes are
client-side operational bounds, not a spend cap or proof of remote cancellation.
Phase 1B needs a reviewed gated probe extension; the current probe cannot run live
tasks. Exercise streaming, approval/denial, edit/check, foreground cancellation,
background/subagent settlement with an independent sentinel, restoration plus
one explicit continuation, then disposable-session ownership/disconnect. Preserve
uncertain outcomes and enforce any required restriction in runtime, never merely
through a prompt. No Phase 2 production integration is authorized.

## 4 November 2026 — Phase 1B controls implemented; live assessment blocked

Starting HEAD `12856c8e04b6ed481fc5d0a790b4ba6f9ffb2a08`, branch `main`, empty
index. The six permitted paths were clean at entry. The original 160 unrelated
dirty paths remain preserved; no production/dependency/Perplexity edit.

The probe now has explicit prepare/login/discover/restore/prompt/continue operations,
an account/allowance decision gate, pinned artifact checks, sealed exercise/session
ownership, exclusive state leases and durable operation/count records. Restoration
never implicitly submits a continuation. Duplicate IDs do not resubmit; disconnect
uncertainty blocks admission and automatic replay. Exact declared one-shot approval
scope, denial, revocation, owned cleanup and aggregate count/time controls are tested.
The current real authentication route is account device-code login only. API keys
and compatible endpoints are proposed settings routes, not implemented probe routes.

Twenty-eight focused fixture tests pass. Source inspection/configuration, fixture
behavior and actual provider evidence remain separate. Windows PowerShell 5.1 ran
synthetic preparation and rejected unauthorized discovery before launching Kimi.
Actual artifact digest/provenance still binds the audited repository/commit; installed
entry and lock hashes match. No reinstall was needed. Focused syntax/lint/format/
strict TS and diff checks pass. The six pre-existing audio type errors are historical;
no broad check was repeated. Full evidence and capability rows are appended to
`docs/validation/KIMI-ACP-WINDOWS-PHASE1.md`.

After implementation and review, the maintainer clarified that no Kimi account/API/local
model/server access is established. He wants open-source users to choose local,
server or Moonshot API options in Settings. No access route or usage allowance was
authorized. No login, real session, inference, continuation or live tool ran. Model
and native session remain unset; actual prompts submitted: zero. Typed blockers:
ENVIRONMENT_LIMITATION (access), AMBIGUOUS_INTENT (route/allowance), and
EVIDENCE_MISSING (independently verified allowance enforcement).

The installed CLI is the agent runtime, not local model weights. Settings must
separate agent execution location from model endpoint. Official pinned provider/setup
documentation supports managed account/API and compatible endpoint configuration;
Moonshot separately documents self-hosted model serving. These are design routes,
not proven Threadlight compatibility or a hardware/allowance guarantee. Remote
agent hosting and remote termination remain outside this Windows proof.

Limits: at most 12 foreground prompts (continuations included), 20 minutes from the
first session operation, one probe owner/active operation and no uncertain replay.
An account-cap evidence reference gates inference, but cannot itself enforce billing.
Runtime configuration requests manual tool approval, denies subagents/web/cron and
bounds task/step behavior; actual enforcement remains untested. Background/subagent
exercise is blocked until enforceable aggregate scope is available. A local timeout
is not a spending cap.

Task-wide Stop is not established. Turn cancellation, command termination, background
and subagent settlement, process cleanup, restoration, continuation and native
concurrency remain separately labelled in validation. Fixture cleanup and Phase 1A
non-inference cleanup do not prove live settlement. Production admission stays closed.

Proposed first production slice: disabled-by-default non-secret profiles/readiness,
with local agent hosting initially and separately described managed-account,
Moonshot API and compatible local/server model endpoints. Exact files/symbols and
acceptance criteria are in validation: new shared Kimi types, runtime inspection
and settings UI; reuse settings, typed IPC/preload and admission guards. Do not enable
the Provider union/catalogue yet. Later execution must reuse owned processes,
OwnedRequests, uncertain-delivery records and immutable-candidate/versioned results.
Preserve Brainstorm authority. Existing settings/IPC/main/preload/UI files collide
with unfinished shared and Perplexity work; reconcile ownership before editing.

This checkpoint commits only the six permitted paths, overwrites the cycle log,
does not push and stops before production integration. Resume within Phase 1B when
access and allowance are established; no additional preparation phase is proposed.

## 4 November 2026 — Phase 2A non-executing Settings setup

### Authority, baseline and minimal change plan

the maintainer accepted the Phase 1B probe implementation on reported evidence, not an
independent inspection of the unpushed commit. Phase 1B live validation remains
BLOCKED, task-wide Stop unproved, and production execution unavailable. Phase 2A
authorizes configuration and local metadata inspection independently of account or
monetary allowance. It does not authorize login, endpoint calls or inference.

Starting revision `ab679d4b802bb5abfe10938c58a99ed3b1925412`, branch `main`, empty
index; 160 pre-existing dirty paths. Read current instructions, cycle/progress/
validation records, UI guideline, settings/main/preload/renderer source, local IPC
security and contribution/spec contracts. No subordinate AGENTS or applicable
diff-log helper. All five new Kimi code/test paths were absent.

Plan established before editing: one shared configuration schema and inspection
result; one settings field; one guarded typed inspection IPC method; a read-only
package inspector; a compact Kimi section mounted in Settings; focused persistence,
boundary and isolated UI tests. Existing SettingsStore already validates/persists
fields generically and is unchanged. No capability framework, profile manager,
provider union change or unused admission function. The minimum scope addition was
announced before editing: CHANGELOG and README entries required by current AGENTS
for this user-visible setup. No setup/plugin guide needs a change because this
slice introduces no runtime installation, credentials or provider execution.

### Exact implementation scope

New files:

- `src/shared/kimi.ts`: `kimiSetupSchema`, defaults, canonical observation binding,
  incomplete-draft predicate and `KimiRuntimeInspection`.
- `src/main/kimi/runtime.ts`: `inspectLocalRuntime`.
- `src/renderer/settings/KimiSettings.tsx`: configuration and inspection controls.
- `test/kimiSetup.test.ts`: schema, runtime and actual wiring-boundary checks.
- `test/ui/kimi-settings.smoke.mjs`: isolated component/full Settings view proof.

Task-owned insertions into pre-existing dirty shared files:

- `src/shared/settings.ts`: import and backward-compatible `kimiSetup` field.
- `src/shared/ipc.ts`: inspection types, channel and API method only.
- `src/main/index.ts`: inspector import and panel/main-frame guarded handler only.
- `src/preload/index.ts`: one inspection bridge method.
- `src/renderer/settings/SettingsView.tsx`: import and keyed section mount.
- `test/settings.test.ts`: import and two compatibility/patch-isolation cases.
- `CHANGELOG.md`, `README.md`: concise setup capability and limitation entries.

Records: append this file; overwrite `updatedifflog.md`. Total: 15 paths. The live
probe, Phase 1 validation report, dependency files, contracts, provider routing,
communication admission, Brainstorm and Perplexity implementation are unchanged.

### Configuration and truthful product behavior

One selected configuration, with independent connection and agent-location unions:

| Model route  | Stored configuration                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local model  | Loopback HTTP(S) endpoint, exact user model ID, OpenAI Chat Completions protocol, intended no-auth or externally supplied API-key mode.          |
| Server model | HTTP(S) endpoint, exact user model ID, same deliberately limited compatible protocol/auth choices.                                               |
| Moonshot API | Exact user model ID, `kimi` protocol and external API-key mode; fixed platform endpoint `https://api.moonshot.ai/v1`, not managed-account OAuth. |

This models a draft, not a runtime config export or successful connection. IDs are
opaque; no marketing name substitution. Empty drafts save as incomplete. Invalid
URLs, userinfo/query/fragment credentials, command-like paths, unknown nested keys,
secret fields and renderer-supplied capability claims are rejected. Only auth mode
is stored: there is no key/password/reference text entry. No credential is copied,
invented or read. An unauthenticated intended endpoint remains explicitly selected;
whether the runtime accepts it is still unverified.

The agent location is independently This computer or an inactive server-hostname
draft. Server models can still use local runtime inspection. Remote-agent drafts
have no inspection/connection/launch path and show their limitation. With a local
model plus remote-agent draft, the UI explains that loopback would refer to that
agent server. Addresses are not rewritten.

Status distinguishes saved/incomplete/invalid configuration, runtime not checked/
missing/unverified/version verified, connection not tested, model behavior not
verified and execution not enabled. Full configuration changes invalidate observed
runtime results; generation and canonical configuration-key checks suppress late
responses. Settings remounts the section when its saved Kimi configuration changes.
No phase names, unsupported model claims, global Ready or Connected claim in the UI.

The pinned [provider documentation](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/configuration/providers.md)
and [configuration reference](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/configuration/config-files.md)
support the deliberately modelled routes; saving is not evidence of tool/streaming
compatibility. CLI installation is not model-weight installation. No claim is made
about a model named K3 Pro, hardware suitability or local model availability.

### Local inspection and actual observations

The main-owned inspector reads only `package.json` (64 KiB limit) and `dist/main.mjs`
(32 MiB limit) beneath the explicitly selected absolute local package folder. It
rejects remote paths and files resolved outside that folder, validates regular-file
metadata and compares package name/version plus entry SHA-256 with the pinned proof.
The caller cannot supply a trust hash. Unknown identities are reported unverified
and never executed. No process, shell, auth directory, model endpoint or session API
is involved. The returned observation explicitly excludes dependencies and models.

One inspection owns its handles at a time. A three-second response deadline and
cooperative read deadline bound the operation; if the filesystem stalls, new
inspection remains excluded until that owned read settles and closes its handles.
No process cleanup or kill is needed. The stalled-read fixture verifies timeout,
continued exclusion and later recovery. Unknown entry fixture code that would write
a marker is never executed; its file can be removed after inspection.

Actual metadata observation: retained Phase 1A package version 2.4.1, entry SHA-256
`fd15d5c9b48892bb4f1d5fe82df9f790c8c19a44ca9a81054cc592b6fb9e2c90` matched in about
half a second. This is an actual file observation, not ACP/model/credential validation.
The isolated inspector script and result are retained in `work/kimi-phase2a` outside
the repository. Fixtures cover missing, malformed/oversized and unknown installations.

### Verification and shared-file ownership

**Static PASS:** new-source lint/format; all affected code lint/format against the
isolated proposed commit; focused strict TypeScript for new code and tests; separate
strict changed-caller check including main, preload and SettingsView; narrow actual
main handler and real preload tests; final/staged diff checks. General Provider is
still Claude/Codex only. No admission, routing or execution source was changed.

**Runtime PASS:** real disposable SettingsStore roundtrips all three routes,
preserves unrelated provider/settings values, defaults old files and isolates invalid
Kimi data. Actual retained runtime metadata matches the pinned entry. Missing/unknown
runtime and handle/timeout cases are fixtures. No subprocess or provider ran.

**Behavior PASS:** 48 focused tests in the working tree; 46 in HEAD plus task-owned
changes. The two additional working-tree tests are preserved unrelated settings
tests. Isolated browser proof passes for the real KimiSettings component and the
full proposed SettingsView: all routes, local/remote agent distinction, save/reopen/
reload, invalid URL refusal, failed-save retention, explicit missing/unverified/
verified inspection states, late-result rejection, keyboard save and 300px overflow
check. Browser IPC and inspection responses are mocked; persistence uses the actual
temporary SettingsStore. This is not proof of a live Electron main/preload roundtrip.
The actual main callback and preload are separately checked with controlled Electron
objects. Full isolated main/preload/renderer production build passes.

Screenshots are retained in the user-facing output folder `outputs/kimi-phase2a`,
including `full-settings/kimi-empty.png`, `kimi-local.png`, `kimi-server-model.png`,
`kimi-server-agent.png` and `kimi-moonshot.png`. Visual review confirmed the existing
compact layout, independent agent location and limitation text. Initial UI harness
failures (React alias resolution and select accessible-name matching) were corrected;
the final runs pass. No browser/model network requests outside the isolated asset
server were allowed or observed.

**Contract PASS:** 152 unrelated dirty files remain byte-identical. Eight intentionally
edited dirty files retain every pre-existing hunk: baseline contents/diffs captured,
only declared insertions applied, and each current file compared with the exact
baseline-plus-owned-edit transformation. Separate candidate copies were constructed
from committed HEAD plus those insertions, excluding every unrelated hunk. An archive
snapshot (no Git worktree) verified their coherent dependencies, tests, type checks,
UI and build. Only these candidate blobs are staged for shared files. Dependencies
and settings store were not edited. No existing work was reset, absorbed or reordered.

The original six Electron processes retained their IDs and 08:06 creation times;
the regular app and its output build were not restarted/replaced. The exact loaded
revision remains unverified. No login, model prompt, provider endpoint call, download,
credential injection, task enrollment, dispatch or result publication occurred.

Known limitation: the six earlier audio-related Node type errors remain historical
working-tree evidence. No broad repository typecheck or unrelated fixes were run.
The scoped changed-caller typecheck passes; it does not claim a clean broad suite.
Actual Electron UI roundtrip and all live Kimi behavior: NOT RUN.

Commands: focused `npm run test -- test/kimiSetup.test.ts test/settings.test.ts`;
scoped ESLint/Prettier; strict scratch `focused-tsconfig.json` and
`snapshot-tsconfig.json`; isolated `npm run build`; and
`node test/ui/kimi-settings.smoke.mjs` using existing Playwright/Edge paths,
`THREADLIGHT_SCREENSHOTS`, plus `THREADLIGHT_KIMI_FULL_SETTINGS=1` for full Settings.
Raw artifacts, baseline/diffs, declared edits and checks live under
`C:/proof-work/kimi-phase2a`.

### Remaining route validation and checkpoint

The unchanged live probe supports the managed-account device-code route, not this
Moonshot API-key/custom-endpoint configuration. The next small implementation must
add one selected route to the isolated probe, with explicit endpoint/hardware
authorization, secure credential setup where needed, model identity and operational
limits. Establish runtime behavior for unauthenticated custom endpoints without
inventing credentials. Then exercise streaming, permissions, controlled edit/check,
cancellation/settlement, restoration, continuation and ownership against that route.

For later live work, distinguish permission to use an endpoint/hardware, commercial
allowance where applicable and operational limits. Owned local inference does not
require a fictional provider billing cap. Paid API/rented inference needs an agreed
allowance and substantiated enforcement before promising a ceiling. This phase does
not change the older probe's gate or authorize live calls. Once the route extension
is concrete, request only the endpoint/account decision and applicable usage limits;
never credentials in chat. No user account is needed to use this Settings slice.

Commit the scoped implementation and stop before enabling agent execution. No push,
PR, merge or release. The checkpoint reply records the resulting commit hash.

## Phase 2B checkpoint — 4 November 2026

Status: **PASS — Real Kimi runtime with a scripted model endpoint**. Production
execution remains disabled. The accepted Phase 2A checkpoint was
`118b6c5d54d47628e658e234b60865de5a0e4219`, branch `main`; the index was empty and
160 unrelated dirty paths were captured before work. No additional worktree.

### Implementation and route distinctions

Added one pure `src/main/kimi/config.ts` translator and one owned HTTP/SSE model
fixture. The opt-in ACP probe saves/reloads through the actual SettingsStore and
loads that same translator, then launches the retained, identity-checked, unmodified
Kimi 2.4.1 package. Normal configured credential readiness is used, without bypass.
No shared-schema/runtime-inspector change or production wiring was necessary.

Local/server OpenAI Chat Completions and Moonshot platform API mappings preserve
endpoint, protocol, exact wire model, provider/model aliases and env credential
reference. Structural tests pass for all three; only the owned local scripted
endpoint was exercised. Moonshot's real platform URL is unchanged, distinct from
managed-account login. Remote agent drafts return unsupported-runtime-location.
Missing exact-model metadata or endpoint-bound credential material is incomplete;
`auth:none` is not silently credentialed. Fixture model context/tool facts and its
synthetic key are explicit test inputs, never real-model defaults or saved secrets.

### Evidence, bounds and limitations

Actual runtime PASS: streamed completion, one approved Write with exact file hash,
one denied Write with no file, and foreground cancellation returning `cancelled`.
All six HTTP requests used the expected synthetic model/stream/auth shape. Cleanup
settled owned processes and closed all fixture sockets. Use was four prompts, six
requests and 5776 ms against aggregate limits of eight, 24 and ten minutes; one
active operation, no background/subagent scenarios, no uncertain replay. No real
model/account, API cost or weights were involved. Ancillary outbound activity was
not captured at OS level; zero outbound traffic is not claimed.

Actual isolated Electron PASS: actual renderer/preload/main handler/SettingsStore
save, disk reload and local metadata inspection. Main handlers are extracted from
current source; unrelated lifecycle effects are inert, so full application startup
is outside this result. Two launcher errors (SSR filename, unbundled zod) and a
hidden-window screenshot timeout were corrected; failure evidence is retained.
The independent candidate roundtrip and screenshot pass. No regular app restart.

Static PASS: scoped syntax/lint/format, exact mapping tests, focused strict TS and
diff review. Behavior PASS: 62/62 focused tests in HEAD plus only task-owned files;
working-tree tests also passed 62/62 before final alias assertions. Existing fake
ACP tests are separate from actual-runtime evidence. Phase 2A's historical 48/46
counts still reflect two unrelated working-tree settings tests. Full candidate
main/preload/renderer build PASS. The six earlier audio type failures remain
historical; broad checks and unrelated fixes were not repeated.

Contract PASS: all 160 original dirty files remain byte-identical. The nine owned
paths were clean/new at baseline; no unrelated hunks were absorbed. The candidate
is an archive of committed HEAD plus those paths, using existing dependencies.
Actual-runtime source hashes still match its retained report. Original regular
Electron process identities remain intact; loaded revision is not claimed.

Full evidence, portable artifact references, hashes, isolation and scenario limits:
[Phase 2B validation](../validation/KIMI-ACP-WINDOWS-PHASE1.md#phase-2b--real-kimi-runtime-with-a-scripted-model-endpoint).
External artifacts: `<proof-root>/phase2b/run-01/report.json`, the local candidate
audit, and `outputs/kimi-phase2b/candidate/native-settings-result.json` / screenshot.

### Documentation reconciliation and next gate

Phase 2A's CHANGELOG addition followed the contributor rule for a user-visible
Settings feature; README described the new entry point and its limits. Both were
outside that phase's explicit allowlist but are now accepted. Their current wording
accurately limits the feature to non-secret configuration and metadata inspection,
without authentication, tested real-model connection or execution claims. Neither
file changed this phase: this adds internal translation and isolated proof, with no
new user-visible production capability requiring another changelog entry.

Real local/server model compatibility and Moonshot API authentication remain NOT
RUN. Real-provider Phase 1B validation remains BLOCKED pending an actual endpoint.
Task-wide Stop, background/subagent settlement, real restoration/continuation,
remote termination and production execution admission remain open. The smallest
next step is choosing one real endpoint/exact model with trustworthy metadata and
credential setup, then authorizing a bounded isolated proof. Owned local inference
needs hardware/operational limits; paid API or rented service also needs an agreed
allowance. No credential should be sent in chat. Stop after the scoped local commit;
no push, PR, merge, release or regular-app restart.

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

PASS: existing Windows Sandbox proved the offline boundary and ran pinned Kimi
2.4.1 streaming, approved write, denied write and foreground cancellation. Four
prompts/six scripted requests plus a guarded no-tool API-wire rehearsal: five
prompts/seven requests total, zero paid calls. Process/socket cleanup and guest
retirement passed; host file/process sentinels and the regular app were preserved.

PASS: a separate unpaid online preflight read back guest-only firewall restrictions,
blocked public/host-gateway connections, and received HTTP 401 from the official
API's unauthenticated models endpoint. It did not submit a model prompt. Built-in
Windows app exceptions are recorded; explicit destination/port denies override them.
No host firewall/feature change, shared WSL shutdown, purchase, push or PR.

The fixed Moonshot one-prompt operation is prepared but not executed: exact model
kimi-k3.1-pro, Kimi protocol, explicit metadata, maximum 4096 completion tokens,
one upstream request, <=32768 request bytes, no tools, no retries/redirects and a
ten-minute deadline. The guard is tested against the actual pinned runtime; real
Moonshot authentication/model compatibility remains unproved. A smaller first test
is proposed instead of expanding this milestone into multi-operation billing control.

Starting HEAD bdb090b81b6b71ec9357dd9ae9869890bf17e371. Exact scope:

- `test/live/kimi-sandbox.ps1`
- `test/fixtures/kimi-sandbox-guest.ps1`
- `test/live/kimi-acp.proof.mjs`
- `test/fixtures/fake-kimi-model-server.mjs`
- `test/kimiAcpProbe.test.ts`
- `src/main/kimi/config.ts`
- `test/kimiSetup.test.ts`
- `docs/validation/KIMI-ACP-WINDOWS-PHASE1.md`
- `docs/specs/KIMI-INTEGRATION-PROGRESS.md`
- `updatedifflog.md`
- `test/fixtures/kimi-api-fetch-guard.mjs`

Static checks passed; 72/72 focused tests initially passed. A later probe-only rerun
had two startup-time timeouts while the VM booted; both passed a focused 2/2 rerun
after retirement. Preparation failures (Koffi packaging, required Git Bash, Windows
firewall rule/query compatibility) and their zero-request receipts are retained.
No broader suite was rerun. See the Stage 3 section of
[the validation report](../validation/KIMI-ACP-WINDOWS-PHASE1.md) for source/payload
identities, exact behavior, current pricing, network observations and limitations.

At preservation review, 150 of 160 baseline unrelated files were byte-identical;
ten had advanced concurrently (including Perplexity and its docs), all outside the
owned commit. Their current hashes were captured rather than restoring old copies.
Stages 1/2 previews remain available via the isolated review launcher; no ordinary
application reload occurred. No additional README/CHANGELOG entry is required for
this probe-only stage; Stage 2's user-facing entries are retained.

EVIDENCE_MISSING: account/key provision and explicit numerical allowance. Proposed
one-prompt usage allowance $1 before tax; conservative estimate below $0.30, not an
exact monetary cutoff. Public minimum funding $1, checkout taxes account-dependent;
user funds the account, no automatic recharge. Key entry is hidden inside the guest,
never chat/settings/logs. Production Kimi remains disabled. Real billing, remote
termination, background/subagent settlement and task-wide Stop remain unproved.

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
