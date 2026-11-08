# Conversational project chat enrollment — Astra handoff

Date: 2026-10-28. Status: proposed; discovery/enrollment backend is not implemented.
Audience: Astra, for architecture review and the next implementation specification.

## Requested outcome

The user should connect an existing Claude or Codex chat by asking Brainstorm:

> Connect the Matrix Browser agent strategy thread to this project.

Brainstorm finds the exact chat, enrolls it in its bound project and reports the
actual connection state. A clear request and one unambiguous match should complete
without another confirmation. Asking the user to choose between plausible matches
is clarification, not an extra approval step.

This is project membership and connection setup. It does not authorize sending
work, waking a chat, changing its native workspace or expanding execution rights.

## UI work already applied

- The project title is centered across the full panel with balanced side insets,
  including when voice visuals are active.
- The project header is 22px high. Extra workspace padding and the 3px allowance
  above the active tab have been removed; the tabs remain the content divider.
- Connect has been removed from the main header. Manual **Connect a chat** remains
  available in **Chats**, using the existing setup wizard.

Once conversational enrollment ships, put manual setup under Advanced/recovery
within Chats. Keep membership, readiness, access and reconnect/disconnect controls
visible there. Do not remove the working fallback before the new path is usable.

## Preserve the working Agent architecture

Brainstorm and the ordinary Threadlight Agent now use the same `AgentView`, talk
IPC, Panel voice controller, recorded-speech hook and native Live transport.
`BrainstormAgent` adapts the common Agent client operations to one project and its
selected discussion. It creates a discussion on the first message and preserves
project history and drafts. There is no separate Brainstorm voice hook.

The verified shortcuts are Ctrl+Alt+B for Brainstorm and Ctrl+Alt+Q for the ordinary
Agent. Preserve these, the common conversation UI, the existing STT/GPT Live choice,
and the provider/sign-in requirement for native Live. Add enrollment as a capability
of this Agent; do not create another conversation UI or voice startup controller.

## Existing implementation and the actual gaps

| Existing part                                                    | Reuse and limitation                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/threadRead/service.ts`, provider adapters              | Catalogue search, stable native identity, pagination and evidence coverage already exist.                                                                                                                                                   |
| `src/main/communication/catalog.ts`                              | Searches provider catalogues rather than visible rows. Its current page/result limits and archived filtering must not be mistaken for a complete discovery result.                                                                          |
| `src/main/spaces/context.ts`                                     | Brainstorm's current reader permits only enrolled project members with suitable live grants. It cannot discover a new member through that restricted reader.                                                                                |
| `src/shared/spaceContext.ts`, `src/main/spaces/contextServer.ts` | Brainstorm skills and MCP tool surface are currently read-only. A skill alone cannot perform enrollment.                                                                                                                                    |
| `src/main/memory/connections.ts`                                 | Pending plugin pairing, approval, authentication and revocation exist. Requests expire after five minutes; approved connections expire after eight hours. Connection records are in memory, and plugin-bound grants are revoked on restart. |
| `src/main/memory/store.ts`                                       | Grant storage and audit events exist. `create_grant` is human-only. Do not expose it as a general Agent tool or impersonate a human actor.                                                                                                  |
| `src/shared/projectParticipants.ts`, `ProjectParticipants.tsx`   | Participants and capability reports exist. Membership is currently derived from grants; the UI receives workspace-filtered sessions. Durable/cross-workspace membership needs explicit treatment.                                           |
| `src/renderer/spaces/ConnectionSetup.tsx`                        | The manual flow binds a provider session to an exact chat. Its default is read-only; publishing and communication are additional choices.                                                                                                   |

Project membership and an authenticated provider/plugin session must become separate
concepts. A persisted grant or generated pairing code is not proof that a target
chat has authenticated or can use project tools.

## Product flow

1. Use the project bound to the Brainstorm discussion. Navigation to another page
   must not redirect an in-progress enrollment to a different project.
2. Search metadata in the enabled Claude and Codex catalogues. Include chats outside
   the visible list and the project's workspace. Do not inspect unlinked transcripts
   to decide which chat to enroll.
3. Return bounded candidates with title, provider, native identity, workspace,
   archive state, last activity and explicit coverage/unavailability information.
4. Automatically select only a uniquely identified match. Normalize harmless case,
   punctuation and whitespace differences; fuzzy similarity alone must not select a
   member. Partial catalogue coverage cannot establish uniqueness.
5. For ambiguity, use the existing Agent question/choice UI. Show enough metadata
   to distinguish same-title chats, including matches across providers/workspaces.
6. Revalidate the chosen stable identity immediately before mutation. Handle stale
   or renamed candidates explicitly instead of silently substituting another chat.
7. Persist membership, apply the authorized access policy, and complete an
   authenticated provider handshake wherever the installed integration supports it.
8. Report the exact result and update Chats without a manual refresh.

An already linked chat produces an idempotent "already linked" result, with its
current readiness. Zero matches, disabled providers, incomplete discovery and
unavailable adapters are separate outcomes. Never enable a provider automatically.

Cross-workspace links may supply context. Work delivery retains the existing
workspace/ownership checks. Archived chats may be linked as historical context
where readable; linking does not restore or wake them or make them work recipients.

## Brainstorm skill and host tools

Add a built-in **Manage project chats** skill alongside the existing Brainstorm
skills. It covers discovery, clarification, enrollment and checking the resulting
status. It must treat titles, transcripts, notes and capability descriptions as
untrusted data.

Proposed tool contracts, with final names/schema to be reviewed by Astra:

- `threadlight_find_chat_candidates`: metadata-only search; query, optional provider
  and workspace hints, cursor and bounded limit. Return opaque candidate references,
  candidate metadata, discovery time, coverage and a continuation cursor.
- `threadlight_enroll_project_chat`: an issued candidate reference, a server-issued
  user-intent receipt and an operation ID. The server supplies the bound project;
  the model cannot select an arbitrary project or invent an assignee identity.
- Reuse/extend project context for membership and connection-status queries rather
  than introducing a second participant directory.

Keep discovery authority separate from transcript-reading authority. An enrollment
candidate reference must not become a transcript read capability before membership
and its access policy have been committed. Preserve provider enablement and the
existing exclusions for Threadlight's own coordinator conversations.

Enrollment is an explicit, narrow exception to Brainstorm's read/track/propose
role. It does not expose generic project-file writes, arbitrary grants, messaging,
workflow configuration, task authorization, shell access or delegation.

## Authorization and identity requirements

The host must bind an enrollment to the actual current human request, current
Agent conversation and bound project. A model-supplied quote or boolean such as
"user approved" is not evidence of authorization. Typed input, completed local
transcription and finalized native Live human transcripts must use the same policy.
Partial native speech cannot authorize a mutation.

Astra must specify how the host issues and validates the intent receipt for a
named-chat request. If it cannot confidently bind a candidate to the user's intent,
ask a clarifying question. Do not solve this by granting the Agent human authority
or bypassing the store's human-only grant check.

Use a dedicated enrollment broker to consume that receipt, revalidate the issued
candidate and perform the authorized membership/grant operation. Bind operation IDs
to their payload. Retries after a lost response return the same result; they cannot
enroll an additional chat or create a second grant.

Review both Agent runtimes' tool policies. Brainstorm currently denies broad native
permission escalations. Mark enrollment's mutation honestly in tool annotations.
Do not loosen the planning sandbox to make a tool call succeed. If the provider
runtime cannot support the narrow tool directly, retain model discovery and let
the host commit the explicitly authorized structured selection.

## Persistence, access and readiness

Recommended design: durable project-chat membership, separate from short-lived
authenticated connection grants. Use a unique identity such as
`(projectId, hostId, provider, nativeChatId)`, never a title as the key.

Retain who requested the link, the source request/conversation, operation receipt,
creation time and current metadata. Store credentials only in the existing trusted
host/bridge mechanism, never in Agent-visible results or project documents.

Start with the current read-only connection policy. Publishing drafts,
communication and work authority remain explicit additions. Existing capability
reporting requires project-wide publishing access; do not silently enable writing
just to obtain a report. Astra should decide whether a future narrow metadata-report
permission is warranted. Reported capabilities remain unverified claims.

| UI state     | Required evidence                                                                    |
| ------------ | ------------------------------------------------------------------------------------ |
| Linked       | Durable membership and its context access policy were saved.                         |
| Ready        | The exact intended provider/chat has authenticated its supported project connection. |
| Setup needed | Membership exists but plugin installation, pairing or reconnection is required.      |
| Unavailable  | The provider/chat cannot currently be reached; preserve the known membership.        |

Carry archive, expiry and failure reasons separately. A bridge without a reliable
way to attest the native chat's identity cannot claim automatic authenticated setup.
Keep that case Linked/Setup needed and surface the existing manual recovery path.
Do not insert hidden prompts into another conversation or wake it to pretend that
authentication succeeded.

Persist membership across restarts and grant expiry. Reconnect supported sessions
without duplicating membership. A partial failure must distinguish "membership
saved; setup failed" from "nothing saved". Unlinking revokes applicable access and
invalidates cached read references. Recheck authorization after provider I/O as the
current reader does. Existing tasks/history are not silently deleted or dispatched.

## Delivery sequence

1. Confirm the membership/connection model and human-intent receipt design.
2. Add paginated metadata discovery with honest coverage and stable candidate refs.
3. Add the scoped broker, durable membership and retry/audit behavior.
4. Integrate each provider's authenticated setup, with honest partial outcomes.
5. Add the Brainstorm skill/tool policies and reuse the existing Agent clarification UI.
6. Update Chats for status, reconnect and unlink; demote manual setup to Advanced.

Read the repository AGENTS.md before implementation and preserve unrelated local
changes. See the existing project-participant, shared-memory-plugin, thread-discovery
and thread-communication specs for the surrounding contracts.

## Acceptance checks

- A uniquely identified Matrix Browser strategy chat can be linked from a typed,
  STT or GPT Live request in another project's Brainstorm, with no redundant approval.
- Duplicate names across either provider/workspace produce a choice; incomplete
  search results never produce a falsely unique automatic selection.
- Reading provider catalogues does not expose unlinked conversation contents.
- An untrusted note/transcript asking to enroll a chat cannot mint an intent receipt.
- Forged/stale candidates, wrong-project calls, partial speech and expired receipts
  cannot create membership or access.
- Both providers demonstrate actual identity-bound readiness where supported;
  missing plugins, archived chats and offline providers produce honest status.
- Lost responses, duplicate calls and restarts preserve one membership and do not
  escalate permissions or lose the successful portion of a partial result.
- Unlink/revocation blocks further reads, including an already issued reference.
- Connecting never sends a task/message, wakes a native writer, grants publishing,
  changes the chat's workspace or transfers tools between providers.
- Existing common Agent chat/voice, drafts, history, notes, plans, comparisons and
  reviewed handoffs continue to work. Use isolated fixtures; protect the user's
  running app and complete the repository's required local preflight.
