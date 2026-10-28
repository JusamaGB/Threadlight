# Shared Spaces guided connection setup

The entry point lists existing spaces and their locations. An empty library asks
the user to create a space. **Create a space** asks for a name and workspace;
workspace selection is not present on the landing screen. Opening a space exposes
**Connect a chat** and flags pending requests without another header icon.

New spaces live at `<workspace>/shared-spaces/<space-name>/`, containing
`space.json`, `README.md`, `ideas/`, `plans/`, `handoffs/` and `results/`.
The versioned identity file binds the folder to its space and workspace IDs.
The local SQLite registry retains locations across restarts; database v2 is backed
up before the v3 registry upgrade. Existing workspace layouts remain listed and
are not moved automatically. Unknown existing folders are never adopted or
overwritten merely because their names match.

Ideas carry their own space ID. Captures, plans, memory snapshots and assignment
results resolve through that space's folder mapping. Two spaces may share a
workspace without sharing their captured ideas or output folders. Missing identity
files and redirected folders make a space unavailable rather than redirecting
writes. Database history and permissions remain in Threadlight's existing stores;
the on-disk Markdown files are immutable snapshots, not a second editable database.

The guide has three steps: choose a space, match a plugin request and link the
chat, then review access. Requests update from existing memory subscriptions.
Only the requesting provider's chats in the selected project are offered. The
human must explicitly match the code and approve. Publishing and communication
are unchecked initially. Communication explains its required project-wide write
access, while folder creation and delegation remain ungranted.

Approval uses the existing local human APIs. Communication configuration preserves
other participants, models, roles and workflow policy; a new workflow starts manual
and paused. Lost approval responses are reconciled against the exact connection's
saved grant before retrying. Partial communication failures keep a visible retry.
The completion screen offers a test prompt to copy into the linked chat; it does
not claim a completed live round trip or send a message automatically.

Connected chats show connection status and publishing access. Advanced access
management remains inside the existing space's Agent access screen. Restarting
Threadlight still requires fresh plugin enrollment; old codes are not reused.

Validation: two focused policy-preservation tests; isolated connection setup UI
with real stores and service, including lost approval response, communication
failure/retry, exact chat linkage and an admitted tool question. Existing memory
and Shared Spaces navigation UI checks pass. TypeScript, focused lint, formatting,
diff checks and production build pass. Screenshots were reviewed at the normal
238-pixel panel width; navigation actions remain visible below scrollable content.
