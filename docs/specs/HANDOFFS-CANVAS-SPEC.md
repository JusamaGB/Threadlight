# Handoffs canvas

29 October 2026. Compact, contextual UI; primary checkout implementation.

The overview projects saved work, never schedules it. A prepared discussion's
explicit taskIds associate legacy tasks with that discussion objective. Workflow
assignments may carry optional objective {id, title}; this is a project-local
association label, not execution authority or a dependency. Old records remain
valid and unlinked work stays under Ungrouped. No title/folder matching.

Solid directed edges mean the destination assignment explicitly dependsOn the
source assignment. Dashed directed edges mean the destination legacy task was
delegated from originTaskId; they do not mean sequencing. Pinned inputs and outputs
remain versioned links in opened details. Folder destinations are storage only.
Submitted, accepted result, native turn finished and unknown delivery remain distinct.

Stable insertion-order slots avoid state-change sorting. Per-space viewport,
selection and collapsed groups survive detail navigation. Empty-space drag pans;
wheel pans vertically, Shift pans horizontally, Ctrl zooms about pointer. Keyboard
arrows pan; +/- zoom; Home fits. Search jumps without filtering or reordering nodes.
Group headers collapse, node buttons open detail, attention jumps to actionable work.

Expanded overlay is temporary square geometry clamped to the current display work
area. It must not write normal panel layout settings or invoke OS fullscreen.
Workflow uses the same overlay control; a workflow editor/engine is out of scope.

Verification is isolated renderer + pure geometry/model tests, focused real-caller
tests, typechecks/build/diff. Live app acceptance is separate; no live records,
installed plugins, running apps or native dialogs are touched.

## Implemented interfaces and limits

`shared/canvas.ts` exports `Viewport {x,y,zoom}`, `initialViewport`,
`zoomAt(viewport,factor,pointerX,pointerY)`,
`fitCanvas(viewWidth,viewHeight,contentWidth,contentHeight)` and
`squareOverlay(workArea,anchor)`. Zoom bounds are 2–200%; Fit never enlarges above
100%. Rows contain up to three task buttons. Status changes do not reorder nodes;
adding work can extend a group and move subsequent groups. Explicit collapse
reflows following groups. Navigation/selection/collapse are retained per space
for this renderer session, not persisted across app restarts.

`shared/handoffs.ts::handoffGraph` is the read-only projection extension point.
`HandoffsCanvas` consumes MemorySnapshot, CommunicationSnapshot and scoped
SpaceIdea discussions. Assignment objective IDs are namespaced separately from
prepared discussion IDs. Future process runs can use their run ID/title as
assignment.objective without changing this canvas; no process definition or run
engine is implemented by this change. The separate Workflow implementation is adding process-run nodes and details
through this extension point; its runtime behavior has separate validation. Other
CommunicationSnapshot fields are ignored.

Native `setCanvasExpanded(boolean)` returns width/height (or null on restore).
Geometry changes carry optional PanelOpened.canvasSize. Expansion stays separate
from saved panelLayout and dot position. Header control is enabled by
SpacesHeader.canvas on Handoffs and Workflow. No complete workflow editor is part
of this implementation.

Historical assignments without an explicit objective remain Ungrouped. The UI
never backfills guessed objectives or dependencies. Association metadata is optional
and travels through the existing proposal/persistence schema; existing authorization
and scheduling validation remains authoritative. Missing/out-of-space dependency
endpoints are not drawn; the assignment details retain the recorded IDs.

Receipt truthfulness: CommunicationSnapshot.assignmentDeliveryPhases projects
current phases for each permitted assignment independently of the 50-message
history page. The canvas uses that evidence before its paginated message fallback,
so an old unknown receipt does not become apparently ordinary blocked work.
