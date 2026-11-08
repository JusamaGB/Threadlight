# Continuous Agent reader and delegated speech

## What reproduced

An earlier signed-in native check recorded a six-word answer twice: as a backing final message and as a separate Live assistant transcript segment. The final period moved from outside to inside the quotation marks. Both IDs and strings were present in the saved history. That establishes one cause of duplicate presentation.

New speech submissions record the Live session, backing turn and final item. A transcript attributed to that submission shares the backing answer's display while its words match the answer or its spoken excerpt. Direct speech, different wording and unmatched records remain visible. The raw provider and Live items remain in history. Older records without handoff evidence retain both representations when their relationship is uncertain.

## Speech timing

A signed-in, ephemeral **text-only** app-server turn explained binary search and supplied a Python example. It emitted 405 final-answer deltas. The provider identified the item as final at its start. The stable opening sentence appeared at 18.141 seconds, the final text item completed at 28.735 seconds, and the turn completed at 28.766 seconds.

The timing fixture replayed those timestamps into the production handoff code. Its speech request played a generated recording of the opening sentence into a local WebRTC sender. A second sender used the old completion-only trigger with the same recording and trace. The receiver measured incoming packets and non-silent decoded samples with speaker output muted. Times are seconds from the start of the recorded backing turn.

| Stage                                           | Early sentence | Completion-only |
| ----------------------------------------------- | -------------: | --------------: |
| Speech submission                               |         18.142 |          28.766 |
| First observed incoming packet after submission |         18.208 |          28.828 |
| First non-silent decoded audio                  |         18.522 |          29.132 |

At early audio onset, 230 of 1,820 characters had arrived and the code fence was open. Both receivers used the same synthetic speech onset. The 10.610-second difference measures the trigger change on this trace. It excludes provider speech synthesis latency, physical speaker output and headset latency. Previous signed-in checks verified audible-content output from the native speech endpoint; an end-to-end signed-in **early** readout remains unverified. The regular Live call was not used.

The [caption and startup replay](LIVE-CAPTION-AND-STARTUP.md) covers ambiguous playback, explicit **Read remaining**, caption grouping and bounded startup buffering.

The installed app-server schema exposes thread-scoped `appendSpeech` with text and thread ID, an empty acknowledgement, item-keyed transcript deltas and session stop. It supplies no per-submission playback ID or cancel handle. The WebRTC channel reports assistant turn creation and completion. The implementation can submit a useful opening and, after the matching playback boundary, its remaining prose once. Code examples stay in the transcript. New input, Stop speaking, a newer backing turn or session closure cancels obsolete waiting speech. Once an utterance has been accepted, cancellation can silence local playback but cannot retract audio already delivered.

An opening without an eligible stable sentence uses completion-time speech. The early path requires an explicitly final item, an available playback slot and no active decision or coaching guide. Unknown phases retain completion behaviour. A shown coaching step keeps its own narration authority. Code-first replies keep fenced examples in the thread.

## Recorded editor turn and corrected speech handoffs

One saved foreground Live turn contained a single user segment and three native delegation records, including a late transcript correction. Two initial editor reads returned before the proposal was shown about 42 seconds into the turn. The backing answer followed at about 44 seconds. The log recorded a speech request near the proposal. It cannot establish when sound reached the headset.

Replaying the saved history with the updated reader produced one user message containing all three delegation records and retained all four tool calls. The preceding, identity-linked assistant narration had repeated a formatted answer in plain speech. It now shares the formatted answer’s row. Unlinked speech remains visible.

A second screenshot showed the working indicator and three audio disclosures for successive versions of a longer request. The completed log contained four delegation items in that backing turn, including a replay. The first two ended mid-request and their punctuation differed from the final user segment. Replaying those four items produced one user message and one disclosure with four entries. Both saved runs contained one native task-start event and one backing turn each. The three and four delegation items had distinct provider item IDs. They were real same-turn updates that the old reader displayed as fresh user messages. A separate test keeps two identical utterances with different segment and backing-turn IDs as two messages.

A local replay of the recorded binary-search stream submitted the lead at 18.146 seconds, with non-silent synthetic WebRTC audio at 18.528 seconds. The completion-only comparison first produced audio at 29.162 seconds. The turn completed at 28.766 seconds and the revised path submitted the remaining prose once at 28.787 seconds. This measures a synthetic opening recording and the tail’s submission, not native audio onset or physical playback. The focused transport test covers a corrected utterance during an editor read, an independent progress update, a streamed lead and a deferred tail, with the original request and its identity links retained after reopening. Stop speaking, user interruption, a newer turn and session end each cancel an unsent tail.

## Reader and controls

Isolated renderer checks exercised several turns in current and Earlier history, raw voice details opened by keyboard and copied through the shared menu, and read-only historical decisions. Current tool details, Markdown, source links, copyable code and distinct pinned examples remained accessible. A pending card inserted above the visible code and a later spoken turn left the measured code line in place. New updates and Needs input moved the reader on explicit action. Two pins and a saved reader height were tested in a narrow panel.

The top Agent bar contains Reply and the idle green phone. Reply opens and focuses the shared multiline composer below the transcript. Escape closes an empty composer, and unsent text survives navigation. The resize grip remains below the conversation. Earlier chats are available from the Agent settings gear beside Back. During a call, the mic, speaker, Stop speaking and End controls form one centered group.

Hanging up retains the foreground chat. Start fresh and Archive use the existing guarded conversation operation. The panel test used simulated call controls and provider state. The service tests checked exact conversation identity, busy/decision refusal, archive and fresh behaviour. The regular application and VS Code were not restarted.

## Focused checks

- Run Vitest on `test/agentTranscript.test.ts`, `test/agentCodex.test.ts`, `test/spokenLead.test.ts` and `test/liveVoice.test.mjs`.
- Use the isolated renderer focus values `agent-continuous`, `agent-decision` and `voice-mode` in `test/ui/providers.smoke.mjs`.
- `test/live/delegated-speech-timing.proof.mjs` takes a JSON event trace (milliseconds, event, itemId, type, phase and text) and a WAV of its opening sentence. It needs the same Playwright and Chromium environment as the UI checks.

The isolated Agent settings check measured the gear immediately left of Back and exercised keyboard entry, provider/model/effort changes, failed saves and retry. The navigation check returned to the unsent draft, opened Earlier from the gear and exercised history Back/Forward. The Brainstorm check retained its own Earlier access.

### Compact reply typography and header

At a 228 px reader width, Chromium selected regular Segoe UI for prose and Segoe UI Bold for emphasis. Prose stayed at 12 px and weight 400. Line height moved from 17.4 to 18 px, paragraph spacing from 7 to 8 px, and the prose colour moved 2% toward the background. Computed heading, user bubble and fenced code styles matched the baseline.

The renderer fixture checked the icon-only Reply control, keyboard access, first-line visibility, a six-pixel fade while scrolling current and Earlier messages, and unchanged scroll height from applying the fade. It rendered a marked-up definition inline and in a highlighted Python block, copied its indentation intact, and exercised text selection and unsafe Markdown filtering. A saved coaching answer already used backticks around the short definition. Plain transcripts retain their original text. These were isolated renderer checks; the regular app and voice session stayed running.

### Returning from the live microphone pill

A waveform click previously opened the last panel route and set a window hold that lasted until microphone capture stopped. Both native pointer-exit paths checked that hold. The click now carries an explicit conversation request. The window briefly ignores stale pointer events during the handoff, then resumes its normal pointer checks. The renderer resolves the foreground Agent or the owning Brainstorm project without starting another call. Active conversation controls appear on their own page; another page offers Return to call.

Window-manager tests exercised the handoff, reopening the pill, an explicit pin and collapse while the microphone remained open. Renderer tests used substitute audio and a simulated connected peer. They exercised leaving Agent, waveform return with the same draft, pending decisions and the active composer. Brainstorm returned from another tab to the same discussion. The idle toolbar test opened and hid a draft, reopened it with the keyboard and preserved it when starting fresh. The close icon uses the existing guarded archive operation and keeps history in Earlier. Physical mic capture and regular-app activation were outside these tests.

## Narrow Agent layout and collapsed call actions, 8 November

At 236px content width, the current reader left 13px below the transcript with the reply box closed. Its handle measured 12px high. The open-composer fixture left 16px below its last visible control row. Earlier used 25px including Back, Continue and the resize handle. The renderer checks cover mouse drag, both anchor directions, keyboard resizing, retained drafts and centering of the idle and live actions. Smart Thread and Agent assistant paragraphs both computed to 12px Segoe UI Variable, normal weight and spacing, with 17.4px line height.

The isolated waveform fixture exercised left click, drag, right click, Shift+F10, Escape, pause, resume, audible-only Stop speaking and explicit hang-up. Window-manager tests checked menu bounds and restoration on two displays. No physical microphone or provider call was opened for these checks.

The regular app relaunched from the primary checkout at 17:12 local time, after the 17:11 build. Its visible Agent panel exposed the settings gear, conversation controls, transcript and resize handle. The 33 saved conversation IDs, provider IDs and live histories matched the pre-restart fingerprint. The brief message seen during restart could not be identified from the available logs.

## Follow-up on the live toolbar and artwork

At compact width the isolated Agent call fixture measured five controls on the same horizontal centerline, each at least 23px wide and high. The pencil was last in the row. Keyboard activation closed and reopened the composer with its draft intact. The Brainstorm voice, idle Agent and collapsed waveform checks also passed.

The recent Agent SVG follows the concave four-point silhouette from the left header of the November 7 DMs and Handoffs illustration. The renderer check observed its drop shadow and the disabled waiting pulse under reduced motion. The separate working wheel and floating provider indicators continue to use their own artwork.

The isolated Settings view showed the HAAIL attribution and supplied version. Agent and Smart Thread code cards exposed the keyboard-accessible two-card Copy icon. The pinned-code fixture copied the older visible revision and announced a simulated clipboard failure.

The primary app restarted at 17:34:54 local time after the 17:32:08 combined build. All 33 existing conversation IDs and their previously recorded live items were present afterward. Desktop control remained released during this verification.

## Answered Agent cards, November 8

Read-only inspection of the saved coaching conversation found three native
settings calls. The first failed and has no matching approval. The other two
had completed Allow receipts. Their saved anchors were native items 173 and
341 in rollout order, both outside the newest 100-item page.

Replaying that page put both answered cards in the last two of 229 displayed
rows. The corrected reader places them beside earlier saved Live segments while
the native items are off-page. When those items are loaded, the cards follow the
original calls. The renderer shows an unresolved approval below the latest
message and keeps historical views read-only. If neither an exact anchor nor a
known preceding Live segment is available, the card is readable in **Saved cards**.

The isolated renderer exercised three answered cards, a separate pending
approval, repeated feed refreshes, reopening, and loading the earlier page.
Each answer appeared once after its original activity when that page was
available. The focused event, transcript, native-question and dismissal suites
passed all 38 tests. The regular app was not restarted for this check.
