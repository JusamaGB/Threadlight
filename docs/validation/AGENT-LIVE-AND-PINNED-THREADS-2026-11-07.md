# GPT Live replies and pinned Smart Threads

## Signed-in Codex Live

An isolated Chrome session connected to the signed-in Codex Agent over WebRTC.
The Agent read a disposable thread and reported its colour, amber. The test
changed the thread to cyan and asked a follow-up using generated speech. It
verified a fresh read, a completed Live transcript containing cyan, and new
incoming audio energy during the follow-up. The computer’s microphone and
speakers were outside this check.

## Thread composer and microphone

The isolated renderer check opened a pinned Smart Thread during an Agent Live
session. A generated tone on the open mic became silence on the outgoing Live
track while the thread composer recorded. The composer displayed its listening
waveform, and the Live indicator in the panel turned red. After transcription,
the text appeared in the thread composer and outgoing audio resumed on the
connected peer. This check used a simulated provider and transcription result.

A separate floating-window check verified the red waveform, its accessible mute
label, the action to reopen the panel, and the square Stop button. A transport
test verified that muting the input leaves reply playback enabled.

## Opening pinned threads

The isolated renderer check opened a pinned thread beneath Agent with the
keyboard and read its conversation alongside its pending question. Pointer
checks expanded the same reader beneath Recent, Settings and Shared Spaces.
The Notes tab and its unsent draft remained visible above the conversation.
The native Back event, header Back button and row toggle collapsed the reader
without navigating away from the current page.

## Regular Windows app

The regular app restarted from the primary checkout after the Agent, Shared
Spaces, microphone, relays and test observer were idle. The new process loaded
the rebuilt renderer and retained Local STT and the Codex Agent selection.

After installing the pointer-leave fix, **Settings → Restart now** was exercised
on the regular Windows app. A new Electron process loaded the verified build.
An isolated native-window test also delivered a late pointer-leave and panel
close after destroying the dot first and after destroying the panel first.
Both orders completed without the reported exception.
