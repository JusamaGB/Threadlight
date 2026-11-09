# Shared browser validation

Implemented on 9 November 2026 in the primary checkout.

## Scope

A retained Electron WebContentsView per coding chat, browser navigation and local
HTML, shared page inspection and interaction, screenshots, control handover,
explicit external connection sharing, and video fullscreen within the bordered
content area. The foreground hosted Agent uses application control. The packaged
Codex and Claude plugins use their enrolled memory connections. Both transports
call the same browser service. Plugin manifests are version 0.4.0.

Each browser uses its own persistent Chromium profile. URL and access metadata
and action receipts are written atomically to browsers.json. An interrupted
pending receipt becomes uncertain when the service loads it. Agent actions use
fresh observations, stable element references in isolated execution worlds,
frame identity and operation IDs. Cross-origin frames use their own attached
DevTools sessions. Website code receives no Threadlight preload or Node access.

## Verified

- Type checks and focused lint checks.
- Canonical plugin packaging and generated copies.
- Focused artifact/catalog, application-control, memory-plugin and Codex-adapter tests.
- The existing real Electron artifact regression suite, including its isolation,
  interactive HTML, refresh, copies, navigation and frozen-renderer recovery checks.
- test/ui/browser.smoke.mjs through the real renderer and preload, with real
  encrypted MCP transport and both packaged external bridges. Synthetic enrollments
  were confined to the isolated test profile.
- Both external bridges observe and operate the same browser. Verified clicks,
  typing, screenshots, cross-origin iframe interaction, exclusive agent control,
  human takeover, stale observations, duplicate receipts, sharing removal and
  enrollment revocation.
- Page retention across view changes, back/forward navigation, local HTML and
  persisted action receipts. A full Electron process restart restored the URL,
  browser identity and external sharing. A restarted Claude bridge recovered its
  enrollment and completed receipt without executing the click again.
- Synthetic video fullscreen from the toolbar and player, with unchanged outer
  window bounds. Inspected a native Windows window capture of the composed view.
- Live CS50P Lecture 0 on YouTube loaded and played. Playback advanced while the
  video was fullscreen, and the outer window bounds stayed unchanged. The live
  test waits for a visible, playable video before requesting fullscreen.

The restart integration run wrote its evidence to
Z:/Temp/threadlight-artifacts-native-AuIhti. The live YouTube result is in
Z:/Temp/threadlight-artifacts-native-9CUoLk. Native window captures are also in
Z:/Temp/threadlight-artifacts-native-1hjp5K.

## Running the focused browser check

Build the app with npm run build. Set THREADLIGHT_PLAYWRIGHT to an installed
Playwright package when it is outside this repository, then run
node test/ui/browser.smoke.mjs. Set THREADLIGHT_BROWSER_YOUTUBE=1 to include the
live CS50 YouTube check. The test launches an isolated Electron profile and
closes its browser and bridge processes when it finishes.

## Verification limits and activation

The external integration checks execute the actual packaged Codex and Claude
bridge programs with deterministic tool calls. A signed-in provider model was
not asked to perform a live task. Arbitrary site sign-ins, DRM video and every
website’s pop-up flow have not been live-tested.
Downloads and camera/microphone/device access are disabled. Links opening another
window use the same page. Each chat has one browser page in this implementation.

The regular running app needs a restart to load the new build. External chats
need the updated plugin and a tool refresh or a newly opened chat. Human approval
of enrollment and the selected browser’s Sharing controls remain the entry points.

README.md, docs/FEATURES.md, CHANGELOG.md, the control/shared-memory skills and
Codex plugin guide document the feature. Existing unrelated changes in the
primary checkout were preserved.

Header browser follow-up: the native smoke test verifies the alphabetical
Agent, Browser, New, Spaces, Workspace menu and opens the panel browser without
selecting a coding chat. The fixture rejects unknown chat IDs, exercising the
reserved panel browser identity. All 25 focused application-control tests passed,
including browser navigation without chat resolution. Native evidence is in
`Z:/Temp/threadlight-artifacts-native-URSWMh/browser-result.json`.

## Browser polish follow-up

The address field now resolves Google searches, domain names, explicit HTTP(S)
URLs, localhost and IPv6 addresses. Unsupported schemes and embedded credentials
are rejected. The idle surface uses a transparent adaptation of the existing
blue-and-amber LinkedIn spiral. Loading feedback stays inside the address field.
Failed navigation hides the native error page, retains the address and offers Retry.

Agent settings now manage access for both open and unopened saved browsers.
The browser toolbar contains navigation, the address/search field and Browser
options. Player fullscreen hides that toolbar. YouTube's compact Expand control
reveals its own fullscreen button; F also works when the player is focused.

Validation on 9 November 2026 passed 41 focused navigation/control tests, type
checks, focused lint and production build. The real Electron smoke test passed
address navigation and correction, dark idle/error states, loading without
layout movement, native dark-page pixels, both external bridges, sharing changes
through Agent settings, saved-browser access edits, local HTML, retained state,
receipts, revocation and full-process restart recovery. Final integration evidence
is `Z:/Temp/threadlight-artifacts-native-fmDxsC/browser-result.json`.

Live CS50 YouTube playback and its own fullscreen control passed with unchanged
outer-window bounds, recorded in that directory's `youtube-result.json`. The
main-renderer-only YouTube screenshot omits the native guest view; fullscreen
verification uses the guest DOM, advancing playback and native window bounds.
The native composed capture `shared-browser.png` verifies the dark webpage and
compact toolbar. Idle, failed-page and settings screenshots were inspected.

Google navigation reached its traffic-verification page on this network. The
search URL and dark preference were verified, but search-result content was
blocked by Google's challenge. Its record is in
`Z:/Temp/threadlight-artifacts-native-gW4sFu/google-result.json`.

Chromium automatic dark rendering supplements the existing dark preference for
light websites. The implementation uses the existing per-browser debugger and
applies the override to attached cross-origin frames. See the Chromium protocol
[Emulation definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Emulation.pdl).
The feature guide, README, changelog and bundled skill references document these
controls in plugin version 0.4.2. The regular app requires a restart to load the build.

## Paused-media discussion and playback

Plugin 0.4.3 extends the existing browser tool and skills. Inspection now exposes
HTML video/audio state and timestamps, text-track cues around the current point,
active chapters and available YouTube/Video.js/JW Player caption overlays. Hidden
audio and cross-origin media are included. Unknown or unbounded duration is
explicit. No captions are downloaded or enabled during inspection. A missing
transcript requires the user's phrase or other visible evidence.

Play, pause, absolute seek, relative skip and speed changes use the existing
revision checks, source identity, access grants and durable operation receipts.
The agent verifies the resulting state and releases control. Discussion anchors
are held in the conversation with the page URL/title and observed time.

The focused application-control, Codex adapter and plugin suites passed 108 tests.
The native browser integration passed with both packaged external bridges and
hosted access, a known paused position of 37.5 seconds in a 120-second audio file,
nearby caption filtering, chapter identity, visible caption overlays, hidden and
cross-origin media, playback commands, duplicate skip receipts and rejection of a
changed media source. Real YouTube timing was read through the hosted browser tool;
playback, fullscreen and restart recovery also passed. Evidence is in
`Z:/Temp/threadlight-artifacts-native-Vg3Rzg/browser-result.json` and
`youtube-result.json` in the same directory.

A signed-in native Live session delegated list/inspect/release to its backing
Agent using a synthetic paused lesson and caption. It spoke the paused position,
quoted the caption and explained return values. That check uses synthetic media
responses and a text opening over the real WebRTC voice path, with incoming audio
and native transcripts verified. It does not claim a physical-microphone question
against a real lecture. History is in
`Z:/Temp/threadlight-live-check-WeMqCu/history.json`.

The initial Live check exposed a spoken-number mismatch that could leave an
explanation after the timestamp unfinished. Browser/Live instructions now ask
for playback times and durations in words. The follow-up checks require both the
position and an explanation across completed spoken segments.

## Compact YouTube layout

YouTube pages in the narrow browser now use compact search controls and filters.
The native floating player retains its media element and defaults to a flat
28-pixel title strip with a subtle shadow and borderless play/pause and
expand/collapse icons. Native hidden children are inert while collapsed; their
original focus behaviour returns when expanded or when the view becomes wide.
Collapsed media remains inspectable and is correctly reported as visually hidden.
The adapter runs in an isolated world on the supported YouTube hostnames, handles
SPA updates and repeated installation, and does not expose application APIs.

The 24 focused URL/host-scope checks passed. The native layout test verifies
collapse, continuing playback, play/pause, keyboard expansion/collapse, scrolling
behind the strip, title updates, repeated installation and isolation from other
sites. A live YouTube check exercised the actual native miniplayer, searched for
CS50 material, played/paused through the new strip, expanded/collapsed the video
and scrolled the results. Inspected the final flat strip in
`Z:/Temp/threadlight-artifacts-native-FxQqxb/youtube-live-collapsed.png`;
`youtube-live-result.json` and `youtube-layout-result.json` contain the results.
The site-specific selectors follow YouTube's currently observed layout.

An early exploratory test was stopped while stalled and left an isolated Electron
process with a broken stdout pipe, producing an EPIPE dialog. Its exact fixture
process was identified and closed. Subsequent checks completed through graceful
application shutdown. No regular application restart was performed during testing.

## Resizing expanded video

In a transparent, frameless Electron test window, Windows hit-testing reached
Threadlight just outside both painted corners and below the bottom edge. The
browser integration exercised Alt-drag cropping in both directions, an
unmodified bottom drag, both anchored corner drags after cropping, and Escape
restoring the original window. The guest viewport followed the drag.

On the live CS50P lecture, the picture filled the cropped 473 × 266 viewport.
YouTube's 449 × 59 control bar ended at its bottom edge, the play/pause button
was reachable under the pointer, and playback advanced through the crop.
Results are in `Z:/Temp/threadlight-artifacts-native-0eVksv/browser-result.json`
and `youtube-result.json` alongside it. The build and 83 focused browser and
window tests passed. Restart the regular app to load this build.

The browser integration also reproduces leaving a resized player to open
another browser and returning through the right-click menu. The thread browser
recovered its chosen width and height after a corner resize and an Alt-drag crop.
The other browser used its normal bounds. A new fullscreen session started at
the default size, and a video that exited fullscreen while hidden reopened in
the ordinary browser layout.

The live CS50P lecture reopened from the panel header’s Browser menu at exactly
473 × 266, with playback advancing and YouTube’s play/pause button reachable.
The comparison before and after reopening is recorded in
`Z:/Temp/threadlight-artifacts-native-4hdcPJ/youtube-result.json`. The isolated
browser checks are in `browser-result.json` in the same directory.

## Playback when leaving Browser

The Electron browser check exercised switching views and hiding the panel with
a playing video, a manually paused player, and audio in a cross-origin frame.
Playing media paused while hidden and resumed when its browser returned. A
manually paused video and an audio player whose source changed stayed paused.

With the CS50P lecture on YouTube, Back paused playback at 5.089 seconds.
The position held while the browser was away and advanced on reopening at the
same 473 × 266 viewport. Pausing with YouTube’s own button at 5.345 seconds
and repeating the same round trip preserved the paused position.
Results are in `Z:/Temp/threadlight-artifacts-native-bSkerO/youtube-result.json`
and `browser-result.json` alongside it.

## Agent navigation and Live captions in Browser

The isolated Windows check in `test/ui/browser-captions.smoke.mjs` opens Browser
from the panel header, a chat menu, and the Agent navigation command. It seeds
a recent conversation to verify that manual browsing has no Agent shortcut.
The Agent-opened browser returns to its conversation. During a Live call, the
header offers return-to-call and speaker controls from either entry point.

The test supplies synthetic Live transcript updates through the Agent state
subscription and uses a simulated voice connection. It checks the actual panel,
preload, native guest, and separate caption window. Short text grows from the
center, and the caption tracks two-thirds of the player width after a corner
resize. Windows hit-testing reaches the player through the painted caption.
The guest document contains no caption text. The Agent audio element mutes and
unmutes while its transcript updates and the fullscreen video keeps playing
at the same size. The next user turn, reading timeout, and call end clear the
caption. The check ran without a provider call or physical microphone.

The separate live YouTube regression passed playback, crop, pause/resume and
viewport restoration. Its records are in
`Z:/Temp/threadlight-artifacts-native-iH5qva/browser-result.json` and
`youtube-result.json` alongside it.
