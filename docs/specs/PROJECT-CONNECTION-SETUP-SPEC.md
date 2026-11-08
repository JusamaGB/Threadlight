# Project connection setup

Date: 29 October 2026. Scope: manual connection setup; notifications excluded.

## Problem and existing logic

SharedSpacesView already has the exact opened space, but ConnectionSetup asks for
it again. The caller passes workspace-filtered sessions, excluding chats started
elsewhere (including projectless Codex chats). A pending request contains a label
and code, not necessarily a native identity, so finding a request does not by
itself identify its chat. The empty chat picker blocks access review.

## Implementation contract

1. The Chats tab lists connected chats and a Requests (count) section only when
   unexpired requests are waiting. With no connected chats, show: “There are no
   connected chats. Ask a chat to request if needed.” Remove the Connect a chat
   entry, onboarding copy, and request-picker wizard. Selecting a request opens
   code confirmation and access review on one page, bound to the stored request
   spaceId. Requests are filtered to openedSpace. Switching
   requests or spaces remounts review and clears its state. Capability guidance
   stays inside each chat's collapsed details. Revoked access leaves the list.
2. Allow memory_connect to supply the current native chat UUID as optional chatId.
   Carry it through the bridge and pending connection metadata. Never infer it
   from a shared MCP process environment, a title, or a sole available candidate.
3. Resolve that UUID against available sessions from the requesting provider,
   including sessions outside the space's source folder. Display the exact chat
   directly. Identity is requester-supplied and human-reviewed, not provider proof.
4. For project-bound requests without a native identity, offer searchable provider
   chats across folders. A supplied unavailable identity must be opened in its
   provider; do not substitute a different chat. Destinationless requests require
   a fresh request from an updated plugin. Include title, folder and stable ID to distinguish duplicates.
   Explain missing matches and how to recover. Never silently link a different chat.
5. Require code confirmation and explicit approval of standard read-and-publish
   access. Show the resolved chat title once, its verification code, a short scope
   explanation, and Approve. No redundant access heading, title repetition,
   publishing checkbox, decision-card setup, or footer back button. The header
   back control remains available. Success returns directly to Chats. Preserve
   existing workflow policy, expiry, revocation, and lost-response recovery.
   This screen does not configure communication, folder creation, or delegation.
6. Keep the existing discovery boundary: this picker uses monitored sessions, not
   a complete provider archive. Broader catalogue discovery remains separate work.

## Acceptance evidence

- No shared-space selector or Continue step from an already opened space.
- Requests arrive and expire in place; approval removes the request from the count.
- Code confirmation and a read-and-publish scope explanation share one approval page.
- A legacy request can link an available chat from another working folder.
- A request with an exact native ID shows that same chat without a second picker.
- Switching requests clears code confirmation; zero search matches have guidance.
- No grant before human approval; retries preserve one grant and workflow policy.
- Both provider bridges round-trip chatId; an ID alone grants no access.

Automated evidence belongs to the focused connection setup UI and memory plugin
tests. These use isolated stores and synthetic provider boundaries. Production
builds and packaged plugin assets require reload before a live retry; no live
enrollment or live-provider success is implied by automated checks.

## Project discovery before enrollment (29 October 2026)

Both packaged providers now expose `memory_list_projects` before chat enrollment
through the existing authenticated local transport. It returns only eligible
Threadlight Shared Space `{id, name}` identities. Eligibility uses the same
registered workspace/space location checks as Shared Spaces; unassigned legacy
spaces and unavailable locations are omitted. Workflow pause/budget controls govern
dispatch, not whether a human can connect a chat.

The chat matches the project named by the user and sends `memory_connect` its
stable `spaceId`, label and native `chatId` when known. Duplicate names, no match or
ambiguous intent need a short clarification using names/IDs. Names are untrusted
data; foreground state, chat title, filesystem paths and Codex project IDs never
choose the destination. Supported project-launched callers may carry an already
known Shared Space ID; this adds no launch or automatic enrollment mechanism.

Requests bind the destination immutably. Chats → Requests shows only requests for
that project. Review displays the requested project without a second project
picker. The backend rejects a different project or a different supplied native
chat, even if renderer inputs change. Human code matching and approval remain
required. Status and approval-wait responses carry the same space ID and current
name; rename preserves identity, while deleted/unavailable targets fail closed.
Discovery never returns notes, filenames, paths, assignments, credentials or briefs.
Post-approval access remains limited by the granted project/folder permissions.

Compatibility: older clients without `spaceId` receive an actionable error and
must update, discover and request afresh. Destinationless pending requests cannot
be approved or silently retargeted. Requests are process-local and app restart
expires them and revokes their ephemeral grants. A missing native chat ID still
allows explicit human chat selection; a supplied native ID cannot be substituted.
Changing destination requires a new request, not a retry of an existing ID.

This supersedes earlier guidance that approval uses whichever project is open.
The primary checkout implementation is not an installed-plugin reload or release.
