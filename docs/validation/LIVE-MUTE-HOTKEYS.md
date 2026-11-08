# Windows Live mute shortcuts and Settings

Threadlight registers the unmodified Windows Pause key (VK_PAUSE, 0x13) and Ctrl+Alt+M for the current call. Both request MOD_NOREPEAT. A registration failure for one leaves the other available. Each registration gets a fresh message ID, so messages queued before suspension or call teardown cannot toggle a newly registered call. Windows defines Ctrl+Break as VK_CANCEL. [Windows virtual keys](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes) and [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey).

- A private Windows test desktop registered Pause through the production adapter on a hidden Electron window. A second window’s attempt to claim Pause failed. A WM_HOTKEY posted directly to the first window reached the toggle callback. Suspension released Pause for the second window. After reacquisition, a queued old ID was ignored and the new ID worked. Ctrl+Alt+M was already occupied during this test and its failure did not prevent Pause from working.
- Focused tests using a substitute registrar checked both virtual keys, modifier flags, repeat suppression flags, independent conflicts, Talk precedence, capture suspension, late messages and release after the call.
- The isolated panel routed mute and unmute to the active foreground Agent and Brainstorm with substitute audio. The test hid and restored the renderer, ended the simulated session and verified that another mute event left it closed. No provider was contacted.
- The narrow Settings check opened the collapsed Hotkeys control by keyboard, verified the mute keys and companion entries, captured F8 for Talk, and reopened the disclosure to check the saved value. Registration errors remained visible when the disclosure was collapsed.

Run the focused Vitest files `test/hotkeys.test.ts` and `test/accelerator.test.ts`. The renderer checks in `test/ui/providers.smoke.mjs` use `THREADLIGHT_UI_FOCUS=hotkeys` and `THREADLIGHT_UI_FOCUS=hotkeys-routes`.

The native test posted messages to its own window. Physical Pause key presses, held-key behaviour on a particular keyboard, Fn mappings and headset playback remain manual checks. The regular application and its microphone were left alone.
