# Codex desktop connection authentication proof

This is a disposable Windows Sandbox test, not an installer or production bridge.
It tests whether the actual desktop can use the same authenticated app server as
an independent Threadlight client. It neither patches the desktop nor adds an
Authorization header on its behalf.

Use a new offline Sandbox with clipboard, network, microphone, camera, printer
and GPU sharing disabled. Map only these directories:

- Sanitized distribution input, read-only at `C:\ThreadlightDistribution`, with
  `bin/codex.exe`, `bin/node.exe` and a complete `desktop/` application directory.
  Stage fresh installed distribution files, never a user profile or old lab.
- These two scripts, read-only at `C:\ThreadlightProbe`.
- An empty results folder, writable at `C:\ThreadlightResults`.

Run `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File
C:\ThreadlightProbe\probe.ps1` as the Sandbox logon command. The script requires
the guest account and a virtual machine, and rejects a visible host data profile.
All distribution files are copied into guest-local storage before execution.

The test generates a transport token inside the guest and starts a loopback
app server requiring it. The transparent TCP observer records only header
presence and HTTP status; it never injects headers or exports token values.
Missing and incorrect credentials must fail, and correct credentials must both
upgrade the connection and complete JSON-RPC initialization. Only then is the
actual desktop launched against the observed listener using its local URL override.

`result.json` is saved after each phase and before cleanup. `complete: true`
means the experiment finished, not that desktop authentication passed. Attempts
after the three controls belong to the desktop. A desktop process still running
is not evidence of a successful connection. The local URL override is an
experimental candidate, not a documented production integration contract.

Close the disposable Sandbox after collecting the sanitized result. Do not copy
guest credentials, raw desktop logs or account data into the repository. Do not
run the retired host-profile experiment: a separate profile on the same Windows
installation did not isolate machine-wide sandbox setup.

The 28 October result is recorded in
[the validation report](../../../docs/Codex/CODEX-DESKTOP-AUTH-20261028.md).
