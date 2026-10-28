# Workspace wires in single and dual view

## Routing

Wires connect at least two listed threads with the same normalized workspace
folder. Use the existing exact folder identity, including Windows case and separator
normalization; separate worktrees and unknown folders remain separate. Threads
below the scroll viewport still count until removed from the list.

| View          | Listed group members     | Wire location                               |
| ------------- | ------------------------ | ------------------------------------------- |
| Single column | Any provider combination | Outside the card on the left                |
| Dual columns  | Claude only              | Outside the Claude column, left of the card |
| Dual columns  | Codex only               | Outside the Codex column, right of the card |
| Dual columns  | Claude and Codex         | Along the centre divider                    |

Classify the whole group before placing any wires. Draw one route per group;
never split a shared group into separate provider routes. Reclassify when the
listed membership changes. Groups with fewer than two members have no route.

## Geometry and interaction

- Keep the 475px card, two 236px columns, divider and thread text widths. Reserve
  the 16px left gutter for the header clip. Fit the right gutter to the outermost
  right rail plus 2px for its backing stroke: 6px for one lane, 10px for two, up to
  16px. With no right routes, hidden wires or no thread list it is zero. Size both
  the renderer and native window from this measurement. Single view remains a
  238px card with its 16px left gutter.
- Outer groups use independent lane allocation on each side: longest overlapping
  groups closest to the card, shorter groups farther out, disjoint groups reusing
  lanes. Mirror the left route for the right gutter; branches point inward to the
  Codex card edge. Neither side consumes lanes at the divider.
- Shared groups retain the existing three centre slots, short spikes toward each
  member's column, rounded ends and branch fillets. Allocate these slots only among
  shared groups. Routes must stay out of the thread text.
- Measure actual row anchors and list bounds after expansion, nested-row changes,
  scrolling, resizing and layout changes. Clip wires vertically to the thread list.
- Preserve muted grey wires, stable group colours, hover/focus/click tracing,
  dimming of unrelated threads, Escape dismissal, and the single header toggle.
  The toggle stays at the left of the header. Decorative wires intercept no clicks.
- Both transparent gutters pass clicks through. Only the left header toggle and
  existing explicitly registered interactive regions intercept them. During layout
  animation retain the existing temporary click-through suppression.
- Keep the card's right edge aligned with the dot when space permits; the right
  gutter extends beyond it. Clamp the complete window, including both gutters,
  to the display work area. On narrow displays subtract both gutters before sizing
  the dual card. Entering or leaving dual view must reserve/remove the extra gutter
  in step with the existing native-window and card animation sequence.
- Workspace can reach the exact top and bottom of the display work area when
  dragged or resized; it has no forced 8px screen margin. Other views retain their
  existing dot-relative height rules.
- The routing applies to Recent and Workspace dual lists. Active, a disabled
  provider, and narrow subpages retain their existing single-column behavior.
  No list means no wires. Disabling wires removes all three sets of routes.

## Implementation map

- `src/shared/workspaceWires.ts`: group classification, per-zone lane allocation,
  mirrored outer paths and existing centre geometry.
- `src/renderer/panel/WorkspaceLinks.tsx`: measure the listed members and render
  routes at the left edge, divider or right edge within one non-interactive overlay.
- `Panel.module.css` and `Panel.tsx`: reserve the right gutter with the wide window.
- `src/main/windows.ts`: native window width, display clamping and gutter hit testing.

## Validation

Focused unit tests cover simultaneous exclusive/shared groups, independent lane
allocation, mirrored geometry, membership changes, single-view fallback and small
or invalid groups. Native-window tests cover both gutters, toggle hit testing,
display clamping and layout changes. Isolated renderer checks exercise the real
Recent and Workspace lists with all three group types, highlighting, expansion,
scrolling, membership changes, wire toggling, single/dual transitions and reduced
motion. Check normal animated transitions as well as settled geometry, then run
focused lint, type checking, diff checks and the production build.
