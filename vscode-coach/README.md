# Threadlight Live Coach

Connect a trusted Windows desktop VS Code window to the foreground Codex GPT Live conversation in Threadlight. Open the source file, place the cursor near the code you want to discuss, and run **Threadlight: Start Live Coaching** from the Command Palette. Start Live in Threadlight and ask it to walk through the code.

To turn a discussion into a walkthrough, ask “Could you show me one step at a time?” Each step highlights a verified line before Live explains it. Say “what’s next?” or click **Next step** when you’re ready. **Finish guide** ends the last step and Live acknowledges the click. To stop early, ask Live to end the guide or use **Threadlight: Cancel Current Guide**. The status bar also provides the step action when CodeLens is disabled.

Editing pauses the walkthrough and removes the stale highlight. **Refresh guide** stays available in the source tab and status bar. When ready, click it or say “continue.” Live reads the updated editor context and reassesses the current task before highlighting again. If you changed tabs, return to the original source. The guide belongs to the connected Live session.

Ask “What should go on that line?” or “Could you fill that line for me?” **Trace** reads the open buffer and moves the caret to the verified insertion point. No selection is required. The suggested text appears as native ghost text, including indentation and new lines. Type along to turn the matching prefix into real code. Backspace reveals more of the guide. Tab indents, Esc dismisses, and typing something different keeps your text and clears the suggestion. Switching editors, editing elsewhere, or ending coaching clears it too. Say “I’m done, let’s move on to the next one” to have Live check your current code before continuing a guide.

Trace uses VS Code’s inline suggestions. Enable **Editor: Inline Suggest Enabled** to see them, and **Editor: Inline Suggest: Syntax Highlighting Enabled** for subdued language colours. Your theme controls the rendering. Your own keybindings and other suggestion providers can affect what VS Code shows.

With companion 0.6.2, normal typing and Backspace update the existing ghost text without repeatedly invoking VS Code’s explicit suggestion command and its sound cue. The initial requested suggestion still follows VS Code’s accessibility sound preference. Editing marks the guide for a fresh check; it does not automatically resume it or play a Threadlight pause/resume sound. Say “continue” when ready.

Ask “There are issues in my file; show me the inline diffs.” Coach reviews the current buffer and chooses exact locations. It reveals one change at a time, including changes outside the current viewport. Short changes appear beside the original code. Multiline or grouped changes use an expanded review thread, which requires visible editor comments. The first range is ready for typing your own correction. Changes to the buffer cancel stale proposals. Previewing or skipping does not edit or save.

Press **Tab** to accept one proposal or dependent group into the unsaved buffer. One Undo restores it. Use **Alt+]** to navigate, **Alt+Backspace** to skip or **Esc** to dismiss. After accepting, reveal the next one when ready. If another inline provider has a visible suggestion, use **Threadlight: Accept Proposed Change** from the Command Palette to accept this proposal. Ask for an explanation while voice coaching is active; Live speaks after the location is displayed. Saying “next” navigates once and never accepts code.

For alternatives to an intentional selection, select a single range, including part of a line, and ask Live, “Show me an inline correction for this selection. Give me two versions.” A struck-through selection marks the original. An expanded VS Code review thread shows the proposed replacement below it, including multiline indentation. Keep editor comments visible. The selection must fit the shared excerpt (up to 60 lines and 12,000 characters).

With the source text focused, use **← / →** to cycle available versions, **Tab** to accept the displayed version, or **Esc** to dismiss it. The same actions are available in the Command Palette. Tab-to-move-focus, suggestions, snippets and rename inputs retain their keys. Accept replaces just the selection in one undoable edit. The companion does not save the file. Switching editors, editing the text, moving the selection or ending coaching invalidates the proposal. VS Code may also show the Comments panel according to your Comments: Open Panel setting.

Ask for a **separate diff** to open the comparison between two read-only snapshots. Return to the source tab to continue the guide.

For a first walkthrough, put the cursor inside a function and say “Walk me through this function one line at a time. Wait for me to click Next.” When you want to compare an alternative, say “Show me a separate read-only diff for that change so I can decide whether to try it.”

**Threadlight: Stop Editor Coaching** disconnects this window. Ending Live clears the current guide. Starting coaching in another window selects that window for the next connection. Enable coaching again after reopening VS Code.

## Review the whole active file

With coaching enabled, open the source tab and ask Live “Something is wrong with the file I have open in VS Code. Review the whole file and tell me what you think is wrong, if anything.” The cursor can be anywhere. Live reads the open buffer, including unsaved changes and untitled text, in pages of up to 2,048 UTF-16 units. A file over 32,768 units returns its size and zero coverage. Switching tabs, editing the buffer or disconnecting invalidates unfinished pages.

The review starts each located finding with its line number, gives a short explanation and says when no issue is apparent. Ask for more detail if needed. The final page includes the current editor diagnostic count and up to eight messages, each limited to 200 units. Static findings and editor diagnostics are distinct from runtime behaviour. Review leaves the source untouched.

## Automatic Python suggestions

In Threadlight **Settings → VS Code → Automatic Python suggestions**, choose **On**, or ask your Threadlight Agent “Turn on automatic Python suggestions” and approve its settings change. Open a Python file in a trusted window. The choice survives restarts and local suggestions work with Threadlight closed. Choose **Off** to disable them. The default **VS Code setting** follows the editor checkbox: press **Ctrl+,**, search for `@id:threadlight.coach.pythonSuggestions`, and check **Python Suggestions** under User. In a Python buffer up to 32,768 UTF-16 units, pause briefly while typing. Local completions use the current file and Python patterns. VS Code supplies normal inline suggestion acceptance, partial acceptance and dismissal, subject to your settings and keybindings. Learning Trace still lets you type along and indent with Tab.

After a related edit, a small status action can offer the next location. Click it or press **Alt+]** to inspect the proposed replacement or deletion. Typing elsewhere cancels it. Nothing is spoken automatically. **Threadlight: Choose Python Completion Model** lets you optionally select a model already available through VS Code for this window. That provider receives bounded source excerpts and may require its own access. Local suggestions work without it. Ask Live which companion capabilities are loaded to check the connected version and current Python mode.

## Install from source

From this directory, run `npx --yes @vscode/vsce package --no-dependencies`, then `code --install-extension threadlight-live-coach-0.6.2.vsix`. After your active session ends, run **Developer: Reload Window** in the connected VS Code window, then open a Python file for automatic suggestions. For voice or Agent file reviews, run **Threadlight: Start Live Coaching**. Restart Threadlight from the updated primary checkout, then open a fresh foreground GPT Live Agent so it receives the proposal and Trace tools. An open window can keep running its earlier companion after a new version is installed. If that companion lacks whole-file review, Live reports zero coverage. Saving the source file does not activate an extension update.
