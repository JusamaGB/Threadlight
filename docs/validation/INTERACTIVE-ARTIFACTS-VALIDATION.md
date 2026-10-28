# Local interactive artifact validation

Date: 2026-10-28. Scope: self-contained local HTML in the existing dual-width viewer.

## Dark-only appearance

Threadlight's native theme is fixed to dark at startup, independently of Windows.
The panel, interactive preview and static fallback declare a dark-only color
scheme. Preview defaults supply the dark page background, text and typography,
plus the dotted preview surface used by Codex mockups. Authored layout and literal
content colours remain intact; adaptive `light-dark()` colours and native controls
select their dark variants. No light/system theme selector is introduced.

The native smoke passes computed dark colour checks, dotted-background rendering,
and an attempted document-level light color-scheme override, along with the
existing interaction and isolation checks. The user's actual mockup was checked
in the isolated native viewer for dark panel/text/page colours and working Play
and Disconnect controls. A browser render with a light OS preference was visually
inspected and still shows the requested dark appearance.

The linked original includes its dark appearance directly, so Refresh updates it
in the currently running build. Shared viewer/startup changes require the next
application build and restart. Full-project typechecking passed earlier in this
session, but a later run encountered invalid-character errors in concurrently
edited threadTimeline files; no final full-project build/restart is claimed here.

## Implementation

- A separate sandboxed WebContentsView with an ephemeral session, no preload and no
  Node or Threadlight bridge. The panel retains its original CSP and static fallback.
- Source is reread through the existing thread/artifact-ID checks. A session-specific
  protocol serves only that selected document from memory; no filesystem mapping,
  listening server or persistent artifact-body copies.
- Inline scripts/styles and embedded media are allowed. CSP, main-process request
  checks, denied permissions/downloads/popups and navigation handling constrain the
  guest. A trusted prefix locks WebRTC constructors before artifact scripts execute.
  DNS prefetch is disabled. The Connection-Allowlist header is additional protection,
  not a tested enforcement dependency in this Electron build.
- Selection, Refresh and Back dispose the old guest; Escape reaches the host controls.
  Renderer failure or attempted external navigation gives a static fallback.

## Checks

- Artifact storage/discovery: 12 focused unit tests passed.
- Native Electron fixture exercises a counter, range slider, canvas pixels and CSS
  animation; changed source on Refresh; explicit copies after original deletion;
  cross-thread rejection; square stage and disposal when leaving.
- Isolation checks cover absent Node/require/Threadlight APIs, persistent storage,
  external/loopback/file fetches, workers, popups, WebRTC aliases and attempts to
  restore them through property replacement, a blank iframe or document replacement.
- Navigation fallback, guest Escape, reopening with fresh state, and closing an
  infinite-loop guest are included in the native smoke.
- Browser smoke covers the retained static HTML/text/image fallback and row layout.

All listed checks passed, along with focused ESLint, TypeScript checking, formatting,
production build and diff whitespace checks. The visible native fixture was inspected
with a window capture: the counter, slider, animated text and canvas rendered in the
artifact stage. The normal Threadlight process was confirmed to have started after
the current main/preload/renderer build, and its local status endpoint responded.

The native fixture uses an isolated profile and synthetic originals. This is not an
audit of every possible browser escape, nor evidence of cloud authentication or
React component compatibility. Runtime limits remain 5 MiB and self-contained HTML;
external libraries/assets, provider services and persistent artifact browser state
are outside this step.
