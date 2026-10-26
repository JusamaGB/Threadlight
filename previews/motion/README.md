# Motion previews

Saved from the generative-motion chat on 26 October 2026. These are standalone
design previews, not a desktop overlay or an application feature flag.

- `/` compares the production gold shine with the latest vibrant Claude-orange
  wheel and glossy Codex-blue outward shine, including actual-size indicators,
  scrubbing, slow motion and reduced motion. The active-wheel colour treatment is
  now also used by the application's dot and connected header.
- `/needs-input.html` demonstrates a minimized Threadlight indicator collecting
  liquid inside the wheel, pausing for 250 ms, releasing a drop and splashing on
  the simulated taskbar. Provider colours follow Codex blue and Claude orange.
  Opening the simulated app or clearing its input requirement stops the effect.
  The production overlay now shares its provider colours and deterministic physics.
- `/idle.html` compares the static resting waveform with a warm centre and blue
  halo that gently breathes every 6.4 seconds. Reduced motion holds it steady.
- `/connected-header.html` previews the production wheel against the left wall on
  its divider, its rightward stretch and the expressive, evolving voice ribbon.
  Controls switch states, vary voice energy and scrub the connected morph without
  opening a microphone or interacting with the installed application.
- `/workspace-links.html` is a proposal using sample threads. Thin wires connect
  listed Claude and Codex threads with the exact same normalized workspace folder.
  Hover/focus traces a group; preview buttons hold that trace, switch list filters,
  reorder rows and compare separated wires with a shared rail in the 16px strip
  outside the panel. Thread content keeps its original width.
  Clicking sample rows expands them. Separate worktrees and unknown folders stay
  unlinked. This proposal does not add workspace wires to the application.

From the repository root, run `node previews/motion/serve.mjs`, then open the
loopback URL it prints. The default port is 5179; `THREADLIGHT_PREVIEW_PORT` can
select a free port. Stop the server with Ctrl+C.

Run `node node_modules/typescript/bin/tsc -p previews/motion/tsconfig.json` for the
preview type check. With Playwright and Chromium installed, run these in order:

```text
node previews/motion/verify.mjs
node previews/motion/verify-drip.mjs
node previews/motion/verify-smoothness.mjs
node previews/motion/verify-provider-colours.mjs
node previews/motion/verify-idle.mjs
node previews/motion/verify-header.mjs
node previews/motion/verify-workspace-links.mjs
```

The scripts use local Playwright or `THREADLIGHT_PLAYWRIGHT`, matching the app's
browser checks. `THREADLIGHT_PREVIEW_URL` selects a server on another port.
Synthetic screenshots and filmstrips go under ignored `screenshots-local/` by
default, or `THREADLIGHT_SCREENSHOTS`. `original-geometry.ts` preserves the
comparison baseline. The preview does not control an installed application,
microphone, account, user files or the Windows taskbar.

## Workspace wires preview and application integration

This page remains a sample-data preview; the approved outside-gutter design is
also implemented in the application. Its grouping uses
the existing `workspaceFolder` comparison across provider-owned paths. Equal
folder/worktree paths connect regardless of provider, slash direction, Windows
extended-path spelling or case. A different worktree, an unrelated folder with the
same name, or an unknown folder must not be joined by a shared Git repository.

The proposed renderer is one SVG outside the card with a rounded rail per
workspace and short branches to each context-wheel gutter. It keeps the list's
order, reuses non-overlapping lanes, and follows measured row positions after
expansion, scrolling, sorting and resizing. A viewport aligned with the scroll
area clips wires above and below the listed rows while leaving them outside the
card's left border.
Provider gradients, context progress, parent/child guides and existing row actions
keep their separate meanings. Hover or keyboard focus emphasizes one workspace;
the preview's legend can hold a trace for inspection.

The application derives groups from the rows already listed and follows their
measured positions without intercepting existing controls. Focused browser checks
cover mixed providers, filtering, unknown paths, expansion and scrolling.
The proposal uses the 300px card and adds a 16px transparent gutter on its left.
Three external lanes can be reused by overlapping groups; the highlighted route
paints last. A shared-rail toggle demonstrates all groups using the same line.
Neither mode consumes title or status space inside the card.

The application now reserves that transparent gutter inside its native window
bounds, keeps the card's right edge anchored to the dot, and passes gutter clicks
through except for the small header U-clip. Wires default off; the gently sparking
cut clip reconnects them, and the application saves the choice. Reduced motion
keeps the spark still. The first rail is four pixels outside the card, with
overlapping routes stepping outward. Native window tests cover positioning,
dragging, pin/leave behaviour and hit testing. This standalone preview still does
not control the installed application.
