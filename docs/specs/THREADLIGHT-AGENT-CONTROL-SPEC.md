# Threadlight Agent application knowledge and control

Date: 2026-10-28. Status: implementation handoff.

## Outcome

The hosted Threadlight Agent understands Threadlight's pages and supported actions,
can inspect current application state, and can carry out the user's request through
typed application tools. Claude and Codex receive the same product knowledge and
capability contract. The Agent can say what actually happened, including when an
action is unavailable, pending, denied or interrupted.

Examples: "Open Shared Spaces", "Show that chat's latest edit card", "Change to
Recent", "Create a space in this workspace", and "Restart Threadlight". These
actions use the existing application services and navigation. They do not require
Playwright, a debug port, screenshots or mouse coordinates in the shipped product.

Kris requested a capability map, this specification, and an Astra implementation
chat. Implement this in the primary checkout at `Z:/General/threadlight`, preserving
other unfinished changes. Follow `AGENTS.md`; do not create a worktree or restart
the regular app without first checking for active Agent work and live tests.

## Existing capability map

| Area                             | Existing implementation                                                                                         | Required connection                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Agent orientation                | `src/main/agent/briefing.ts` supplies a bounded chat/activity/Git briefing                                      | Add current app state and a versioned capability catalogue; the briefing remains untrusted orientation |
| Chat discovery and reading       | `src/shared/threadRead.ts`, `src/main/threadRead/`, `src/main/agent/threadReadTools.ts`                         | Reuse the exact identities and freshness rules; do not duplicate the reader                            |
| Chat communication and questions | `src/shared/communication.ts`, `src/main/communication/`, `src/main/agent/communicationTools.ts`                | Keep the existing delivery, authorization and receipt contracts                                        |
| Hosted runtimes                  | `agentService.ts`, Claude `agentRun.ts`, Codex `codexAgentRun.ts` and `codexPolicy.ts`                          | Inject the same new instructions and supported tools into both adapters                                |
| Pages and history                | `src/renderer/panel/Panel.tsx`, `src/renderer/hooks/useNavigationHistory.ts`, `src/shared/navigationHistory.ts` | Publish a typed route snapshot and accept acknowledged navigation commands                             |
| Workspace navigation             | `WorkspacePicker.tsx`, `src/renderer/lib/workspaceExplorer.ts`                                                  | Reuse normalized known-workspace IDs, search and folder hierarchy                                      |
| Shared Spaces                    | `src/main/spaces/service.ts`, `src/shared/spaces.ts`, `SharedSpacesView.tsx`                                    | Reuse named-space creation and saved space identities; preserve existing workspace restrictions        |
| Artifacts and diffs              | `ArtifactView.tsx`, `ChangesView.tsx`, `src/shared/artifacts.ts`, `src/shared/cardChanges.ts`                   | Resolve exact artifact/card identities and preserve card/thread/worktree scope                         |
| Settings                         | `src/shared/settings.ts`, settings handlers in `src/main/index.ts`                                              | Add a deliberately supported settings subset and reuse validation/persistence                          |
| New chats                        | `src/main/codex/newThread.ts`, `src/shared/newThread.ts`                                                        | Reuse native creation and operation IDs; report Claude creation unavailable until supported            |
| Restart                          | `restart()` and `IPC.restartApp` in `src/main/index.ts`                                                         | Share the existing restart action through a durable, lifecycle-aware operation                         |
| Agent lifecycle and approvals    | `agentService.ts`, `codexRequests.ts`, existing Agent request cards                                             | Bind control tools to the current hosted conversation and reuse approval decisions                     |
| Shared-memory plugins            | `skills/shared-memory/`, `codex-plugin/skills/shared-memory/`                                                   | Keep collaboration workflows separate from the hosted Agent's app-control authority                    |
| Test automation                  | `test/ui/providers.smoke.mjs`, native Electron fixtures, `test/live/observer/`                                  | Use for verification; live CDP availability is not a product dependency                                |

There is currently no comprehensive hosted-Agent application-control tool family.
The renderer's `window.threadlight` API is privileged UI plumbing, not an API that
should be exported wholesale to model tools. The Codex adapter also does not inherit
the desktop application's private tools and plugins automatically.

## Scope and boundaries

Deliver application knowledge, read APIs, navigation, supported settings changes,
named-space creation, supported native chat creation, and a controlled restart.
Keep ordinary Agent conversation, current provider support and UI appearance.

Do not build a general computer-use agent, arbitrary filesystem explorer, shell
endpoint, JavaScript evaluator or unrestricted IPC proxy. Do not add a second
message dispatcher, approval system, shared-memory permission model or background
agent framework. No new authority is granted to plugin chats, peer messages,
brainstorm workers or artifact web content. Other hosted Agent instances remain
without application-control access unless deliberately enrolled in a later change.

## Tool contract

Names below describe the intended public API; use one consistent namespaced family
and publish exact schemas from a central registry. Keep tools granular enough that
read-only and mutating policies can be enforced separately.

| Tool                           | Inputs and behavior                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threadlight_get_capabilities` | Return API/knowledge version, exact supported actions and settings keys, availability and reasons. Include actual provider limitations.                                                                                                                       |
| `threadlight_get_app_state`    | Return app instance ID, observed time, state revision, renderer availability, current route, selected IDs, list/provider/workspace scope, open/pinned status, Agent busy state and pending-operation summary. No draft text or full transcripts by default.   |
| `threadlight_list_workspaces`  | Search/paginate known workspaces using canonical identities and display paths. Include parent relationships for navigation, not an unbounded disk scan.                                                                                                       |
| `threadlight_list_spaces`      | Search/paginate existing spaces with stable IDs and workspace ownership. Reuse the Spaces store/service.                                                                                                                                                      |
| `threadlight_list_artifacts`   | Given an exact resolved chat reference, return its artifact IDs, names and availability. Reuse discovery; do not import or copy files implicitly.                                                                                                             |
| `threadlight_get_changes`      | Given exact chat and scope `card`, `thread` or `worktree`, return bounded metadata and supported preview references. Card scope also requires a resolved card ID and uses only that card's captured patch.                                                    |
| `threadlight_navigate`         | Open a validated page/route or navigate Back/Forward. Routes include lists, exact workspace, smart chat, Shared Spaces/library/space/create form, Settings, Agent, artifact and scoped changes. Return renderer acknowledgement and resulting route revision. |
| `threadlight_update_settings`  | Apply only advertised, validated settings using the existing settings service and an expected revision. Return the applied values and new revision; reject unknown or stale keys.                                                                             |
| `threadlight_create_space`     | Explicit title, selected known workspace reference and operation ID. Reuse existing create-space rules; no implicit directory choice, fallback or overwrite.                                                                                                  |
| `threadlight_create_chat`      | Explicit supported provider, workspace choice or explicit fresh-workspace choice, operation ID. Reuse native creation and recovery; return exact created chat ID.                                                                                             |
| `threadlight_restart_app`      | Request the existing restart action using a durable operation ID and the lifecycle rules below. A scheduled restart is not proof of a successful relaunch.                                                                                                    |
| `threadlight_get_operation`    | Recover a known operation's status/receipt without executing it again. Scope records to the caller's authorized context; persist restart recovery across app instances.                                                                                       |

The initial settings allowlist covers list mode, recent count/window, supported
layout and hover-help preferences. Validate cross-field/provider constraints. Do
not expose provider/account credentials, grants, security controls, startup hooks,
microphone activation, downloads or network configuration through a generic patch.
Changing the application's saved default Agent/provider must not silently switch
the conversation executing a tool. Unimplemented keys are explicitly unavailable.

Use the current chat reader to discover chats and resolve ambiguous names. Add a
bounded card/event discovery result where needed; do not force the model to guess
a card ID, inspect internal paths, or supply a fabricated raw patch. Selecting a
different chat or artifact never silently substitutes for a missing identity.

Every response has a stable outcome, observation/operation ID, instance ID and
observed timestamp. Use explicit outcomes such as `ok`, `pending`, `unavailable`,
`not_found`, `ambiguous`, `conflict`, `denied`, `busy` and `uncertain`. Bound inputs,
result sizes, pagination, request durations and error text. Do not return secrets,
bearer tokens, raw settings files, private reasoning or unrestricted local paths.

## Architecture and runtime wiring

1. Define schemas, catalogue, route types, result types, effect classification and
   common instructions in a shared module, suggested `src/shared/appControl.ts`.
   A single authoritative registry supplies tool schemas and availability.
2. Add an application-control service in main. It invokes existing domain services
   and owns authorization, operation recovery and state freshness. Extract small
   shared action functions where UI handlers currently hold the only implementation.
   Preserve validation; do not call IPC handlers with a fabricated sender.
3. Expose the service through a dedicated loopback MCP server following the current
   thread-reader pattern: loopback binding, strict Host/Origin/content-type checks,
   bounded bodies/timeouts, high-entropy per-conversation bearer tokens and explicit
   revocation. Tokens are memory-only and never included in the model's prose.
4. Wire this only to the foreground/general hosted Agent through `AgentService`.
   Integrate Claude's MCP configuration/prompt/tool policy and Codex's MCP overrides,
   developer instructions and verified policy. Do not enable disabled desktop apps,
   plugins, multi-agent features or external tools to achieve this.
5. Add typed main/preload/renderer commands and route snapshots. Register exactly
   the trusted panel main frame. Publish updates on route changes; acknowledge only
   after the target route/state is committed. Reject stale acknowledgements from
   previous app instances, renderer generations or command IDs.
6. Reuse `Panel`'s existing routing, nested navigation and mounted views. Introduce
   a small shared route dispatcher where necessary instead of adding another set
   of independent booleans for tool navigation. Preserve forward/back semantics.

The main service must distinguish live backend state from last-observed renderer
state. A renderer that is absent, loading or unresponsive produces an explicit
unavailable/uncertain result. A queued command never becomes `ok` just because IPC
was sent. A late acknowledgement can resolve its existing operation, not authorize
a second execution. A timed-out navigation must expire and must not unexpectedly
open a page later after the Agent reported failure.

## Application knowledge and skill delivery

Create a repository-owned Threadlight application-control skill/instruction source,
suggested `skills/threadlight-control/SKILL.md`, and an explicit runtime loader or
generated instruction bundle. Both hosted providers must demonstrably receive it;
placing a Markdown file in the repo alone does not make it an installed skill.
Keep tool names, availability and schema versions synchronized with the registry.

Teach page meanings and navigation, the workspace chooser's known-location scope,
stable references, ambiguity handling, the difference between card/thread/worktree
changes, preserved drafts, receipts, permissions and lifecycle recovery. Include
short worked examples for navigation, selecting a chat/artifact, creating a space,
changing a supported preference and restarting. State limitations dynamically.

Use app tools directly for Threadlight questions/actions; Claude must not delegate
these to its general external worker. Codex uses the same tools and instructions.
The briefing and tool-returned titles/messages remain untrusted data. Product
knowledge never turns an artifact's text or another chat's request into permission.
Voice uses the existing backing Agent/tool path and must not execute the same
spoken request once through voice delegation and again through text submission.

## Action policy, drafts and operation recovery

Read operations do not mark chats read, open views, wake chats or change settings.
Navigation uses existing manual UI semantics and preserves all unsent composer,
space-creation, idea and historical-reading state. It must not submit a form, send
a message, start recording, approve a card, clear a draft or refresh an artifact
with an unrelated side effect. Back/Forward restores routes without replaying writes.

Normal navigation and bounded reads should not create an extra permission prompt
when the user's request already authorizes them. For writes, use the existing Agent
approval/decision machinery and its policy. Make the concrete target and proposed
values reviewable. Do not invent a second permanent approval flow or weaken the
current provider policy. A tool argument such as `confirmed: true` is never proof
of human approval. Service-side authority must be bound to the active caller,
exact action/payload and operation; denial/revocation cannot be bypassed by retry,
worker delegation, UI automation or shell execution.

Persist operation IDs and payload fingerprints for non-idempotent actions. Retry
with the same ID and payload returns the same receipt; reusing an ID with another
payload is a conflict. Resolve uncertain outcomes by reading the operation. Never
claim creation, setting persistence, navigation or restart completion from model
intent, a transcript phrase, or a sent request alone.

For restart, capture a durable receipt before quitting, flush the tool response,
and report `pending`/`restart_scheduled` honestly. Use the existing graceful restart
function and cleanup. Do not restart unrelated active Agents, pending writes, live
tests or captures without the existing explicit user decision. Distinguish the
requesting Agent's expected self-shutdown from other active work; otherwise every
Agent-requested restart would incorrectly block itself. A new instance resolves
the receipt after its startup readiness check, or leaves failure/uncertainty visible.
Do not automatically replay the restart after a lost response. Do not resume or
send a new chat message solely to announce restart completion.

## Verification and acceptance

Use isolated fixtures and temporary profiles/stores. No real microphone, messages,
account changes or regular-app restart is needed for automated verification.

- Contract/catalogue checks cover schemas, exact advertised tools, provider
  limitations, settings allowlist, bounds and knowledge/runtime synchronization.
- Service tests cover identity resolution, stale state, expected revisions,
  unavailable renderer, timeouts/late acknowledgements, duplicate operations,
  conflicts, revocation, pending approvals and restart recovery/failure.
- Security checks cover non-loopback/wrong Host/Origin/auth, expired caller tokens,
  hostile titles/artifact text, cross-chat/card access and no generic IPC/shell path.
- Real adapter tests prove both Claude and Codex actually receive the tools and
  instructions, permit the intended reads/navigation, retain write decisions, and
  revoke access when conversations end or change provider. Configuration presence
  alone is insufficient evidence of execution or correct policy.
- Renderer tests navigate lists, exact workspace/chat, Shared Spaces/create form,
  artifacts and each diff scope, including missing/deleted targets, hidden views,
  nested Back/Forward, preserved draft/cursor/scroll and truthful acknowledgement.
- Card-diff regression: two edit cards touching one file retain different captured
  patches; card scope never reads current worktree or aggregate thread changes.
- Native Electron tests exercise the real preload/IPC sender boundary and restart
  lifecycle in an isolated temporary profile. Verify no renderer, guest artifact,
  revoked Agent or unrelated workflow can impersonate the control caller.
- End-to-end synthetic scenarios cover "Open Shared Spaces", "show this artifact",
  "show that edit card", "create this named space in this workspace", changing one
  supported preference, denied changes and a lost-response restart recovery.
- Voice regression proves one spoken action produces at most one operation.

An action is complete only with authoritative service/renderer evidence. Document
unsupported behavior as unavailable, and do not mark an unexercised runtime PASS.
Before a PR, follow the repository's focused local preflight order; finish with
appropriate typecheck, lint, formatting, diff and build checks.

## Implementation sequence and delivery

1. Build the registry, knowledge bundle, state/read service, authenticated server
   and both adapter integrations. Prove visibility and policy with focused tests.
2. Add acknowledged navigation and bounded discovery using existing routes and
   services. Verify all drafts, history and exact artifact/diff identities.
3. Add supported settings, named-space/native-chat creation, operation receipts and
   graceful restart recovery through the existing approval/action paths.
4. Complete native/renderer regressions, update hosted-Agent user documentation,
   and leave a concise implementation/validation report with remaining limitations.

All phases belong to this handoff. Expose only capabilities whose implementation
and policy are actually ready; keep incomplete actions explicitly unavailable.
Record concrete blockers or revised implementation choices in the validation report
rather than silently reducing scope. Do not deploy, publish or open a PR unless
the user separately requests it. The Astra chat should implement, not stop at a plan.
