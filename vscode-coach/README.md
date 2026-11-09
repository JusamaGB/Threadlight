# Threadlight Live Coach

Say “Select Threadlight Coach” to start a personalized lesson. Ask to change your current course week or how the coach gives hints. Approve the profile change to use it in future lessons. Say “stop coaching” to leave. Connecting the editor makes its tools available for requested editor help.

Connect a trusted Windows desktop VS Code window to the foreground Codex GPT Live conversation in Threadlight. Open the source file and run **Threadlight: Start Live Coaching** from the Command Palette. Start Live in Threadlight and ask it to walk through the code.

### Ghost walkthroughs

If ordinary ghost text or diffs work but narrated practice is missing, ask Coach to check the loaded companion version. Narrated practice requires 0.6.14 or newer. After installing the update, run **Developer: Reload Window** and then **Threadlight: Start Live Coaching** in the VS Code window containing your file. Coach can read the active file directly, without a pinned copy.

With 0.6.15, ask “Make line 64 onwards in this file ghost text and explain each line as I type.” Coach places the caret at line 64. Only the requested range dims, and typing matching characters reveals their normal syntax colours without changing the source. Press Enter to move to the next line, Backspace to trace a character again, or Escape to resume editing. **Threadlight Settings → VS Code → Ghost practice location** selects **Current file** (default) or **Practice copy** for existing code. A copy retains the original line numbers and surrounding code.

You can also right-click and choose **Threadlight: Practise Ghost Text** for a selection or the whole file. New blocks at the caret use Trace in the working file. Generated examples and pending proposals use an untitled practice tab. A removed diff row is shown struck through. Click it to hear why it was removed. Accepting a proposal is a separate action in its original review.

The first matching non-space character starts the explanation once. In a practice tab, click any row or press Enter to move on. Escape ends practice. A multiline paste ends row-based practice and preserves the pasted text. Use **Threadlight: Replay Trace Line** to hear a line again. Click the trace status to mute or unmute. **Threadlight Settings → VS Code → Spoken ghost walkthroughs** controls speech across exercises. An ordinary ghost suggestion starts silently.

For a spoken file walkthrough, ask “Walk me through this file starting at line 76.” Omit the line number to start at the first Python statement after introductory documentation, comments and blank lines. A requested line number takes precedence. Live Coach 0.6.17 highlights the first line and prepares its notes silently.

- Choose **Auto** (checked by default) and click **Start** to continue after each spoken explanation. Clear **Auto** for manual pacing. **Next** takes the place of **Start**. You can change Auto while listening.
- Click a line number to hear that line. Clicking or selecting code leaves the explanation alone. Drag across line numbers in either direction and release to hear one explanation of the section. Before Start, a selection plays once and waits. Once started, Auto continues after the selected line or section. In manual mode, **Next** continues there.
- The controls sit above the current line. With CodeLens hidden, use the walkthrough status bar item or **Threadlight: Walkthrough Controls**. Progression skips blank lines. Editing the document, switching source tabs or using **Threadlight: Cancel Current Guide** ends the walkthrough.

For a typing exercise, ask the coach to wait for **Next step**. Each step highlights a verified line before Live explains it. Say “what’s next?” or click **Next step** when you’re ready. **Finish guide** ends the last step. The status bar also provides the step action when CodeLens is disabled.

Typing removes a stale highlight quietly. When a step declares one exact target line, the connected companion checks that line, including indentation, in a fresh snapshot before asking the coach to reassess the step. An incomplete edit stays quiet. For an open-ended step, say “I’m done,” “check this,” or “what’s next?” to request the same fresh check. **Refresh guide** also stays available. If you changed tabs, return to the original source. The guide belongs to the connected Live session.

Ask “What should go on that line?” or “Could you fill that line for me?” **Trace** reads the open buffer and moves the caret to the verified insertion point. No selection is required. The suggested text appears as native ghost text, including indentation and new lines. Type along to turn the matching prefix into real code. Backspace reveals more of the guide. Tab indents, Esc dismisses, and typing something different keeps your text and clears the suggestion. Switching editors, editing elsewhere, or ending coaching clears it too. Say “I’m done, let’s move on to the next one” to have Live check your current code before continuing a guide.

When asked to show an example, the coach provides the actual fenced code in its answer. The collapsed waveform can display that code beneath the spoken explanation.

Trace uses VS Code’s inline suggestions. Enable **Editor: Inline Suggest Enabled** to see them, and **Editor: Inline Suggest: Syntax Highlighting Enabled** for subdued language colours. Your theme controls the rendering. Your own keybindings and other suggestion providers can affect what VS Code shows.

With companion 0.6.2, normal typing and Backspace update the existing ghost text without repeatedly invoking VS Code’s explicit suggestion command and its sound cue. The initial requested suggestion still follows VS Code’s accessibility sound preference. Editing marks the guide for a fresh check; it does not automatically resume it or play a Threadlight pause/resume sound. Say “continue” when ready.

Ask “There are issues in my file; show me the inline diffs.” Each proposal opens in the active editor at the first affected line. Read each red original immediately above its green replacement. Standalone additions and removals have one row. Unchanged context stays in the source. The same layout works at every editor width.

The original keeps its source line number. Each colored row fades after its own text. The gray current-line bar fades just beyond the longest visible source line. Threadlight leaves the caret unselected and uses space beneath the source for the green rows. When the additions need more room or editor settings prevent inline rows, the proposal opens in a read-only file review. **Result** in the status bar shows the resulting file and **Why this edit?** opens the explanation. Click anywhere in the file, select text, scroll or visit another tab. Returning to the review restores its shortcuts. Tab applies the proposed edit to its original lines wherever you placed the cursor. Typing your own correction in the source invalidates the proposal.

With 0.6.12, ask “walk me through this diff” while a proposal is pending. The coach selects the first changed line in the read-only review. Ask about the current line, say “next line” or “previous line,” or say “next proposal” to move to another change. If a highlight is unavailable, the coach can still discuss the verified line. At the last line the proposal stays open for your decision.

Press **Tab** to accept one proposal or dependent group into the unsaved buffer. One Undo restores it. Use **Alt+]** to navigate, **Alt+Backspace** to skip or **Esc** to dismiss. After accepting, reveal the next one when ready. If another inline provider has a visible suggestion, use **Threadlight: Accept Proposed Change** from the Command Palette to accept this proposal. Ask for an explanation while voice coaching is active; Live speaks after the location is displayed. Saying “next” navigates once and never accepts code.

For alternatives to an intentional selection, select a single range, including part of a line, and ask Live, “Show me an inline correction for this selection. Give me two versions.” A struck-through selection marks the original. An expanded VS Code review thread shows the proposed replacement below it, including multiline indentation. Keep editor comments visible. The selection must fit the shared excerpt (up to 60 lines and 12,000 characters).

With the source text focused, use **← / →** to cycle available versions, **Tab** to accept the displayed version, or **Esc** to dismiss it. The same actions are available in the Command Palette. Tab-to-move-focus, suggestions, snippets and rename inputs retain their keys. Accept replaces the originally selected range in one undoable edit. You can move the cursor, change the selection or visit another tab and come back. Editing the source, closing it or ending coaching clears the preview. VS Code may also show the Comments panel according to your Comments: Open Panel setting.

Ask for a **separate diff** to open the comparison between two read-only snapshots. Return to the source tab to continue the guide.

For a manually paced exercise, say “Walk me through this function one line at a time. Wait for me to click Next.” When you want to compare an alternative, say “Show me a separate read-only diff for that change so I can decide whether to try it.”

**Threadlight: Stop Editor Coaching** disconnects this window. Ending Live clears the current guide. Starting coaching in another window selects that window for the next connection. Enable coaching again after reopening VS Code.

## Review the whole active file

With coaching enabled, open the source tab and ask Live “Something is wrong with the file I have open in VS Code. Review the whole file and tell me what you think is wrong, if anything.” The cursor can be anywhere. Live reads the open buffer, including unsaved changes and untitled text, in pages of up to 2,048 UTF-16 units. A file over 32,768 units returns its size and zero coverage. Switching tabs, editing the buffer or disconnecting invalidates unfinished pages.

The review starts each located finding with its line number, gives a short explanation and says when no issue is apparent. Ask for more detail if needed. The final page includes the current editor diagnostic count and up to eight messages, each limited to 200 units. Static findings and editor diagnostics are distinct from runtime behaviour. Review leaves the source untouched.

## Automatic Python suggestions

To try a local completion, type `print(subtotal)` on one line of a Python file, then type `pri` on the next. If IntelliSense highlights `print`, Threadlight can show the rest of `print(subtotal)` in grey beside the list.

In Threadlight **Settings → VS Code → Automatic Python suggestions**, choose **On**, or ask your Threadlight Agent “Turn on automatic Python suggestions” and approve its settings change. Open a Python file in a trusted window. The choice survives restarts and local suggestions work with Threadlight closed. Choose **Off** to disable them. The default **VS Code setting** follows the editor checkbox: press **Ctrl+,**, search for `@id:threadlight.coach.pythonSuggestions`, and check **Python Suggestions** under User. In a Python buffer up to 32,768 UTF-16 units, pause briefly while typing. Local completions use the current file and Python patterns. VS Code supplies normal inline suggestion acceptance, partial acceptance and dismissal, subject to your settings and keybindings. Learning Trace still lets you type along and indent with Tab.

After a related edit, a small status action can offer the next location. Click it or press **Alt+]** to inspect the proposed replacement or deletion. Typing elsewhere cancels it. Nothing is spoken automatically. **Threadlight: Choose Python Completion Model** lets you optionally select a model already available through VS Code for this window. That provider receives bounded source excerpts and may require its own access. Local suggestions work without it. Ask Live which companion capabilities are loaded to check the connected version and current Python mode.

## Install from source

From this directory, run `npx --yes @vscode/vsce package --no-dependencies`, then `code --install-extension threadlight-live-coach-0.6.17.vsix`. After your active session ends, run **Developer: Reload Window** in the connected VS Code window, then open a Python file for automatic suggestions. For voice or Agent file reviews, run **Threadlight: Start Live Coaching**. Restart Threadlight from the updated primary checkout, then open a fresh foreground GPT Live Agent so it receives the proposal and Trace tools. An open window can keep running its earlier companion after a new version is installed. If that companion lacks whole-file review, Live reports zero coverage. Saving the source file does not activate an extension update.
