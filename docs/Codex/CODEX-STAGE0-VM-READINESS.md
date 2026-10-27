# Stage 0: disposable VM readiness and remaining tests

Checked: 25 October 2026. Scope: read-only discovery of an environment for the remaining desktop connection tests.

Subsequent update: the user selected the local PC. Windows Sandbox has now been enabled through administrator-approved setup, with automatic restart suppressed. Windows reports that a restart is required; no guest has been launched. See [local VM setup status](CODEX-STAGE0-LOCAL-VM-SETUP.md). The inventory below records the state before that setup.

## Availability result

**No ready Windows guest or usable local Windows VM manager was found in the checked configuration. No VM tests have run in this phase.**

| Item                                          | Observation                                                                                    | Consequence                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Host OS                                       | Windows 10 Pro, x64, build 19045                                                               | Windows virtualization features are optional, not currently ready for this experiment   |
| Hypervisor                                    | Reported present                                                                               | This alone does not establish a usable Windows guest or Hyper-V management environment  |
| Hyper-V role, services and PowerShell feature | Disabled; management commands/module and VM registration directory not found                   | Cannot create or manage a Hyper-V guest with the present setup                          |
| Windows Sandbox                               | Optional feature disabled; executable not found                                                | Cannot launch a disposable Windows Sandbox now                                          |
| VirtualBox, VMware and QEMU                   | No matching command, standard executable, running VM process or installed-app entry found      | No existing alternative manager identified; custom portable locations are not ruled out |
| WSL                                           | WSL and Virtual Machine Platform enabled; one Ubuntu WSL 2 distribution registered and stopped | Not a Windows desktop guest; it was not started                                         |
| Memory snapshot                               | Approximately 16 GB installed and 5 GB free at discovery                                       | An additional desktop guest could compete with concurrent host work                     |
| Storage snapshot                              | System volume approximately 26 GB free; data volume approximately 444 GB free                  | Storage alone does not resolve missing virtualization or isolation prerequisites        |

Discovery used optional-feature state, service state, installed-app registry entries, command discovery, standard installation paths and WSL registration/status. It did not search all disks for private VM images or assume an unrelated VM was disposable.

No feature was enabled, package installed, service reconfigured, VM/distro started, host setting changed or cloud resource purchased. No previous lab executable or credential-repair script was run. Research documentation is the only repository change.

## Environment choice

Prefer an existing disposable Windows VM on another machine or an approved remote virtualization environment. Its ownership, disposal permission and management access must be established first. A remote Codex chat or Linux container is not equivalent to a Windows desktop guest.

Local Hyper-V and Windows Sandbox are possible future setup choices, but enabling either would modify this host. Microsoft's [Hyper-V installation instructions](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v) require administrative setup and a restart; its [Windows Sandbox installation instructions](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install) also require enabling a Windows feature and potentially restarting. Neither action is covered by the current constraint to keep the live setup untouched.

A full disposable VM with a clean checkpoint is preferred for repeatable desktop/server restart and recovery tests. Windows Sandbox can provide a separate guest kernel, but its application installation, persistence and automation suitability would need checking before selection. Its [configuration documentation](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file) exposes networking, folder mapping and device-redirection controls; defaults must not be assumed suitable for this experiment.

The missing input is the available remote machine/VM platform and a secure management connection. If creating paid infrastructure is necessary, define the concrete provider, resource size, duration, spending limit and cleanup plan before provisioning. Do not ask for passwords in chat.

## Guest acceptance before launching Codex

1. Verify that the target is a distinct Windows guest, not another profile or Windows desktop on the current host. Record guest identity and hypervisor/VM identity. Confirm it contains no unrelated work.
2. Confirm an authorized clean checkpoint or disposable image and a working guest-management channel. Any guest restart, sandbox setup, account creation or firewall change must occur inside that guest only.
3. Disable host-drive, home-directory, clipboard and device redirection for the test session. Do not mount the live Codex home, Threadlight checkout or previous lab. If an input share is needed, expose only a newly prepared sanitized input folder as read-only and copy its contents into guest-local storage before running anything.
4. Install the selected desktop/CLI versions from verified distribution artifacts inside the guest. Record versions and hashes. Do not package the previous lab: it contains private operational evidence and an encrypted sandbox credential cache.
5. Start with synthetic chats, a fresh guest Codex home and a local response fixture. Keep protocol listeners on guest loopback. Do not copy host model credentials, sandbox secrets or session databases.
6. Record a guest baseline for accounts, sandbox service, configuration and network rules. Let first-run setup complete only inside the disposable guest. Confirm that test commands and returned paths identify that guest before proceeding.
7. For the later real-model/tool tests, use an explicitly selected test account and sign in securely inside the guest. Treat fixture results and signed-in results as separate evidence. Do not silently substitute host credentials.

## Remaining proof sequence

All rows below are pending until a suitable guest is available. The shared-runtime result from the previous experiment remains a protocol feasibility result, not a passed desktop integration gate.

| Test                                          | Procedure and required evidence                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM0: isolation                                | Pass every guest acceptance check; retain the clean checkpoint identity and guest-only management connection                                                                                    |
| VM1: authenticated transport                  | Start one guest-owned shared server; prove both actual desktop and independently named client can authenticate through the selected arrangement; verify an unauthenticated client is refused    |
| VM2: desktop-visible existing chat            | Create a synthetic chat in the actual guest desktop, discover its stable identifier independently, open it in the desktop and capture accurate bounded history                                  |
| VM3: normal message and live update           | Independently send one unique marker; observe one normal user item, one resulting turn and the actual desktop transcript update; repeat with the desktop minimized without focus stealing       |
| VM4: active-turn delivery                     | Establish whether a second message steers, queues or rejects; correlate the turn and input identifiers; ensure no unintended interruption or duplicate turn                                     |
| VM5: desktop tools                            | Use a harmless desktop-provided read-only tool in a chat continued independently; confirm the request is still handled by the correct desktop context                                           |
| VM6: structured questions                     | Exercise each enabled question family separately; answer once from each client in separate trials; verify request correlation, completion and invalidation of the other client's stale card     |
| VM7: approvals                                | Request a harmless bounded guest action; separately test allow and decline, exact scope, ownership and stale-response rejection; never default to approval                                      |
| VM8: disconnection and exit                   | Disconnect before/after acknowledgement and while work or a question is pending; distinguish rejected, accepted and uncertain delivery; keep the desktop able to continue; do not blindly retry |
| VM9: restart and recovery                     | Restart the guest desktop and shared server separately; verify new connection epochs, preserved history, refreshed capabilities and no stale request reuse or duplicate execution               |
| VM10: authentication and account/tool reality | Repeat the relevant lifecycle cases with the selected test login and real model execution; do not count a deterministic fixture as proof of these capabilities                                  |
| VM11: disposal                                | Export only sanitized evidence, stop guest listeners, sign out/revoke test access as appropriate, and restore or destroy only the explicitly disposable guest/resources                         |

If the desktop cannot authenticate to the chosen listener without an undocumented workaround, record that failure before proceeding to UI and request tests. A bearer token accepted by the independent probe does not prove the desktop can use the same transport.

Do not enable a Threadlight setting, add an adapter, alter production launch configuration or claim transparent attachment to the current live desktop based on these tests. This phase is environment preparation and feasibility evidence only.

## Current next step

Identify the remote/disposable Windows environment. Until then, the remaining runtime tests are blocked by an unavailable guest, not by a failed protocol assertion. The user has been asked for the platform/location; no remote destination, account or budget is being assumed.
