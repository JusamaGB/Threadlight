# Live caption correlation and startup audio

## Reading a code example while Live speaks

The saved receipt call contained a written Python diff, a linked spoken introduction, and a later unlinked caption dictating a different receipt calculation. Replaying those records with the answer first and with the captions first kept the original Python block. The recorded repeat request restored its exact text under the new request.

The isolated renderer also checked that later captions preserve the code element and its scroll position, Copy returns the original indentation, dismissal survives delayed dictation, and the expanded pill ends at the card's bottom edge. A separate routing check covered a late delegation link, replay, and guide invalidation. These checks used recorded and synthetic events.

A saved native call had one user segment, one delegation, one backing turn and one written answer. The voice model rendered the opening and remaining prose with minor wording changes. The previous reader displayed all three assistant records. Replaying the two captions with the updated reader projects one written answer in both current and Earlier. **Spoken reply** retains the actual caption text for inspection.

The native speech submission returns no per-request playback identity. Threadlight tracks which requests existed when a segment began, the local voice session, backing turn, final item and requested excerpt. It checks the actual words and, when supplied, the native turn ID. A small set of explicit spoken grammar alternatives handles the recorded rephrasing. An unfamiliar paraphrase, a changed question or an independent refusal stays visible. A partial that ceases to match becomes independent as soon as its words diverge. Expired, failed, interrupted and superseded submissions cannot claim new speech.

An automatic remainder requires a matching opening caption and its completed playback boundary. An earlier unrelated completion does not release it. Guidance, a new turn, Stop or session closure retires the handoff. If the opening cannot be confirmed, the Agent can offer **Read remaining** for the retained prose in that Live session. This action submits speech only. It cannot execute work, accept a change, or submit the same remainder twice.

The Windows replay checked all 125 opening prefixes in Current and Earlier. Both views kept one written row and retained the two complete spoken segments. Separate transport checks completed a direct refusal before and after its playback ended, including during the genuine opening. The remaining prose was submitted only after the opening ended. An unfamiliar caption kept its own row, and **Read remaining** could submit the retained prose once.

The recorded turn took approximately 4.44 seconds to its first backing token. Opening speech was submitted 0.774 seconds before written completion. The user's physical speech end, first displayed frame and first audible headset frame were not measured. No account call or real microphone was used to replay this incident.

The transport keeps the captured opening at its original sample rate. A startup queue can shrink during steady sound as well as silence. Newly arriving frames can be shortened by up to 20% while there is queued audio. Every source sample contributes to the outgoing frame. Once the queue drains, frames pass at their normal rate. In the focused test a 3.392-second opening was reproduced sample-for-sample and the queue drained within 17.1 seconds of continuous sound.

In a signed-in WebRTC replay, a synthetic recording asked for purple, yellow and orange, with continuous background sound and a 3.392-second starting queue. The updated transport delivered the first word to the preview callback 1.57 seconds after readiness, returned all three colors in order, and drained the queue at 17.18 seconds. This measured receiver captions and the PCM queue, not physical microphone-to-headset latency. The UI check shows the first word before a backing transcript exists and verifies that the final saved line replaces the preview without a duplicate or a second Agent request.

## Speaking the Agent’s conversation

In the saved November 8 session, the backing Agent wrote “I’ll reconnect to the active buffer and continue with the unknown-item message change.” at 23:45:17 UTC. Its voice transcript instead contained the generic editor-check status, followed by the final explanation. The old readout matched a limited vocabulary and scheduled fallback speech from editor activity.

Voice now takes prose from assistant commentary and reads a stable opening sentence as it streams. Further paragraphs queue behind the current speaker. Editor reads update the visual status silently. An isolated signed-in WebRTC replay sent the recorded reconnect sentence through this path, followed by a second receipt sentence. The muted receiver returned both transcripts in order with positive decoded audio energy and no intervening utterance. It used synthetic silence for input. Physical headset timing was not measured.

Agent-handler tests cover the reconnect message and the earlier receipt message containing a Markdown filename. Playback tests cover multiple paragraphs arriving during speech, duplicate item events, stale events, interruptions and verified editor narration. A foreign playback or failed submission cannot release a queued editor instruction. Unconfirmed final prose can offer **Read remaining** for an explicit readout.

The November 9 Shared Space call recorded a completed opening readout at 00:06:53 UTC, then a visible final answer at 00:07:07 with no speech submission. The Live caption quoted the entire opening. A second turn played an old queued sentence after an explicit final readout. Matching now accepts a single pair of presentation quotes around the spoken words, and a manual final readout retires superseded commentary. A signed-in muted receiver replayed the first turn’s opening and the start of its final answer in order with positive audio energy. Tests additionally replay the recorded quote formatting and receiver-only completion events.

## November 9 approval replay

The 00:44 Shared Space turn had two spoken commentary segments attached to the same written message. Both captions were saved, but the final answer about the pending decision had no speech submission. The operation later returned an unavailable receipt requiring an active communication period.

A signed-in replay with a muted receiver heard both opening segments followed by the space availability message. Controlled tests cover an untagged caption completing after audio ends, a corrected partial caption, foreign speech remaining separate, and late confirmation releasing an offered final exactly once. The authenticated tool-connection test submits the approval and receives the final membership receipt on the original call. A paused or expired space returns a reason before any approval card is shown.

## November 9 Coach playback

In the 02:40 UTC Coach call, the Agent wrote `problem.py` and Live captioned the filename as “problem-dot-py”. The timing log recorded audio and the end of the opening, then a written final answer without another speech submission. Replaying the saved opening reproduced the failed match. With the fix, that caption links to the opening, and the following progress paragraph and final answer each go to speech once. The streamed-prefix test covers a filename with two periods and checks that a changed extension, negation or question cannot confirm the same sentence.

A separate signed-in replay used the three original paragraphs, silent input and a muted WebRTC receiver. The receiver returned all three transcripts in order and registered audio energy. In that call it captioned the opening filename as “problem.py” and the final one as “problem dot py”. The controlled replay covers the hyphenated spelling from the reported call.

At 03:03 UTC the learner heard the Coach progress update with “Hmm.” at the start. The ghost editor prepared the first page of notes, and the written answer confirmed the exercise was running. The timing log contained one speech submission. A replay through the Agent event handler reproduced the missing second submission. The first page now permits its setup reply, while later editor-only note preparation stays quiet.

For a spoken request, the next complete progress paragraph or full reply can proceed once the progress submission succeeds and its observed playback ends. It can do so even when the caption differs. Caption matching still controls attribution, partial-answer continuations and queued editor instructions. Tests cover either order of the speech acknowledgment and playback end, a reworded caption, and the recorded “Hmm.” turn. A separate signed-in, muted WebRTC replay returned both original paragraphs in order, with an increase in decoded audio energy for each.

## Voice pace

A signed-in, muted WebRTC receiver measured the first-to-last above-threshold decoded audio for the same 40-word passage in four independent speaker sessions. The exact transcript matched in each trial, with zero microphone requests. In run order the spans were 12.37 s (Normal), 13.10 s and 15.79 s (Slightly slower), then 11.85 s (Normal). These are speaking-style preferences. The measurements cover this passage and do not imply a fixed multiplier or a change in first-audio latency. With the local Windows synthesizer, a second fixed passage produced 10.06 s at Normal and 11.24 s at Slightly slower. The Windows output went to WAV files.

The keyboard slider saved and reset the setting in the built Agent Settings view. A fresh settings store retained it, and the two native session startup paths used the selected instruction outside the quoted content.

Local `live-timing.jsonl` records named phases using monotonic timestamps anchored at each process's time origin and an optional queue duration. It uses numbered calls without transcripts, audio, native IDs or project paths. It includes mic and transport readiness, user input/transcript, delegation, first explicitly final backing delta, the first observed visible answer frame, speech submission, native playback boundaries and first remote PCM above the meter floor. Frame and PCM observations are software measurements, distinct from physical display or headset onset.
