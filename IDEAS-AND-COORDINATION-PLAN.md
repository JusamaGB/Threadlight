# Threadlight Ideas and Coordination Plan

Status: roadmap with an initial compact Shared Spaces implementation. Later milestones remain proposed.

Updated: 26 October 2026.

## Initial implemented slice

The approved compact design uses one Shared Spaces header, one Back button, and
Handoffs, Ideas and Brainstorm tabs. Shared Spaces is the collaboration layer between
providers, not another personal memory system. Existing shared-context stores,
enrollment permissions and delivery boundaries remain in place.

The first slice provides durable typed ideas, explicit movement into Brainstorm,
per-idea Agent conversations separate from the general Agent, an editable mini plan,
and user-chosen task/provider/existing-chat assignments. Preparation atomically saves
a pinned plan and unsent assignments in Handoffs. The user reviews and authorises
each task using the existing transport. Prepared plans remain frozen; dependencies
are sequenced manually. No new provider chat is created by preparing a plan.

This is a subset of M1–M3, reusing the existing assignment system. The larger workspace,
dictation capture, workflow profiles, automatic decomposition, model-specific worker
creation, dependency scheduling, PR relationships and automatic progression below
remain future work. Brainstorm and dispatch paths were tested with synthetic provider
boundaries; this slice does not expand claims about live desktop delivery support.

## 1. Product purpose

Threadlight helps people turn ideas into coordinated work across Claude and Codex, and understand when that work needs their attention. Its Agent oversees the effort: it develops ideas with the user, prepares assignments, follows related threads, and connects results back to the original intent.

The main reason to choose Threadlight is continuity across providers and stages of work. Users keep their preferred coding applications and models while gaining one place to capture thoughts, develop plans, and follow delivery. Generic document creation, spreadsheets, presentations, and broad plugin support are outside this roadmap's initial scope.

The product has two complementary surfaces:

- **Accessory:** the existing dot and compact panel for capture, quick questions, attention, and thread actions.
- **Workspace:** a larger, resizable window for the ideas board, brainstorming, assignments, and linked work. Opening it is explicit; incoming activity never steals focus.

The workspace is an extension of the accessory, not a requirement for everyday monitoring. Closing either surface must not discard work or silently cancel active tasks.

## 2. End to end experience

**Capture an idea → brainstorm → prepare assignments → start work → oversee → review and finish.**

### Capture

The user types or dictates a thought from the panel or a configurable shortcut. It becomes an idea card immediately, using the user's text as its initial title. Saving an idea does not make an Agent request. Voice capture reuses the local transcription path; raw audio is not retained by default.

The Ideas view supports search, simple tags, optional project association, manual ordering, and archive with undo. Notes can be added without moving an idea into active work. Capture remains available with both monitored providers disabled or absent.

Voice intent must be explicit: **Save idea**, **Ask Agent**, and **Message thread** are separate destinations. Ambiguous speech becomes a draft for review. Recording must not dispatch work because a title or command was misheard.

### Brainstorm

Dragging an idea to Brainstorm opens its detail view; an equivalent keyboard/button action is always available. Moving the card alone does not send a prompt. The user starts or continues the conversation using their chosen Agent provider and model.

Each idea has its own saved discussion association. Switching ideas must not mix conversation state, voice input, drafts, or late responses. The Agent helps settle:

- The problem, intended user outcome, and smallest useful scope.
- Constraints, open questions, assumptions, and excluded work.
- Acceptance criteria and likely implementation boundaries.

The output is an editable mini plan. The user can save it, return later, revise it, or leave the idea dormant. A saved plan survives expiry of the provider conversation. Switching providers uses a visible handoff brief and a new conversation; it never pretends the provider history transferred automatically.

### Prepare assignments

The Agent proposes tasks from a selected plan revision. Each task specifies an outcome, a bounded brief, dependencies, acceptance criteria, provider/model, repository/workspace, and either an existing destination thread or a new thread request.

An assignment preview shows exactly what will be sent and where, including any context being shared between providers. Users can edit, combine, remove, or reassign tasks. A small change may stay in one thread; splitting and parallelism are choices, not default goals.

**Start work** approves a particular revision and set of assignments. Later plan edits do not change already dispatched instructions. They create a proposed amendment showing affected tasks and messages.

### Oversee

The work view groups tasks, Claude/Codex threads, and PRs under the idea. Each thread retains an Open in provider action. Users can attach existing threads without first creating an idea-driven assignment.

The Agent should answer questions such as:

- What needs my attention, and what can continue independently?
- Which task is blocked, and what is it waiting for?
- Has implementation incorporated the approved decision?
- What changed since I last checked?
- Is this ready for review, and what evidence is missing?

Answers link to their supporting thread, plan revision, file, or PR observation and state when the evidence is stale. The Agent proposes a next action when useful; a status question is not authorization to send instructions to other threads.

### Review and finish

A completed model turn is an observation, not proof that a task is done. Tasks move to review when a result and relevant evidence are available. Work is complete when its acceptance criteria are met and the user accepts the result, or a separately configured completion rule is satisfied.

The finished idea retains its plan, decisions, task history, thread links, and PR links. Reopening creates follow-up work without erasing earlier completion evidence. Archiving an idea does not archive provider threads or close PRs.

## 3. Product decisions for the first release

| Decision               | Initial behavior                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent object          | The idea/work item owns the plan and links. A PR is one possible delivery artifact, not the parent.                                                               |
| Board stages           | Ideas, Brainstorm, Ready, In progress, Review, Done. Archive is separate.                                                                                         |
| Board movement         | Reversible local organization. Moving a card never starts a model or sends a message by itself.                                                                   |
| Brainstorm concurrency | One foreground Agent conversation at a time initially; each idea can resume its own conversation. Busy conversations must be resolved before switching execution. |
| Routing                | User-defined role profiles with explicit provider/model selection. Automatic routing begins as editable suggestions.                                              |
| Dispatch               | User approves the concrete batch. Unsupported destinations remain prepared with a clear manual handoff.                                                           |
| Monitoring             | Local events and bounded reads update status. Model interpretation runs on demand initially.                                                                      |
| Parallelism            | Independent work may run together only with a compatible workspace/branch ownership plan. Default to serial execution for a shared checkout.                      |
| Permissions            | Approving a plan does not approve arbitrary tools, external messages, merges, publishing, or deployment. Existing runtime approvals still apply.                  |
| Provider changes       | No silent fallback, model substitution, or cross-provider context transfer.                                                                                       |
| Budget                 | Capture and ordinary board use require no inference. Usage is reported only when measurable; unknown values remain unknown.                                       |

These defaults support a usable first release without requiring complete control of live desktop chats. Later workflow profiles may authorize specific automatic handoffs within a reviewed plan; they must preserve the same destination, revision, and delivery checks.

## 4. Workflow profiles and efficient context

A profile defines roles such as Brainstorm, Implement, Review, and Integrate. Users map roles to available providers and models, select reasoning levels where supported, and choose serial/parallel dependencies. Roles are optional and can share one thread.

Example profile, with model names selected from the actual installation:

1. Brainstorm uses the user's preferred reasoning model.
2. Implementation receives the agreed plan and relevant repository scope.
3. Review receives the resulting diff and acceptance criteria after implementation completes.
4. Integration consolidates approved changes into the intended delivery branch.

Profiles also hold the repository, workspace strategy, context-sharing choices, maximum concurrent tasks, and handoff policy. Changing a profile affects future assignments; an approved assignment keeps a snapshot of its settings.

Each task brief contains the outcome, relevant decisions, scope/exclusions, inputs, dependencies, expected result, and completion evidence. Include bounded excerpts and source references rather than copying every conversation. A summary records its source revision/time and can be inspected or corrected.

Efficiency is measured, not assumed. Track reported tokens per work item when available, number of inference calls, handoffs, retries, repeated context, and user interventions. Compare a coordinated workflow with an equivalent single-thread workflow before claiming savings. Do not equate a short prompt with low total usage, or account quota with per-task cost.

Where the runtime cannot enforce a token/cost ceiling, label it as an estimate or spending alert. A hard local limit can prevent starting another task; it cannot promise to stop an already running provider turn at an exact token count.

## 5. Thread relationships and pull requests

Use a grouped list as the primary view, with optional connector lines on selection. A full graph is not required to navigate the product. Every visual relation has a text equivalent and an accessible label.

Relations have explicit meanings: **implements**, **reviews**, **depends on**, and **contributes to PR**. Provider tint identifies Claude/Codex; state labels and shapes carry meaning independently of color. Selecting a work item highlights its related threads and PRs without drawing every relation on screen at once.

One task may have multiple attempts/threads, and one work item may produce several PRs. An existing thread may be linked to more than one work item, but only one active dispatch may own its input at a time. Linking a thread does not establish that its existing content belongs to the new task.

The first release allows manually verified PR URLs. Repository integration can later verify branch, commit, checks, review, and merge state. Findings and checks are tied to a head revision; a new commit makes previous review evidence stale.

For multiple agents contributing to one PR:

- Choose an integration branch and an explicit integration owner.
- Use separate worktrees/branches for concurrent writers, or run writers sequentially in one checkout.
- Assign file/component boundaries and record dependencies.
- Consolidate changes deliberately; connecting two threads to the same PR does not merge their Git histories.
- Run the relevant local preflight before creating/updating a PR. Preserve the user's existing focused-check preferences.

Automatic merging and deployment are not initial release features.

## 6. Existing foundations and technical gaps

This plan builds on the current checkout rather than treating historical specification baselines as unfinished work.

| Existing area                                      | Reuse                                                        | Required addition                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Combined session snapshots and `agent/briefing.ts` | Cross-provider status and bounded thread context             | Work-item-specific context, stable relationships, freshness, and evidence references                               |
| `agentService.ts`, provider runs, `agentStore.ts`  | Hosted conversations, history, approvals, model selection    | Per-idea conversation association and explicit separation of coordinator and worker roles                          |
| Voice routing and composer drafts                  | Local capture and recoverable input                          | Capture destination and per-idea drafts                                                                            |
| `relayService.ts`, `codex/relay.ts`                | Exact existing-thread delivery when the provider releases it | Persistent dispatch attempts, correlated acceptance/completion, and safe recovery                                  |
| `messaging/store.ts`, `coordinator.ts`             | Draft/operation persistence and recovery concepts            | A real delivery adapter for each supported transport; the current coordinator is not a connected desktop transport |
| Provider hooks and trackers                        | Activity, held cards, and observable state                   | Reconciliation against task ownership and no-inference attention rules                                             |
| `windows.ts` and panel views                       | Accessory behavior                                           | Resizable workspace sharing the same main-process state                                                            |
| `codexPolicy.ts`                                   | Integration exclusion and tool-policy checks                 | Capability descriptions aligned to coordination; selective integrations only after verification                    |

Current delivery constraints remain explicit:

- Claude and Codex existing-thread relays refuse sessions with active owners. Idle and released are different states.
- Independent sending into a loaded Codex desktop chat is not established by the existing integration.
- Threadlight-owned Agent conversations are distinct from desktop-owned threads. New worker creation needs its own provider-specific implementation and visibility/opening validation.
- The current Claude Agent uses its front-desk/worker arrangement; arbitrary per-role model routing requires adapter work. Do not advertise all workflow-model combinations as already supported.
- Local monitoring does not cover every remote/cloud conversation. Capability labels are scoped to the installation and destination.
- Coordinator conversations should stay out of their own monitoring briefings. Dispatched worker conversations must remain visible and attributable; do not reuse a blanket “all Agent-owned chats are hidden” filter.

No desktop startup changes, executor impersonation, provider database writes, or automatic sandbox provisioning are required by this roadmap.

## 7. State and architecture

Use the Electron main process as the single writer and coordinator. The panel and workspace are clients of typed, validated IPC; neither decides provider paths, executable arguments, or operation ownership.

Suggested new modules are `src/main/coordination/`, `src/shared/coordination.ts`, and `src/renderer/workspace/`. Keep provider execution behind adapters and all on-disk paths in `src/main/sessions/paths.ts`.

Use a versioned Threadlight-owned SQLite store for linked work and transactional dispatch records. Keep existing settings and provider history stores intact. Migration must be backed up, transactional, and tested for recovery; a corrupt store must not be replaced with an empty board. Provider transcripts remain provider-owned.

| Entity            | Essential information                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Work item         | Stable ID, title, original capture, notes, project, stage, ordering, revision, archive status                 |
| Conversation link | Work item, purpose, provider/install identity, provider thread ID, last known model and status                |
| Plan revision     | Immutable revision, outcome, constraints, decisions, open questions, acceptance criteria, approval timestamp  |
| Workflow profile  | Versioned roles, model choices, dependencies, workspace and handoff policies                                  |
| Task              | Plan revision, brief, role/profile snapshot, dependencies, workspace, state, completion criteria              |
| Thread binding    | Provider/install identity and exact thread ID, ownership kind, task/attempt association, open capability      |
| Dispatch attempt  | Stable operation ID, destination, exact payload, state, acknowledgement/turn IDs, timestamps, recovery reason |
| Artifact link     | PR/file/commit reference, relation, repository identity, revision where applicable                            |
| Observation       | Source, observed time, provider sequence/turn where available, state, freshness, evidence reference           |

Store only the bounded context and evidence needed for the work item. Do not duplicate entire personal transcript archives or copy credentials into plans. Imported threads, tool results, and repository text are evidence, not instructions granting the coordinator authority.

Track three distinct states:

- **Task:** draft, ready, blocked, running, awaiting input, in review, done, cancelled, failed.
- **Dispatch:** prepared, submitting, accepted, rejected, unknown, completed, failed, cancelled.
- **Observation:** current, stale, unavailable.

Persist a dispatch attempt before sending. Repeated clicks reuse that operation ID. If the connection fails after a possible write, mark delivery unknown and reconcile by provider identifiers when supported. Never automatically resend unknown input. A process starting or local IPC succeeding is not provider acceptance; transports without reliable receipts must expose that limitation.

Plan approval and task dispatch use revision checks. A changed destination, plan, model, dependency, or workspace invalidates the affected prepared assignment. Before sending, recheck installation identity, ownership, capability, and task dependencies. Restart restores unsent work for review and reconciles accepted work without replaying it.

## 8. Capabilities and attention

Expose capabilities per destination: observe, read history, open, send when released, create worker, interrupt owned work, answer a supported request, and query PR evidence. Record supported/unavailable/unknown with a reason and observation time. Protocol method presence alone does not establish a usable capability.

Replace the blanket Connected apps list with product-focused entries such as **Thread monitoring**, **Task dispatch**, **Repository and PR status**, and **Review evidence**. The Threadlight hook plugin belongs in connection health. General document skills are deferred. Browser/computer control is not the primary dispatch mechanism.

The Agent gets narrow coordination actions that the main process validates: read a work item, propose a plan, propose assignments, inspect observations, and request an authorized dispatch. Provider text cannot invoke privileged operations merely by containing a task or thread ID.

The first release uses deterministic notifications for new questions, failures, dependency changes, delivery uncertainty, and review readiness. Debounce repeated observations, deduplicate notifications, and respect quiet settings. Ordinary polling never invokes the model. Optional background Agent summaries come later, with a visible cadence/usage policy and no repeated notifications for unchanged state.

## 9. Implementation milestones

Each milestone should be independently reviewable and preserve existing Claude/Codex monitoring, composer, voice, and Agent behavior. No calendar estimates are assigned until the capability work has been scoped.

### M0 Product boundaries and provider capability contract

Define task/dispatch identities, destination capabilities, role profiles, and ownership kinds. Map the existing integrations to this contract without adding new sends. Design the main workspace navigation and assignment preview using synthetic content.

**Exit criteria:** every action has a supported/manual/unavailable path; loaded versus released chats are distinguished; no capability depends on an assistant-only tool available in the development chat. Agree the initial user flow and state vocabulary before parallel implementation streams begin.

### M1 Persistent ideas and workspace

Add the coordination store, typed IPC, resizable workspace, ideas board, capture flow, search, archive/undo, and project association. Reuse local dictation. Keep idea capture available independently of provider monitoring.

**Exit criteria:** typed/dictated ideas survive restart; simultaneous panel/workspace edits cannot overwrite each other silently; keyboard and drag actions agree; capture and card movement trigger zero model calls; original monitoring remains usable with the workspace closed.

### M2 Brainstorm and versioned mini plans

Associate each idea with its own resumable Agent conversation. Add the structured plan editor, decision notes, save revisions, and explicit provider handoff. Build work-item-specific briefings instead of sending the full monitored list for every brainstorming turn.

**Exit criteria:** two ideas never mix messages or late voice results; restarting restores the right discussion; an expired conversation leaves its plan usable; the user can produce and revise a plan without dispatching any work.

### M3 Workflow profiles and assignment preparation

Add role/model configuration, task decomposition proposals, dependency validation, context previews, existing-thread linking, and manual new-thread handoff. Export/copy briefs individually and record manual assignment separately from verified delivery.

**Exit criteria:** the user can prepare work for both providers, inspect exactly what each receives, amend tasks, and follow manually linked work. Missing models and dependency cycles are actionable errors. Copying a brief is never labelled Sent. No provider chat is created merely by previewing an assignment.

**Useful first pilot:** M1–M3 provide capture, brainstorm, explicit assignments, and linked monitoring without depending on automatic thread creation.

### M4 Verified dispatch and worker lifecycle

Implement automatic dispatch one provider/transport at a time. First connect released existing-thread relays to durable operation tracking; then add explicitly owned worker creation where it can be verified. Freeze each adapter's supported capability set until its acceptance cases pass. Keep manual handoff for remaining combinations.

**Exit criteria:** a disposable real-provider check targets the exact intended thread; another thread remains untouched; acceptance/completion are distinguished; double clicks, writer races, disconnects, and restart do not duplicate work. Owned-worker creation records the actual model, permissions, workspace, identity, and visibility. Unsupported open-chat sends preserve the brief and explain the next action.

### M5 Work oversight, relationships, and PR evidence

Add the grouped work view and optional relation lines, per-task evidence, deterministic attention, and Agent status questions. Link PRs manually first; add verified repository/check metadata through a selected integration. Establish branch/worktree ownership for multi-writer work.

**Exit criteria:** one work item groups Claude and Codex tasks and their PR; the Agent can explain a blocker using evidence; stale data is visibly stale; a new commit invalidates old review evidence; provider turn completion alone never closes the work item. Unrelated provider threads remain visible outside the work item.

**Coordinated-work release:** M1–M5 complete the main product loop with a published capability matrix. Shipping does not imply every provider supports every dispatch action.

### M6 Bounded automatic handoffs and efficiency evaluation

Add opt-in progression within approved workflows, such as sending a completed implementation to its assigned reviewer. Add concurrency limits, dependency scheduling, measured usage summaries, and optional background synthesis.

**Exit criteria:** no handoff runs against an unapproved revision or unmet dependency; pause prevents new dispatches without claiming to stop provider work; unknown delivery blocks dependent automation; the user can inspect and revoke remaining authority. Compare token use and interventions with a single-thread baseline before promoting efficiency claims.

## 10. Verification and release gates

Use synthetic ideas, repositories, threads, and PR fixtures. Real-provider tests must be bounded and confined to dedicated test work; no approvals or messages are exercised against unrelated production threads.

| Scenario                               | Required result                                                     |
| -------------------------------------- | ------------------------------------------------------------------- |
| Capture offline or with no providers   | Idea saved; no inference or connection required                     |
| Two surfaces edit one idea             | Revision conflict is surfaced; neither draft silently disappears    |
| Switch ideas during a pending reply    | Reply stays attached to its original conversation                   |
| Change a plan after preparing tasks    | Affected assignments require refresh/review                         |
| Unknown model or unavailable provider  | Preserve task; no silent substitution                               |
| Exact-thread dispatch                  | One accepted input reaches the selected identity only               |
| Chat becomes owned before sending      | Safe refusal; brief retained; no second writer                      |
| Crash before/after possible submission | Recover prepared/unknown states correctly; no blind replay          |
| Worker versus coordinator identity     | Workers appear under their tasks; coordinator does not brief itself |
| Concurrent tasks touch one checkout    | Enforce the chosen isolation/serial policy                          |
| PR receives another commit             | Old checks/review cannot prove the new head is ready                |
| Thread suggests new actions            | Evidence does not expand dispatch or approval authority             |
| Archive or close the workspace         | Preserve provider chats, PRs, saved ideas, and active task tracking |
| Unchanged monitoring                   | No inference calls or repeated attention alerts                     |

For each implementation PR, run fast structural/product-evidence checks first, then focused changed-behavior and affected-caller tests, then relevant type, diff, and build checks. Complete repository-required checks before publishing. Do not use CI as the first diagnostic or repeat broad suites without a new reason.

Use renderer smoke tests for keyboard capture, board movement, assignment previews, relation selection, and recovery messaging. Add persistence/concurrency tests for state transitions and meaningful provider contract tests for dispatch. Record real-runtime compatibility separately from mocked UI evidence.

## 11. Success measures and initial backlog

Measure whether users can find an idea later, resume its reasoning, understand assignments before starting, identify the next blocker, and trace delivered work back to its intent. Track time to first saved idea, time to a dispatchable plan, manual corrections to assignments, duplicate/unknown deliveries, and notifications per actionable event. Keep measurement local initially; telemetry is a separate decision.

The first implementation change should deliver **M1's smallest vertical slice**: open the workspace from the accessory, save a typed idea, list it, edit it, and recover it after restart. Include the store and validated IPC needed by that slice. Add dictation and board organization next, followed by brainstorming. Do not start with a general graph editor, automatic multi-agent execution, or enabling the plugin catalog.

This roadmap changes the Agent's product priority toward coordination. Existing provider permission and delivery boundaries in [Agent Codex support](AGENT-CODEX-SPEC.md), [Codex integration](CODEX-INTEGRATION-SPEC.md), and [voice control](VOICE-CONTROL-SPEC.md) remain applicable. Their overlapping product sections should be reconciled in the implementation PR that introduces the new behavior.
