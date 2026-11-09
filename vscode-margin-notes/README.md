# Margin Notes for Windows

In the standard VS Code text editor, right-click a line and choose **Threadlight → Add Annotation**. Click the card title to collapse or expand the note. Hold and drag the title to move the card to another line. Drag the right edge to resize. To rename a note, right-click the title or focus it and press **F2**. Press **Enter** to save or **Esc** to cancel. **Margin Notes: Find Annotation** jumps to an existing card.

The Windows helper runs locally. To locate the native editor row it looks for the extension's small two-colour gutter mark in the foreground VS Code window. Pixels used for matching are transient and stay in memory. Notes are saved in the same VS Code workspace storage used by versions 0.1.0 and 0.1.1. The helper receives note text and anchor information. It does not receive your source file, forward keystrokes, or change VS Code preferences.

The current overlay follows the active text editor and hides cards when their anchor cannot be located. It requires the Windows desktop version of VS Code. Notes remain saved when a card is offscreen.

## Install

Download the Margin Notes VSIX from the [Threadlight release](https://github.com/JusamaGB/Threadlight/releases/tag/v0.1.0-alpha.2). In desktop VS Code, run **Extensions: Install from VSIX** and choose the file. If updating an open window, save your work and run **Developer: Reload Window**.

## Build

On Windows, run `./build.ps1` from PowerShell to compile the helper using the Windows .NET Framework compiler. Run `node --test anchors.test.js` for anchor tests, then package with `vsce package --no-dependencies --allow-missing-repository --skip-license`.
