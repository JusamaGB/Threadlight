# Live screen help on Windows

The screen helper runs for the foreground Codex Agent's native GPT Live
conversation. Claude hosted text, Shared Spaces Brainstorm and Perplexity account
chats do not use this route. The feature uses the Agent's existing permissions.

| Check                 | Evidence                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image before speech   | In a disposable signed-in GPT Live conversation, the backing Codex thread accepted a generated image with a word and three-digit number. Live spoke an acknowledgement in silence.               |
| Spoken follow-up      | Generated speech asked what was in that image. The same Live conversation returned the expected number in its completed transcript with new incoming audio. No physical mic or speaker was used. |
| Fresh window identity | A signed-in Live Agent called the real application-control tool twice, using two synthetic foreground observations. Its spoken replies named the corresponding app after the change.             |
| Windows integration   | The Windows API returned the foreground window handle, process and executable. The native helper installed its mouse hook and exited when its parent input pipe closed.                          |
| Gesture               | Native state-transition checks cover a reversed rectangle with negative coordinates, frozen mouse-up, a single commit on Ctrl-up, release mid-drag, Escape and empty selections.                 |
| Session isolation     | Focus and delayed capture results are scoped to the originating Live session. Tests check active-turn steering, rejected sends, cancellation and no automatic replay.                            |

The signed-in tests exercised the provider and renderer audio transport with test
inputs. The user confirmed that a physical Ctrl + right-drag outside Live sent a crop and
played its reply. Protected windows and mixed-DPI monitor layouts still need hands-on acceptance.

## Outside-Live capture

Two image-only Python questions started two different signed-in Codex Agent
conversations. The first answer identified a division-by-zero error, and the
second identified an undefined variable. The first conversation remained in
Earlier. In the original Windows speech check, the local synthesizer rendered both
completed answers to non-empty WAV files. The test did not open a microphone
or play through the user's speakers. A fixture verified Claude's image-message
format; the signed-in Claude run stopped at a provider billing error.

Focused tests checked the Live-only, outside-only, both and neither settings,
speech preference persistence, stale crop rejection, queueing behind active work
and one spoken answer per region. Native capture and inspection-only helpers
started and stopped on Windows.

The regular app restarted from the primary checkout after the idle checks. It
loaded the rebuilt renderer and reported both capture modes enabled, spoken
outside-Live replies enabled, Codex selected and the microphone closed.

The updated Codex speaker passed a signed-in check with the production playback
code and a disposable native voice session. A muted browser received non-silent
audio for the supplied answer, matched its closing spoken question and drained
playback. The test recorded zero microphone requests. The local Windows voice
remains the playback route for Claude.

In the November 7 build, after the regular app restarted, its header restored the user's existing crop
conversation and its closing question. The diamond appeared beside Settings
with its waiting animation, Codex attention drips were active, and the microphone
remained closed with Local STT selected. Isolated panel checks opened the matching
current and saved Agent conversations through the diamond. A small first wheel
movement showed the preceding reply directly above the needs-input card while
the reader stayed 197 px tall in the fixture.

The November 8 correction keeps that shortcut quiet for a completed conversational
reply. Only a current Agent input request pulses. See the
[native question lifecycle checks](NATIVE-QUESTION-LIFECYCLE.md).

## Screen-region intent

Three synthetic crops were checked through signed-in Codex. In an existing GPT
Live conversation, the user asked for just the heading of the next image. The
crop also showed a syntax error. Live spoke “Orchid Atlas,” the heading, in
the same conversation. Two standalone crops started distinct Agent conversations.
A marked Python syntax error got a direct missing-colon explanation. A plain
note got a brief acknowledgement and one question about the desired help.

Adapter checks covered the Claude image payload and system guidance, the Codex
standalone image and receipt, and delivery to an in-progress Live turn without
resending after a rejected steer. The signed-in behavior check used Codex.

In a separate signed-in run, rapid copies of each of two different synthetic
crops produced two owned conversations in total. The first was archived when
replaced and remained readable from history. The second stayed active until
End and then archived. Isolated tests cover suppression while queued or in
flight, a five-second acceptance window, new sessions, retries after rejection,
unconfirmed sends, and restart cleanup restricted to marked settled crops or
previously requested archive operations. No historical user chats were archived
by the validation.
