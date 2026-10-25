# Stage 0: disposable Windows guest results

Date: 25 October 2026. Research only; no Threadlight integration implementation.

## Environment verification

The user restarted the host after enabling Windows Sandbox. The subsequent check found the Sandbox executable installed and no Component Based Servicing pending-reboot flag. The guest launched using an explicit offline configuration.

The guest reported Windows 10 Enterprise on a Microsoft virtual machine, a different machine GUID and Windows account SID from the host, and the `WDAGUtilityAccount` user. It reported no network adapters, only its own C: filesystem drive, no visible host user profile or data drive, and no pre-existing Codex sandbox accounts.

Two newly created probe directories were shared: sanitized inputs read-only and an initially empty results directory writable. A guest write attempt to the input share failed as intended. Clipboard, network, audio input, video input, printer and virtual GPU sharing were disabled. The live Codex home, Threadlight checkout and earlier lab were not shared. This provides OS isolation with deliberately narrow file exchange; it is not a claim that the guest has no host mappings.

A temporary guest worker copied each probe into guest-local storage before execution. Identity guards rejected execution under the host computer name, host machine GUID or any user other than the guest account. No host input was injected through the UI. Read-only inspection of the hidden Sandbox window returned its accessibility structure; screenshot capture timed out and was not used as visual evidence.

## Software provenance

Fresh distribution files were copied from the installed application package and managed CLI, excluding user data and the previous lab. The copied CLI ran inside the guest and reported `0.164.0-alpha.11.1`. Executable and application archive hashes were compared with the installed originals. No application code was patched.

The desktop package is `26.1021.3705.0`. These tests cover that installed build, not all future Codex releases.

## Authentication test

The test starts a guest-loopback app server with capability-token authentication and a random guest-generated token. A transparent TCP observer records only whether an Authorization header is present and the HTTP response status. It neither adds credentials nor changes requests. The token stays in guest-local storage and is not exported.

Three independently identified client trials test missing, incorrect and correct credentials. Only after the correct credential initializes successfully and both negative controls fail does the harness launch the actual desktop with its local WebSocket URL pointing at the same listener.

The actual result and remaining test disposition will be recorded after the guest finishes.
