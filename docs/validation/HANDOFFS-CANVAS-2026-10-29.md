# Visual Handoffs — isolated validation

> Public copy: local proof paths and native identifiers are generalised; raw evidence remains private.

Started 29 October; completed checks 30 October 2026, Europe/London.
Primary checkout: `C:/dev/threadlight`. No push, PR, commit or live reload.

## Implemented

- Objective groups use explicit prepared-discussion task IDs or optional assignment
  `objective: {id,title}`. Historical unlinked work stays Ungrouped. No migration,
  guessed title/folder associations, new dispatch authority or automatic completion.
- Up to three nodes per row, group collapse, full detail navigation, assigned
  chat/provider, state and output destination. Submitted, accepted result, delivery
  accepted, finished turn and unknown delivery have distinct labels.
- Explicit dependency arrows and dashed delegation arrows. Pinned versions open
  through existing MemoryView readers; source links open the prepared discussion.
  Assignment briefs/acceptance/inputs/results open in the canvas detail view.
- Empty-space drag, vertical wheel, Shift-wheel horizontal pan, pointer-anchored
  Ctrl-wheel zoom, keyboard arrows/+/-/Home, Fit, reset, search and attention jumps.
  In-session per-space viewport, selected node, group order and collapse retention.
- Top-left expand/restore on Handoffs and Workflow, bounded by the actual native
  display work area (up to 900px square). No fullscreen or saved layout writes.
  Existing panel hover and geometry machinery remains in use.
- Folders and existing create/authorize/retry/reconcile/pause/cancel/review/access
  controls remain reachable. The folder section retains its open state across forms.

## Evidence

| Check                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projection and relationship semantics | `test/handoffs.test.ts`: explicit groups only, cross-project endpoint exclusion, delegation distinct from dependency, submitted/unknown/accepted/finished-turn labels, optional metadata compatibility                                                                                                                                                                                                                                                  |
| Geometry and input math               | Pointer anchor invariant, zoom bounds, fit, small negative-coordinate work areas; mocked WindowManager expand/restore in single/dual and secondary displays                                                                                                                                                                                                                                                                                             |
| Real assignment caller                | `test/communication.test.ts`: proposal persists objective metadata without adding dependencies or dispatch; existing authority and delivery tests retained                                                                                                                                                                                                                                                                                              |
| Focused backend suite                 | 81 passing tests across handoffs, windows, communication and communicationIntegration, including receipts older than the message history page                                                                                                                                                                                                                                                                                                           |
| Renderer product check                | `THREADLIGHT_UI_FOCUS=handoffs-canvas`: two objectives, parallel work across both provider chats, long title/full brief, waiting/blocked/unknown/submitted/accepted, empty and 119-node views, foreign-project exclusion, live updates without viewport reset, search/collapse/attention, drag/wheel/Shift/Ctrl, keyboard, pinned output read, legacy task detail, prepared discussion source, no navigation dispatch, Handoffs/Workflow expand/restore |
| Existing real-store UI                | `memory-security`: folder map/list, notes, persistent drafts, stale edit rejection, tasks, pinned readers, short panel and no provider sends                                                                                                                                                                                                                                                                                                            |
| Navigation regression                 | `input-navigation`: native/mouse Back/Forward, nested Shared Spaces forms, Active peek, wire home and saved single/dual layout                                                                                                                                                                                                                                                                                                                          |
| Build/static checks                   | Production build and focused ESLint pass. Diff whitespace check passes. Full Node and renderer typechecks pass on the final integration check                                                                                                                                                                                                                                                                                                           |

Commands use the existing Playwright installation:

```powershell
$env:THREADLIGHT_PLAYWRIGHT='C:/tools/node_modules/playwright'
$env:THREADLIGHT_UI_FOCUS='handoffs-canvas'
$env:THREADLIGHT_SCREENSHOTS='C:/dev/threadlight/test/ui/handoffs-canvas-proof'
node test/ui/providers.smoke.mjs
```

Inspected actual compact and square screenshots:
`test/ui/handoffs-canvas-proof/handoffs-compact.local.png` and
`test/ui/handoffs-canvas-proof/handoffs-square.local.png`.
Storage and navigation screenshots are in `handoffs-storage-proof` and
`handoffs-navigation-proof`. These ignored local artifacts contain synthetic data.

## Limits and integration

Viewport state is retained for the renderer session, not across app restart.
New work can extend a group's rows and shift following groups; state changes do
not sort or rearrange nodes. Fit obeys the 2–200% zoom bounds; very large overviews
need search/attention jumps to read individual nodes. Historical records are not
automatically assigned objectives. No complete workflow editor or engine belongs
to this change; that is being implemented separately in the shared checkout.

An intermediate whole-repository typecheck caught a concurrent Workflow test
helper's overly narrow inferred ID type. That parallel edit was corrected; the
final full Node+renderer typecheck passes. The separate Workflow implementation
also adds a process-run projection/detail extension to this canvas; its behavior
and runtime authority require its own validation. Do not attribute that engine or
editor to this Handoffs evidence.

The native geometry tests mock Electron. No actual Electron window, native dialog,
live provider, installed plugin refresh or user shared-space mutation was used.
Screenshots use the real compiled renderer with synthetic IPC and disposable stores.

## Load later

When Kris ends the current live test, launch/restart the rebuilt primary Threadlight
app, open the intended Shared Space and select Handoffs. Use its top-left arrow to
inspect the square view, then restore. This session did not restart Threadlight or
ChatGPT. Existing data needs no migration. New assignment callers may use the
optional objective metadata after refreshing their runtime tool schema through
their normal reconnect path. Existing plugin caches were left untouched.

Live acceptance of monitor transitions, actual mouse/trackpad feel, hover behavior
and real project work remains user-led. Isolated checks are not that acceptance.

Documentation updated: Unreleased, README, SHARED-MEMORY guide,
HANDOFFS-CANVAS-SPEC, this validation, UI test guide and the single ongoing
brainstorm test working record.
