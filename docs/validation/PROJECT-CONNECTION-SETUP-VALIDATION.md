# Project connection setup validation

29 October 2026. Primary checkout implementation; not a live release.

- Plugin generated assets match their canonical sources.
- Focused ESLint, TypeScript and production build passed.
- connectionSetup and memoryPlugins: 20 tests passed, including both provider
  bridges carrying the supplied native chat ID without granting access.
- Isolated browser connection-setup check passed using real memory and
  communication stores with synthetic provider/session boundaries.
- UI covers the open-space shortcut, cross-folder legacy selection, no-match
  recovery, exact-ID selection without a second picker, missing-ID recovery,
  cleared confirmation on request switch, read-only defaults, lost approval
  response, partial workflow retry and a correctly linked decision-card request.
- Both legacy and identified request paths save grants for the intended chat and
  current space. Automatic workflow policy is not enabled by setup.
- Narrow-panel screenshots inspected for identified and legacy flows; actions
  remain visible below the scrollable content.

The regular app was not restarted and installed plugin caches were not replaced.
A restart loads the app fix. Refresh/reconnect the plugin to use the new optional
chatId argument. Existing plugin versions can use the corrected manual fallback.
Live enrollment remains a user-run acceptance step; no real grant was approved.

Specification: [project connection setup](../specs/PROJECT-CONNECTION-SETUP-SPEC.md).

## Chats request-list iteration — 29 October 2026

The Chats tab now starts with connected chats and a counted Requests section only
when unexpired requests exist. The empty state is “There are no connected chats.
Ask a chat to request if needed.” Selecting a request opens code confirmation and
permission choices together; the separate Connect a chat entry, request dropdown,
and wizard steps are removed. Capability controls and guidance are collapsed
inside each chat. Revoked grants no longer leave a chat in this connected list.

- Focused ESLint, web TypeScript, production build, generated-plugin consistency,
  and diff checks passed.
- Isolated connection-setup UI check passed: live request counts, cross-folder and
  exact-ID matching, explicit code confirmation, read-only defaults, lost-response
  and partial-workflow recovery, approval removal from requests, expiry without a
  subsequent backend event, and revoked-chat removal.
- Isolated project-participants UI check passed: capability reports, human evidence,
  lost-response retry, scoped Brainstorm context, assignment suggestions, reviewed
  draft handoffs, revocation, and narrow-panel fit.
- Narrow-panel screenshots inspected for the request list and combined review.

These checks use isolated stores and synthetic provider/session boundaries. The
running regular app was not restarted; the built changes need the next coordinated
restart. No live connection was approved by this implementation check. Updated
README, shared-memory guide, connection specification, changelog, and canonical
and generated plugin connection guidance.

## Request screen cleanup — 29 October 2026

This later iteration replaces the earlier read-only default and optional
communication setup described above. At Kris's request, approval now grants
space-wide read-and-publish access (`readOnly: false`), with folder creation and
delegation still disabled. The resolved chat title appears once. Removed repeated
identity/access copy, publishing and communication checkboxes, model entry,
decision-card testing, the extra footer back button, and the success/Done step.
The header back control remains; successful approval returns directly to Chats.
Existing communication workflows are not configured or altered by this screen.

Focused ESLint, web TypeScript, formatting, production build, plugin consistency,
and diff checks passed. The isolated connection-setup browser check passed with
real memory stores and synthetic provider sessions. It covers header back,
exact-ID and cross-folder matching, one code-confirmation checkbox, explicit
approval gating, lost-response recovery without duplicate grants, actual note
publication through the approved grant, unchanged workflow settings, expiry,
and revocation. Inspected the narrow-panel identified-request screenshot.

README, shared-memory guide, Codex plugin README, connection spec, and changelog
were updated. No regular-app restart or live enrollment approval was performed;
this built screen will load on the next coordinated restart.

## Project-bound discovery follow-up — 29 October 2026

The earlier current-space/legacy fallback behavior is superseded by
[project discovery validation](PROJECT-DISCOVERY-VALIDATION.md). New requests carry
an immutable Shared Space ID; older destinationless requests must be recreated.
Both packaged providers and two-project renderer visibility are covered there.
