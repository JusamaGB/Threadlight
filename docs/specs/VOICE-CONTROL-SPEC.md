# Voice control

Agreed 2026-10-25. The global microphone is for commands and the hosted Agent.
Thread dictation belongs to the right-click composer.

## One hotkey, commands or Live conversation

Implemented 2026-10-25 using the desktop-managed Codex CLI's native WebRTC voice
transport and the existing ChatGPT sign-in. No API-key service or fallback is used.

Ctrl+Alt+Q opens one microphone session in an undecided state. There is no separate
hotkey or up-front mode picker. Its opening speech selects one of two modes, and
the selected mode lasts until the microphone session is closed.

### Command mode

- A completed, short “open” or “open <thread name>” command selects command mode.
  Wait for the normal end-of-sentence pause before executing it; a partial “open”
  must not open anything while the person continues speaking.
- Once selected, command mode stays selected. Later conversational speech does not
  start an Agent or Live session. Close and reopen the mic to choose again.
- Preserve exact-title matching, spoken word-split matching, ambiguity handling,
  and bare-name commands after the initial “open”. A complete known title can be
  longer than the usual short command and must remain a valid command.
- A short “open <unknown or misheard name>” remains a command attempt and shows
  the existing no-match feedback. Failed title matching alone must not send speech
  to a model.

### Live conversation mode

- Conversational opening speech selects Live mode. An opening word “open” does
  not reserve command mode when the person continues with a longer conversational
  request. For example, “Open the project and help me understand why its tests are
  failing; I changed the settings earlier and now the results look different” is
  an opening message, not a thread-selection command.
- Examine incremental transcription while collecting the opening sentence. Once
  it is clearly conversational, begin preparing a fresh owned Codex thread and
  its Live connection in parallel with the remaining transcription. Preparation
  must not send a partial request, execute a UI command, or produce a spoken reply.
- Keep the complete opening transcript, including its first words. After the
  sentence is final and the Live connection is ready, submit that transcript once
  as the first user message. Either transcription or connection setup can finish
  first. Do not also send it through the existing text-Agent send path, or replay
  its microphone audio into Live.
- After that handoff, use the same microphone session for two-way Live audio,
  including spoken replies and interruptions. Later uses of “open” belong to the
  conversation and cannot switch back to UI commands.
- A new Live session owns a fresh conversation. Do not resume an Earlier entry or
  replace an Agent turn that is still working without an explicit user action.
  Keep the selected Codex backend model distinct from the voice model.

### Choosing the mode and handing over audio

Treat opening speech as undecided until there is enough evidence. An opening
“open …” with fewer than 12 words remains a command attempt. At 12 words or more,
it selects conversation unless it matches a known title or is a prefix of one.
Known titles and unique whole-title phrases remain commands regardless of length.
Other completed opening speech selects conversation. These are deterministic rules,
not semantic intent detection; a short conversational request beginning with “open”
can still require closing the mic and rephrasing.

While a person is still speaking, bounded preview transcription runs at most once
every two seconds, serialized with final transcription. Two consecutive conversational
previews can begin preparation: non-“open” previews need at least three words;
“open” previews use the 12-word and known-title rules above. A completed audio chunk
can also begin preparation before the whole sentence ends. Revised or stale previews
never execute commands and never enter the final text. The final opening still uses
the final transcript to latch the mode: a revised short command cancels provisional
Live preparation and selects commands. The opening boundary uses
the existing one-second end-of-sentence pause. Startup speed depends on local
transcription and the connection; readiness before the speaker finishes is a target,
not a guarantee.

Only one pipeline may consume speech for delivery at a time. While preparing Live,
local capture/transcription owns the opening message and Live input remains gated.
While setup completes, continue collecting and transcribing the opening locally,
including additional speech. At a quiet boundary after connection readiness, send
the complete text once. Subsequent frames belong to Live; hold up to five seconds
while its text acknowledgement is pending, then deliver them in order. Overflow
stops the connection with an error. The outgoing WebRTC track carries silence until
handoff. Local command/transcript delivery stops once Live owns the input.

Closing the mic cancels setup, transcription, pending sends, input, and playback.
Late callbacks from that session cannot start a conversation or deliver a message.
Release the microphone and close the Live connection; retain the owned conversation
under Earlier using the existing history lifecycle. Cancellation must not flush an
unfinished transcript as a new request. If preparation or handoff fails, retain the
opening text for explicit retry and show the error; do not silently fall back to a
different provider, paid API route, or duplicate text send. An uncertain send must
be reconciled before retrying.

Use compact states such as Listening, Commands, Connecting, and Live in the existing
microphone UI. They should explain what the microphone is doing without requiring
the person to choose the mode manually.

### Connection validation and acceptance checks

The native WebRTC transport was verified with ChatGPT authentication, opening text,
returned voice transcripts and audio packets, and generated follow-up speech. Codex
retains responsibility for native turn-taking and interruptions. Its backend remains
the selected Codex model under the existing approval and tool policy. No separate
API-key fallback is permitted. Revalidate the experimental transport after CLI updates.

Before release, verify at least:

- “Open” followed by a pause locks commands; later long speech remains in commands.
- Short matched, unknown, ambiguous, and long exact-title commands retain their
  existing behavior and never start Live.
- A long conversational opening beginning with “open” starts Live preparation while
  transcription continues, without executing the provisional command.
- A conversational opening without “open” follows the same preparation path.
- Slow setup, slow transcription, revised partials, and continued speech preserve
  the complete opening and subsequent audio without duplicate delivery.
- Closing during preparation or handoff prevents delayed sends and releases audio.
- Spoken responses can be interrupted without being transcribed as user commands.
- The selected backend model, new conversation identity, and Codex history label
  remain correct; existing working conversations and other threads are unaffected.

## Setup and retained behavior

Enable Settings → Open mic with Toggle mode and select Codex as the Agent provider.
Commands remain local and work independently of the Agent selection. Live requires
the installed CLI to report ChatGPT authentication; API-key accounts and Claude
receive a clear error with the opening transcript retained, without changing auth.

Thread matching ignores case and punctuation, prefers complete titles, and accepts
unique whole-word title phrases and speech-recognition word splits. Ambiguous names
show the candidates. Commands expand, pin, and focus the row inside Threadlight;
they do not send messages or launch the provider app. Workspace selection is temporary.
Monitoring may be off while Live is available. Existing non-open-mic dictation remains.
Composer dictation pauses Live input and mutes its playback until dictation finishes.

The opening is transcribed locally. After handoff, microphone audio streams through
native Codex WebRTC and spoken replies play through the output device. Threadlight
does not save raw audio. Because the current native paginated history omits realtime
timeline items, Threadlight stores voice text alongside its Agent metadata, including
partial replies visible when the conversation ends. History stays under Earlier.
The opening has a durable pending marker until its backend turn completes; an uncertain send is
shown in history and never automatically retried. Storage failures are surfaced.

## Native transport evidence

The desktop-managed Codex CLI (`0.164.0-alpha.11.1`), selected by Threadlight,
and the installed npm CLI (`0.157.1`) both expose experimental voice bindings via
`app-server generate-ts --experimental`:
`thread/realtime/start`, `appendAudio`, `appendText`, `appendSpeech`, `stop` and
`listVoices`. Start accepts a thread ID, output modality, WebSocket/WebRTC transport,
and voice configuration. Testing `v3` over WebSocket returned “realtime conversation
requires API key auth”. Testing `v3` over WebRTC succeeded with `account/read`
reporting `chatgpt`. Both probes used isolated test threads that were archived.
The implementation uses WebRTC only, and never extracts or copies authentication
tokens. Native subscription accounting was not measured by these transport tests.

[Claude's voice documentation](https://support.claude.com/en/articles/11101966-use-voice-mode)
explicitly excludes Claude Code and Cowork. Threadlight's Claude Agent uses Claude
Code, so creating another agent thread cannot by itself activate Claude native voice.

[ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice) documents native voice
with the selected Codex task and model. The separate GPT-Live API integration was
explicitly declined; it is not part of this implementation.

## Verification

The renderer waits for the Live data-channel `session.started` event, not just an
open WebRTC connection. After the opening is acknowledged it shows "Waiting for a
reply". A silent connection fails visibly after 30 seconds without resending the
question. Backend work and approval waits extend that deadline.

The installed V3 transport maps text appends to background context. Threadlight
therefore submits the transcribed opening exactly once as a normal `turn/start`
to the selected Codex model and reasoning effort in the same owned Live thread.
The native commentary handoff conveys the backend result to voice. Voice instructions
explain that the opening is already being handled and its result should be spoken
without waiting for additional microphone input. Subsequent speech uses native Live
delegation. The opening stays in the durable pending journal until turn completion;
uncertain sends are never replayed. Closing cancels unsent work and retains history.

`test/liveVoice.test.mjs` covers service readiness, early events, waiting for a reply,
timeouts, delegated work, cancellation, and audio during the opening acknowledgement.

`test/voiceRouting.test.ts` covers session latching and reset. `test/vad.test.ts`
covers pause assembly. The generated-audio tests in `test/ui/voice-routing.smoke.mjs`,
called by the provider UI smoke harness, exercise the real renderer/hook, commands,
composer dictation, early preview preparation, silence before handoff, native opening
delivery, error retention, and closed-session stale results.
They do not use the physical microphone or contact either model provider.

`test/agentCodex.test.ts` covers native start, one-time opening delivery, uncertain
acknowledgements, cancellation, auth restrictions, owned history, and active-turn
protection. `test/agentLive.live.mjs` is an opt-in authenticated test using the real
service and renderer connection with synthetic audio. Set `THREADLIGHT_LIVE_SMOKE=1`,
`THREADLIGHT_CODEX_CLI` to the desktop-managed executable, and `THREADLIGHT_PLAYWRIGHT`
if Playwright is not locally installed. Optionally set `THREADLIGHT_LIVE_TEST_WAV` to
a short synthetic speech WAV to verify follow-up audio input, and optionally
`THREADLIGHT_LIVE_FOLLOWUP_EXPECT` to require a matching spoken answer. It consumes native
voice usage, uses no physical microphone/speakers, and archives its owned test thread.
Set `THREADLIGHT_LIVE_TEST_MESSAGE`, `THREADLIGHT_LIVE_EXPECT` (a regex for the spoken
answer), and `THREADLIGHT_LIVE_MODEL` to reproduce a specific opening. A filler such
as “Checking now” alone does not pass the answer assertion.
