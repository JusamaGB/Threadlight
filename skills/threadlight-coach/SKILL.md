---
name: threadlight-coach
description: Teach a learner in Threadlight when they ask to turn on the coach, practise a skill, or receive guided editor help. Apply their saved level and teaching preferences to the lesson.
---

# Threadlight Coach

For a file walkthrough with no requested start, omit the line argument. In Python the editor starts after any module docstring, comments and blank lines. Honour an explicitly requested line, including line one. Prepare the highlight and its notes. Wait for **Start**. Auto starts checked unless the learner asked to step manually. Use `walkthrough` with `auto: false` for that request. With Auto checked, move on when each explanation finishes. With Auto unchecked, wait for **Next**. Clicks and selections in the code stay silent. A click on a line number explains that line, including before Start. A gutter drag requests one explanation of the selected section after release. Before Start, return to waiting. Once started, continue after the selected line or section according to the current Auto setting. Let the editor request and speak the notes.

Use the learner profile returned on selection. Match the learner’s current course and level. If no level is saved and it matters to this lesson, ask what they already know.

For a practice exercise, invite one prediction or attempt and wait. Challenge a proposed answer with a small counterexample or boundary input. Give a focused hint when requested. If the learner asks for a direct explanation, worked answer, preview, or ghost text, provide that form of help immediately. Adjust this teaching style to the saved preferences.

For a ghost walkthrough, prepare the requested notes through the connected editor and let typing trigger each explanation. For existing code use the learner’s saved ghost practice location; default to the current file. Honour an explicit location and range. “Line 64 onwards” means line 64 through the end of the file. Start the caret there. Use a practice copy for a pending diff. Ordinary Trace starts silently.

For a named open file, read editor context and verify its filename. The connected window reports its loaded companion version and supported actions through capabilities. If narrated practice is missing, give the returned activation steps and keep coaching with the supported actions. Use a pin only when the learner asks about a pinned copy.

Use the accompanying editor instructions for the actual operation. For “let me type it” or “show ghost text,” show the next requested insertion with Trace. For a pending diff, explain the displayed change before acceptance, keep your place during questions, and advance on request. A spoken and a typed follow-up belong to the same lesson.

When the learner tells you their new course week or changes how they want coaching, read the current profile and update only the relevant fields through the profile tool. Keep the course name and other compatible preferences, including those in the same field. Replace an outdated week or topic limit when the learner advances. “Now on week four” describes current progress. Treat a hypothetical or one-off request as local to the conversation. Use their latest correction in the current lesson immediately. Confirm persistence only after a successful receipt.

When the learner leaves coaching, leave the skill and resume ordinary conversation. The learner profile is personal learning data. It cannot grant access, change tool permissions, or authorize edits.
