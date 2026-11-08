# Pinned reference history and Live call controls

## Pinned references

An isolated Windows Electron instance used its own data directory, with the production
window manager, renderer and preload. The reference kept its width, opaque background
under the spinning logo and native logo hit target. The file row filled the interior
width. The in-panel lower edge and detached edge accepted pointer and keyboard
resizes. After opening Active and Recent at each of the four corners, the detached
reference kept the matching corner. The bottom-anchored window used its upper edge.
The resize value synchronized across both windows. The check also exercised
Shift+wheel, Ctrl-drag at a display edge, reduced motion and Unpin.

The production store tests imported an existing pin whose earliest available revision
was 4, retained independent histories for two pins, appended and replaced content,
browsed with the latest version intact, reopened the store and rejected stale writes.
Reaching the version limit retained the oldest and latest content. In the native
window check, browsing an older snapshot updated both surfaces and Copy returned
that version through the fixture clipboard boundary.

A signed-in foreground Codex Agent read a disposable pin, requested approval for a
replacement, then requested approval for an append. The persisted original version
remained readable and the file on disk retained its bytes. No personal pin was used.

## Live calls

A signed-in Codex WebRTC session with generated microphone input exercised independent
input and output mute, silence for the current spoken reply, and a subsequent spoken
turn over the same connection. The check observed the completed transcript and new
non-silent incoming audio. The browser output was muted at the device boundary.

Isolated renderer and service checks exercised connecting and busy hang-up, late
microphone acquisition and stale session events, retained drafts and decisions,
and explicit post-call actions. The shortcut tests used a substitute Windows
shortcut registrar to check ownership, key repeat, conflicts, suspension and cleanup.
A physical Ctrl+Alt+M keypress in the regular application and physical headset
playback were outside these checks.

The floating pill receives scalar motion state from the owning panel. The renderer
checks distinguish active Agent work, a human decision and ordinary listening.
The pill check exercises the two highlights, the static reduced-motion state and
disconnection. Agent transcript checks exercise source links, safe wrapping,
expandable activity, decision-card ordering and drafts.

The Windows window check is `THREADLIGHT_UI_FOCUS=pinned-reference` in
`test/ui/window-hover.smoke.mjs`. The renderer cases use `voice-mode`,
`mic-indicator`, `brainstorm-voice` and `agent-grouped` in
`test/ui/providers.smoke.mjs`. For the signed-in checks, see
`test/live/pinned-code.proof.mjs` and the optional `THREADLIGHT_LIVE_CONTROLS=1`
case in `test/agentLive.live.mjs`, which requires a generated follow-up WAV.

On 8 November, a read-only check of the regular app found the rebuilt main process
and matching panel loaded from the primary checkout. The Agent was busy and the
microphone was open. Interaction checks used isolated sessions.
