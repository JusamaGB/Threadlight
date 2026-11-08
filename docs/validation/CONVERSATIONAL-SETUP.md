# Conversational setup on Windows

Checked 7 November 2026 in an isolated copy of the working source on Windows 10
build 19045 with Node 22.23.4. The trial used a path containing spaces, fresh
application settings and isolated Codex and Claude configuration directories.
The installed native provider CLIs came from this PC. These checks cover the
local revision. A fresh GitHub download will gain this setup path when the
revision is published.

| Check               | Observation                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install from source | The installer installed dependencies with `npm ci` and completed the production build with empty initial build output.                                                                                                                  |
| Provider choices    | Claude-only, Codex-only and Perplexity-only runs wrote the requested visibility settings. The Codex and Perplexity paths did not require Claude configuration. Perplexity-only setup selected Recent chats.                             |
| Coding plugins      | The native Claude and Codex clients registered their marketplaces and installed Threadlight. The Claude list parser handles the client's formatted JSON output. Both plugin packages include the shared-memory and setup skills.        |
| Retry and removal   | Repeated setup reused the registration. Uninstall removed installer-added plugins and marketplace registrations and retained the saved settings.                                                                                        |
| Diagnostics         | Isolated unsigned profiles surfaced sign-in requirements. Diagnostics distinguish plugin installation from user-reviewed hook trust and current app availability.                                                                       |
| Perplexity skill    | The standalone Markdown file has the required name and description, validates as a skill and matches the canonical setup instructions. It guides setup through the user's PC or gives commands for manual execution from a remote chat. |

The initial plugin installation trials used `--no-start` and exercised separate
provider profiles. A subsequent clean Windows launch test is recorded below.

All three skill files passed frontmatter validation. The plugin consistency check
passed, as did 55 focused settings and plugin tests. Temporary trial profiles and evidence were retained outside the checkout.

## Fresh Windows launch

On 7 November 2026 a disposable Windows 10 x64 sandbox (build 19041) ran the
ordinary source installer with Node 22.23.4 and `--providers perplexity`.
The test began with a new Windows user, a source folder containing spaces,
no Threadlight settings, no dependencies or build output, and no signed-in
provider apps. The host supplied Node and the local alpha source snapshot.

The first trial built successfully but Electron's native archive extractor failed
to load and the app did not start. The installer now checks Electron's pinned
Windows archive checksum, extracts with Windows tar, and verifies the executable
and runtime version before launch. The source snapshot includes the three PNG
sizes needed by the Windows tray.

**Passed on the corrected snapshot.** The installer downloaded the dependencies
and desktop runtime, built production output, started Threadlight, and returned
the running app version `0.1.0-alpha.1`. An independent check identified the
main and renderer processes by their executable path inside the new checkout,
queried the live app status, and read back the expected Perplexity settings.
The checked source ZIP's SHA-256 was
`0bed79dd21cee01d21b5857db42f95988f8b084e4a56eef1a71a901eb70de16d`.
This was a local alpha candidate. Publication is on hold.

The clean install and process checks also passed in a second disposable
account. The tray interaction check remains **unverified**. Windows UI
Automation did not expose the expected notification button, and the test did
not observe a panel opening from a tray click. A renderer process and a
successful app status response establish startup but do not establish a
visible, usable panel. The sandbox was closed after testing.

## Provider coverage

- **Claude Code and Codex setup:** Native clients installed the plugins and loaded
  the setup skill in isolated profiles. The earlier retry and uninstall checks
  retained saved settings. Fresh-account sign-in, user-reviewed hook trust and
  human approval for shared-memory pairing were outside the launch test.
- **Perplexity desktop chats:** A separate signed-in test on the maintainer's PC
  verified a Shared Space opening message, a follow-up reply and its return to
  the Agent inbox. See [provider acceptance](SPACE-PROVIDER-CHAT-ACCEPTANCE.md).
- **Perplexity-led installation:** The standalone Markdown skill passed local
  format validation. Computer use was unavailable on the trial account. Upload,
  name-only discovery and automatic installation from a Perplexity conversation
  remain unverified.
- **Live features in the regular app:** GPT chat discovery, spoken replies with
  Local STT selected, waveform and Stop, and Smart Thread text copying have
  [separate running-app evidence](PROVIDER-HEALTH-VOICE-SELECTION-2026-11-07.md).
  [Grouped Agent turns](AGENT-GROUPED-TURNS-2026-11-07.md) were checked against
  actual saved history.

For the candidate's broader preflight, the full unit run had 1,156 passes, 10
skips and one Electron proxy timeout. The timed-out test passed when rerun alone.

To repeat, use a disposable Windows account with the intended desktop clients.
Clone the revision to test, run `node scripts/install.mjs --providers codex`
(or select the desired comma-separated list), and run the matching `--check`.
Verify the dot or tray, a known chat, and a new coding session's hook event.
For shared memory, approve that chat's code in its intended space and have it
read its briefing. For Perplexity Computer, upload the standalone Markdown
through Plugins, verify it appears under Installed, and ask it to set up
Threadlight on the intended PC. Record which steps ran locally and which
required user sign-in or approval.
