# Privacy

Threadlight is a local Windows application. It has no Threadlight account system,
analytics service or hosted backend. Local operation does not mean all features
work offline.

## What it reads and stores

- Claude Code and Codex session metadata/history, installed desktop activity and
  provider-owned local records, to show threads, messages, status and changes.
- Ordinary ChatGPT and Perplexity history through their installed desktop apps.
- Workspace files and Git data when you use change review, artifacts or project tools.
- Local settings, drafts, delivery/recovery records and application-owned state.
  Ordinary-chat drafts persist across navigation and restart.
- Shared Spaces notes, published evidence, handoffs and workflow records in the
  selected workspace. Only deliberately shared context is made available through
  approved project connections; installing a plugin alone grants no access.

Approved plugin pairings persist until disconnected or revoked. The app stores
credential hashes; the bridge stores its secret in the private account-scoped
memory-auth directory. Do not share that directory or application data backups.

Application data is normally under `%APPDATA%\Threadlight`. Local speech models
have their own model directory there. Shared Spaces and intentionally saved copies
remain in their chosen workspace locations. Provider apps keep their own data.

## When data leaves your computer

- Sending a reply or using the hosted Agent invokes your selected provider. Its
  account terms, retention and usage limits apply.
- GPT Live sends microphone audio to the provider while that voice mode is active.
  Local STT processes audio on your PC after you approve its model download.
- The optional VS Code companion connects only after you enable coaching in a trusted
  desktop editor window. During a foreground GPT Live coaching request, the provider
  can receive the file name, language, selected line numbers, exact selected text and a bounded excerpt
  around the selection, including unsaved edits. Asking for a whole-file review shares the
  supported active buffer and a bounded sample of its current VS Code diagnostics with the
  foreground Live Agent. The local connection uses an
  authenticated Windows named pipe. Comparison snapshots stay in VS Code's memory.
  Inline replacements are proposals until you accept one into the editor buffer.
  Trace keeps its suggestion and insertion point in memory. When Live requests
  fresh editor context it can see the cursor position, suggested text and what
  you have typed at that point. Automatic Python suggestions are off by default. When enabled, local suggestions run in trusted Python editors even with Threadlight closed. The companion reads the saved Python preference from the regular Threadlight settings. Opening Python does not connect a Live session or share the buffer. If you explicitly choose a
  VS Code language model, completions can send up to 3,000 UTF-16 units before
  and 750 after the cursor. For a related edit it can receive up to 3,750 units
  of numbered lines and a bounded sample of the recent change. The selected model
  and its provider handle that data. Choosing Local suggestions only or stopping
  editor coaching clears the model choice. Ordinary completions are silent.
  The companion does not issue a save. Stop coaching from its Command Palette to disconnect the window.
- During Codex GPT Live, Threadlight observes the foreground window locally while
  you speak. A screen-help tool can return its app name and title, or an image of
  the referenced window for visual questions. Holding Ctrl, right-dragging and
  releasing Ctrl sends the selected desktop pixels to that Live conversation.
  The provider receives the image. The local Agent history index saves a text
  receipt; the thumbnail is shown in the current conversation.
- Enabling **Outside Live** enables the gesture while the app is running.
  Releasing Ctrl sends the selected pixels and foreground app name to your
  configured Agent in a new conversation. Pending captures stay in memory.
  **Speak reply** sends a completed Codex answer to the signed-in GPT Live
  voice service for playback. Claude answers use local Windows speech synthesis.
  Neither path opens a microphone. Threadlight keeps the recent conversation
  reference and a short reply excerpt in its local app data for the header diamond.
- Pinned snapshots and their available source labels, including file paths, are
  stored in Threadlight’s local app data. A pin stays visible while the main panel
  is hidden. The foreground Agent can request the pin list with brief previews and
  read the code through its provider connection. Replacing the pinned copy requires
  an Agent decision. Each approved replacement or append saves a new local
  version. The foreground Agent can request an earlier saved version of the pin.
  Unpin removes the entry and its versions from the local store. Content already sent to a provider follows that chat’s
  history settings.
- Perplexity Computer uses Perplexity's service and may consume credits. Its OAuth
  sign-in is encrypted using Windows DPAPI.
- Links open in your browser. Dependency installation, model downloads and provider
  operations require network access.
- Tools available to a provider or an authorized workflow may contact other services
  or modify files under their granted authority. Review their requests and scope.

Threadlight does not intentionally copy provider authentication files into project
content. Native account-chat tokens stay in the main process and are stripped from
renderer responses. Logs, screenshots, exported evidence and workspace contents can
still contain sensitive data; review them before publishing or attaching to issues.

## Removal and control

Revoke shared-memory connections in the app and revoke provider authorizations in
the relevant provider account. Disable sign-in launch and quit before removing the
checkout. The setup script can remove installer-owned integration with
`node scripts/install.mjs --uninstall`; `--remove-data` is a separate destructive
choice. Removing app data does not remove provider history, workspace Shared Spaces
or copies you deliberately saved elsewhere.

See [Security](SECURITY.md) and [local IPC boundaries](docs/security/LOCAL-IPC.md).
