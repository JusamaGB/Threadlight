# Stage 0: local disposable VM setup

Date: 25 October 2026.

The user selected the local PC for the disposable VM. This supersedes the earlier preference for a remote VM; it does not authorize running Codex experiments directly on the host again.

## Setup result

| Item                                 | Result                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Selected environment                 | Windows Sandbox on the local Windows 10 Pro PC                         |
| Feature                              | `Containers-DisposableClientVM`                                        |
| Initial feature state                | Disabled                                                               |
| Final feature state                  | Enabled                                                                |
| Windows-reported restart requirement | Required                                                               |
| Automatic host restart               | Suppressed using `-NoRestart`; no restart issued                       |
| Guest launched                       | No                                                                     |
| Remaining connection tests           | Not run; waiting for the host restart and guest isolation verification |

A host setup script was prepared outside the application repository, parsed before execution, and run through Windows administrator elevation. It enabled Windows Sandbox and required feature dependencies. It did not launch a guest, Codex, the previous lab, or any credential-repair script.

## Prepared initial guest configuration

The initial `.wsb` configuration requests 4096 MB of memory and disables networking, clipboard redirection, audio input, video input, printer redirection and virtual GPU sharing. It contains no mapped host folders and no startup command. XML parsing and the absence of mappings/startup commands were checked before setup.

This configuration is for initial guest isolation verification. It does not yet provide the guest automation channel, test inputs or signed-in network access needed for all remaining tests. Those must be established inside the guest after startup. The previous lab must not be copied wholesale or mounted into the guest.

## Next step

The user must save ongoing work and restart the PC at a suitable time. Do not launch a guest while Windows reports this pending restart. After the user returns, verify feature readiness and the guest's distinct identity before installing or running any Codex test workload.

Follow the VM0–VM11 sequence in [VM readiness and remaining tests](CODEX-STAGE0-VM-READINESS.md). No integration implementation, provider toggle, production Codex launch change or application build is part of this work.
