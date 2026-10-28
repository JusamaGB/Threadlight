# Hold shortcuts and mouse navigation

- Hold Control: hide the floating dot and attention decoration as native windows,
  allowing clicks on anything behind them. A periodic keep-on-top refresh must not
  bring the dot back while Control remains held.
- Hold Control+Alt: temporarily show the Active list without taking keyboard focus.
  It is a read-only, click-through preview. The existing page and its drafts stay
  mounted underneath. Releasing Alt returns to the Control-hidden state; releasing
  Control returns to normal, including when Alt was pressed first.
- Releasing the chord restores an already open page and its pinned/window state.
  If the panel was closed, return to the normal dot. Shortcuts do not change saved
  settings, start a microphone, send text or interrupt running work.
- Poll only modifier state using the existing Windows key-state reader. Do not
  register Control or Alt globally or swallow another app's keyboard shortcuts.
  Suspend the stepper during shortcut capture and tray Pause. Unavailable key state
  and application shutdown restore normal behavior.
- The talk shortcut takes priority over the modifier preview (including the default
  Control+Alt+Q). Yield until Control is released, so recording uses its existing UI
  and a held prefix cannot reopen the preview over it.
- Mouse buttons 4/5 (back/forward) navigate UI history in the panel. Support native
  Windows browser app commands and DOM mouse events, deduplicating the same physical
  event. Bound each history to 64 locations; a new route after Back drops Forward.
- Nested Shared Spaces/handoff routes, historical Agent reading, selected artifact
  previews and opened file diffs navigate before the containing page. Boundary
  presses do nothing. Restore UI state only; never replay saves, sends, approvals,
  workflow operations or settings mutations. Ordinary on-screen Back preserves Forward.
- In the artifact viewer, unmodified Left/Right select the previous/next artifact,
  using the existing arrow controls' wraparound. This also works with a focused HTML
  preview. Preserve arrow keys inside text fields, editable content and sliders;
  ignore navigation while loading, with one artifact or while the viewer is hidden.

Validation covers modifier transitions and release order, pause/dispose/unavailable
state, native visibility/focus/click-through and pinned Workspace restoration, real
renderer history and nested pages, draft survival, and compatibility with existing
talk hotkeys and window hover behavior.
