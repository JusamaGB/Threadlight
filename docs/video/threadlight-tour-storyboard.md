# Threadlight tour: visual script

A 52 second walk through the app: 48 seconds of product plus a 4 second end card. Every
picture comes from the storybook (`npm run storybook`), which drives the real panel with an
invented working day, so nothing private is on screen. Frame names below are files in
`storybook/frames/`.

**The one idea:** you have a lot of AI threads open, in two apps. Threadlight is the small
thing in the corner that shows you which need you, lets you answer without switching, and
shows how they connect.

**Look and pace.** Dark desktop wallpaper, blurred and darkened, behind the panel. The panel
is the hero and is always large (zoom the frame to fill about 70% of the height). Every shot
has one thing to look at, marked with a soft highlight ring. Hard cuts on the beat, with a
120 ms crossfade only where noted. Captions are one short line, bottom third, 24 px or larger.
Voice-over is optional; the captions carry the film without sound.

## Shot list

| #   | Time      | Scene and frame                                       | What the viewer sees                                                                                   | Camera and highlight                                                                                  | Caption                                            | Voice-over                                                                                  | Move on                                                                |
| --- | --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | 0:00–0:03 | `01-dot-idle.png`, then `01-dot-working.png`          | A swirl in the screen corner, then the same swirl moving                                               | Corner of a desktop. Start wide, push in 3x on the dot. Swap the frames at 0:01.5                     | "A dot in your corner"                             | "Threadlight lives in the corner of your screen."                                           | Dot grows into the panel: scale the dot up while crossfading to shot 2 |
| 2   | 0:03–0:07 | `02-active.png`                                       | Active list: working and waiting threads, Claude and Codex together                                    | Hold the whole card. Ring around the header count "Active · 6"                                        | "Every thread that needs you"                      | "It lists every thread that is working or waiting, in Claude and Codex."                    | Cut                                                                    |
| 3   | 0:07–0:10 | `03-hover.png`                                        | Hovering a ring shows its detail in the strip at the bottom                                            | Zoom to the bottom third of the card; ring around the info strip                                      | "Hover for the detail"                             | "Hover anything to see what it means."                                                      | Cut                                                                    |
| 4   | 0:10–0:15 | `04-expand.png`                                       | One thread opened: plan, current step, background task                                                 | Slow push-in on the plan checklist. Ring on the step in progress                                      | "Open a thread in place"                           | "Open a thread to see its plan and the step it is on."                                      | Cut                                                                    |
| 5   | 0:15–0:19 | `05-needs-input.png`                                  | A thread asking which pricing layout to build, with options                                            | Ring on the question card, then the answer button                                                     | "Answer without switching apps"                    | "When a thread asks you something, answer right here."                                      | Cut                                                                    |
| 6   | 0:19–0:22 | `06-menu.png`                                         | Right-click menu: Compose, Open in Claude, Ignore                                                      | Ring on "Ignore"                                                                                      | "Right-click for more"                             | "Right-click to write to a thread, or set one aside."                                       | Cut                                                                    |
| 7   | 0:22–0:25 | `07-recent.png`                                       | Recent list with branches, commits to push, pull request badges                                        | Pan down the card slowly. Rings on a branch badge and a PR badge                                      | "Everything from today"                            | "Recent shows branches, unpushed commits and pull requests."                                | Cut                                                                    |
| 8   | 0:25–0:30 | `08-wires.png`                                        | Workspace list; one wire lit, other threads dimmed                                                     | Hold. Ring on the lit wire. Dimmed rows are the point                                                 | "Wires join threads in the same repo"              | "Wires join threads that work in the same repository. Hover one and the rest fade."         | Crossfade 120 ms; the card widens in shot 9                            |
| 9   | 0:30–0:34 | `09-dual.png`                                         | Wide panel: Claude on the left, Codex on the right                                                     | Animate the card widening from 238 px to 475 px if the editor can, otherwise cut. Ring on the divider | "Claude and Codex, side by side"                   | "Dual view puts Claude and Codex side by side."                                             | Cut                                                                    |
| 10  | 0:34–0:40 | `10-dual-wires-api.png`, then `10-dual-wires-web.png` | The wire runs down the middle, joining Claude and Codex threads in one repo; then another group lights | Hold on the first for 3 s, cut to the second. Ring on the centre wire                                 | "Wires run down the middle"                        | "In dual view the wire runs down the middle, linking a Claude thread to its Codex partner." | Cut                                                                    |
| 11  | 0:40–0:45 | `11-agent.png`                                        | The Brainstorm agent has read two threads and drafted messages                                         | Push in on the last agent message. Ring on the "Hold both, or send?" line                             | "Ask one assistant to coordinate"                  | "Ask the agent to work across threads. It drafts, you decide."                              | Cut                                                                    |
| 12  | 0:45–0:48 | `12-settings.png`                                     | Settings: apps, thread count, hover help, voice                                                        | Slow zoom out                                                                                         | "Set it up your way"                               | "Choose what it shows and how it helps."                                                    | Fade to the end card, 300 ms                                           |
| 13  | 0:48–0:52 | End card (no frame)                                   | Logo swirl, name, one line, the repository address                                                     | Centre. Hold 3 s, fade out 1 s                                                                        | "Threadlight" and "Your AI threads, in one corner" | "Threadlight. Open source, for Windows."                                                    | End                                                                    |

## What each shot proves

The film should leave a viewer able to say four things: it watches Claude and Codex together
(shots 2, 7, 9), it tells me which thread needs me and lets me answer (4, 5), it shows how
threads connect (8, 10), and an assistant can coordinate them (11).

## Transitions in one line

Dot to panel is the only designed move (shot 1 to 2). Everything else is a hard cut on the
beat, because the screens are dense and the viewer needs the full time to read them.
The 8 to 9 crossfade and the 12 to end card fade are the only exceptions.

## Not in the storybook, so shoot from the real app

- **The dot's swirl and drips** (shot 1, and the needs-input drips on the corner). They are
  live animations. Record 3 seconds of the real dot at 4x, once working and once needing input,
  and use that clip in place of the two still frames.
- **Shared Spaces** (the brain icon). Needs the real stores. A 4 second shot would go between
  shots 11 and 12 ("Ideas shared across threads"). Not included in the 48 seconds above.
- **Voice** (open mic, the mic pill). Needs a live microphone. Optional 3 second shot.

## Making the frames

```
npm run build
npm run storybook          # frames in storybook/frames/, contact sheet in index.html
STORYBOOK_SCALE=3 npm run storybook   # crisper, if the film is 4K
```

Each frame is a tight crop of the panel with its menu or hint included, at 2x by default.
Scale the crop up to the shot's zoom; do not re-shoot it. `manifest.json` lists every scene
with its length for whatever assembles the film.

## Checks before assembling

1. Every caption and voice-over line points at one frame and one visible thing in it.
2. No frame shows anything real: names, paths and numbers all come from `storybook/world.mjs`.
3. The final film is under a minute, and the captions are readable at phone size.
4. Watch it once muted. If a shot still makes sense, it is working.
