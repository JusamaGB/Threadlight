# Shared browser

<!-- Generated from docs/FEATURES.md by scripts/package-memory-plugins.mjs. -->

Right-click the header and choose **Browser** to open the retained panel browser without selecting a chat. The header menu is alphabetical: Agent, Browser, New, Spaces, Workspace. The Live agent can open this same browser with the `browser` navigation route, then load a requested lecture when the course and URL are known.

You can also right-click a coding chat and choose **Browser**, or switch from its artifact toolbar.
Each chat has one retained browser. Back, forward, refresh and the address field use
that page’s history. Leaving Browser or hiding the Threadlight panel pauses
playing video and audio. Returning resumes the same players that Threadlight
paused. A player you paused yourself stays paused.
Restarting Threadlight restores its saved address when reopened, with a fresh load.

Opening Browser manually outside a call gives you the ordinary Browser header.
The Agent diamond returns to the conversation that opened Browser or to the
current Live call. During a Live call, the Agent’s spoken words appear in a
small caption centered over the top of the page. The caption grows to two-thirds
of the player width and shows the latest two lines. **Mute Agent voice** in the
header silences the Agent while captions continue and the website keeps its own
volume. Threadlight draws the caption in a separate, click-through window.

The address field accepts website addresses or Google searches. Enter a full URL,
a domain such as `youtube.com`, or a local development address such as
`localhost:3000` to navigate directly. Other text opens Google search results.
The blue-and-amber Threadlight spiral appears on the idle page and rotates inside
the address field while a page loads. Blank and failed pages have a dark background;
failed navigation preserves the address with a Retry action. Websites receive a
dark-mode preference, with Chromium automatic dark rendering for light pages.

Use the video player's own fullscreen control to fill Threadlight's bordered
content area. In YouTube’s compact player, use Expand to reveal its fullscreen
button, or press F while the player is focused. The player control or Escape exits
fullscreen. Drag either lower corner, including just outside the card, to scale
the player. Hold Alt and drag the bottom edge up to remove the top and bottom
letterboxing, or down to bring it back. The picture stays centered and the
player's controls follow the new bottom edge. Corner drags preserve the current
shape. You can also Tab to a grip and use the arrow keys. If you switch to
another Threadlight view and reopen the same Browser while the video is still
fullscreen, it restores your chosen size and crop. Exiting fullscreen clears
that size and restores the normal browser layout.

Open **Settings → Agent → Browser access** to select a browser and choose enrolled
Codex and Claude connections. Saved browsers can be configured before reopening.
Each selected connection uses its own approved plugin enrollment. The built-in Threadlight Agent
is enabled by default and can also be disabled here. Agents can inspect page text
and elements, obtain screenshots, navigate, click, type, press keys and scroll.
Only one agent controls a browser at a time. Mouse or keyboard input and **Take
control** interrupt that agent. The browser must be visible for agent interaction.

At narrow widths, YouTube uses tighter search controls, filters and result spacing.
Its floating player defaults to a flat 28-pixel title strip with a subtle shadow,
play/pause and matching expand/collapse icons. The controls have no button borders.
Audio keeps playing while the preview is collapsed, and search results remain
scrollable above it. Expand restores the native video and playlist controls.
Keyboard users can operate the strip without tabbing into the hidden player.
This layout is applied to YouTube inside Threadlight and follows its current
webpage structure. Wide browser views retain the site's normal layout.

The **Browser options** menu (also available by right-clicking the browser toolbar)
contains **Open HTML…**, **Open externally** and **Reset browser**.
**Open HTML…** selects a local HTML file and permits resources within its containing
directory. Select local HTML again after restarting Threadlight. Development servers work through their HTTP address. **Open externally**
opens the current website in your normal browser. **Reset browser** closes the
current page and starts a new browser session.

Cookies live in a separate persistent browser profile for each chat browser.
Camera, microphone and device permissions are disabled, and downloads are blocked.
Links requesting another window open in the same browser. Generated artifact
previews continue using their existing isolated configuration.

External chats need Threadlight plugin 0.4.0 or newer and an approved enrollment.
Browser sharing is selected in Agent settings and can be revoked there. After a plugin
update, refresh its tools or open a new provider chat. Verification and remaining
live compatibility checks are recorded in `docs/validation/SHARED-BROWSER.md` in the source checkout.

### Discuss a paused video or audio

For a question about what the user just watched or heard, call `threadlight_browser`
list and inspect. Each frame includes a media array with element identity,
observation time, playback position, duration, paused/playing state, speed,
seekable ranges, buffering and fullscreen state. Hidden audio and media in
cross-origin frames are included. Choose the visible primary video or the player
identified by the user; clarify when multiple players are plausible.

Keep the page URL, title and observed position as the conversation's discussion
point. For spoken replies, express playback times and durations in words. Use nearby available caption cues (45 seconds before to 15 seconds after),
the current chapter and visible player captions to understand the question.
YouTube, Video.js and JW Player caption overlays are recognised when present.
Text tracks are read without enabling or downloading them. Empty or unavailable
captions do not establish what was said. Ask for the relevant phrase if the
available page transcript, captions or visual material cannot answer the question.
Explain the concept and help with the requested exercise or work using that context.

Inspection leaves playback alone. A new question requires a fresh observation;
keep earlier discussion points distinct if playback has moved. On an explicit
request, use play, pause, seek with absolute seconds, skip with signed seconds,
or rate between 0.25 and 4. Pass the observed frame/element, revision and operationId.
Inspect again to confirm, then release control. Reuse the same operationId after
a lost response, especially for relative skips. Seeking must stay inside the
reported seekable range. A timestamp alone is never evidence of the spoken content.
