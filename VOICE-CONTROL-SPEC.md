# Voice control

Agreed 2026-10-25. The global microphone is for commands and the hosted Agent.
Thread dictation belongs to the right-click composer.

## Microphone session

With Settings → Open mic enabled and Toggle mode selected, Ctrl+Alt+Q opens a
fresh session. The first completed sentence chooses its mode:

- Exactly “open”, ignoring case and punctuation, followed by a one-second pause:
  expand and pin the thread list and latch command mode. Other speech cannot
  switch to the Agent, including the word “agent”. Only “open” is implemented as
  a command so far.
- Other speech: choose Agent mode and deliver each completed sentence to the
  existing Agent send interface after a natural pause. The microphone stays open.
  A later “open” is part of the Agent conversation, not a UI command.

Closing the mic ends that mode; reopening starts undecided. Closing also discards
unfinished/pending transcription, so no delayed command or send escapes a closed
session. The composer mic records into its selected thread independently and
temporarily pauses global speech processing without changing the session's mode.

The local pipeline currently uses a one-second silence threshold, not semantic
end-of-turn detection. It does not produce spoken replies. Busy/failed Agent sends
retain their transcript for explicit retry or discard, without choosing a thread
or answering an Agent permission request. Monitoring can be off while Agent voice
remains available. Existing non-open-mic dictation settings remain supported.

## Native conversation investigation

The desktop-managed Codex CLI (`0.164.0-alpha.11.1`), selected by Threadlight,
and the installed npm CLI (`0.157.1`) both expose experimental voice bindings via
`app-server generate-ts --experimental`:
`thread/realtime/start`, `appendAudio`, `appendText`, `appendSpeech`, `stop` and
`listVoices`. Start accepts a thread ID, output modality, WebSocket/WebRTC transport,
and voice configuration. This supports investigating native voice on the Agent's
owned thread. Generated types are evidence of a protocol surface, not proof of
account entitlement, successful audio, stable support or subscription billing.
No native realtime session was started in this change.

[Claude's voice documentation](https://support.claude.com/en/articles/11101966-use-voice-mode)
explicitly excludes Claude Code and Cowork. Threadlight's Claude Agent uses Claude
Code, so creating another agent thread cannot by itself activate Claude native voice.

[GPT-Live client delegation](https://developers.openai.com/api/docs/guides/live)
can connect a voice conversation to an independently chosen backend agent. It is a
possible common voice front end for Codex and Claude, but requires API integration
and separately billed voice usage. This change adds no cloud audio service.

## Verification

`test/voiceRouting.test.ts` covers session latching and reset. `test/vad.test.ts`
covers pause assembly. The generated-audio tests in `test/ui/voice-routing.smoke.mjs`,
called by the provider UI smoke harness, exercise the real renderer/hook, commands,
composer dictation, agent delivery, held retries, and closed-session stale results.
They do not use the physical microphone or contact either model provider.
