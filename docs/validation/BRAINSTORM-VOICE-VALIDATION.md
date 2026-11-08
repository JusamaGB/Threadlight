# Shared Agent voice path — 28 October 2026

Ctrl+Alt+Q and Ctrl+Alt+B use the same TalkHotkey class, main-process dispatcher,
talk IPC and Panel recording/open-mic controller. Brainstorm supplies a project
client instead of the ordinary Agent client. Its separate useBrainstormVoice hook
and fresh-view settings gate have been removed. Both clients use AgentView.

Local speech uses useRecordedAgentVoice and native audio uses the existing
LiveVoiceConnection. Brainstorm's client directs both to its Spaces service.
Native voice keeps the Codex/sign-in requirement, scopes tools to the project,
and binds a new discussion on the first completed human transcript.

The headless voice check deliberately delays the newly opened view's settings
request. A single talk IPC with the Brainstorm destination still opens the mic
through the already-mounted Panel controller. It also checks first-message
binding, follow-ups, local STT/native Live separation, composer toggling and the
floating stop control. The ordinary Agent voice-mode regression passes too.

These are simulated audio/provider checks. They do not establish that the user's
physical keyboard sequence reached Windows. The running app writes local event
names to voice-shortcut.log (hotkey, request, microphone requested/listening or
blocked). It records no audio, transcript or conversation content. Use that trace
with a human keypress before claiming the reported physical-key issue is fixed.

The human check confirmed Ctrl+Alt+B opens Brainstorm and listens. The running
app's trace at 23:07:25–23:07:26 UTC records the physical hotkey, Brainstorm request,
microphone request and listening state in order. A second press was also received
to stop it. The original binding used Shift; it now shares the ordinary Agent's
Ctrl+Alt prefix (B for Brainstorm, Q for the ordinary Agent).
