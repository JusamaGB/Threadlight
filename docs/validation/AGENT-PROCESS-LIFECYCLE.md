# Hosted Agent and Brainstorm process lifecycle

This follow-up was committed as `bc9fc84` on `codex/guided-change-review` and
is now integrated into primary main. See the
[reconciliation record](WORKSPACE-RECONCILIATION-2026-10-29.md).

## Findings

Both providers already had explicit End/expiry cleanup and full application quit
called both the main Agent and Shared Spaces cleanup. Brainstorm switches awaited
its Agent service. However, Claude and Codex killed only the immediate child,
did not await OS process termination, and could leave descendant helpers alive.
Claude's broken-stdin path also discarded the child reference without stopping it.
Brainstorm End did not hold the discussion-switch lock throughout retirement.

## Ownership and transitions

- `spawnOwnedProcess` registers every hosted CLI and short-lived Claude app-list or
  Codex discovery/history/archiving connection in a main-process registry.
- A gated Node launcher starts before the provider. On 64-bit Windows it is
  assigned to a private, non-inheritable job with `KILL_ON_JOB_CLOSE`. Only then is
  provider configuration sent over a separate IPC channel. Assignment failure
  stops the launcher without running the provider. No process-name sweep is used.
- The provider retains its stdio protocol. Ending closes stdin, allows up to one
  second for a normal exit, terminates remaining job members, checks that the job
  has no active processes for up to two seconds, then drains output and closes
  handles. Repeated stop calls share one promise. Cleanup failure is reported.
- Unexpected provider exit and broken protocol streams retire the tree as well.
  Claude launch failures revoke acquired MCP scopes. Provider retirement is awaited
  before a replacement conversation sends input. Saved transcripts remain readable.
- Brainstorm discussion switches and End are serialized. A new chat attempted while
  End is pending is rejected with a readable busy message rather than racing cleanup.
  The renderer retains the discussion until End is acknowledged and displays a
  failed End instead of silently showing an empty conversation.
- `index.ts` performs cleanup on `before-quit`, after retiring the Agent and Shared
  Spaces conversations. The final registry drain blocks new launches. Minimize,
  panel hide and `window-all-closed` do not invoke this shutdown path. Live voice
  retains its existing stop and conversation-retirement ordering.
- Windows closes the private job handle if the owning application exits or crashes,
  terminating its members even if JavaScript cleanup cannot finish. Restart's
  forced-exit fallback therefore also releases owned jobs.

Microsoft documents job inheritance and kill-on-close behavior in
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
The launcher uses Electron's existing
[run-as-Node support](https://www.electronjs.org/docs/latest/tutorial/fuses), as the
owned MCP proxy already does; builds must retain that capability.

## Validation

Focused tests exercise real disposable Windows process trees: normal EOF shutdown,
uncooperative providers, unexpected provider exit, and abrupt termination of both
Node and Electron owners. Child and grandchild PIDs are checked dead; an unrelated
sentinel stays alive. Other cases cover final-output drain, repeated close,
registry shutdown and blocked late launches, plus a simulated job-assignment
failure proving that provider code never ran.

Provider/service regressions cover Claude broken stdin and synchronous launch
failure, Codex retirement waiting for transport shutdown, and Brainstorm switching
and End waiting for retirement. Existing expiry, archive/resume, startup cancellation,
voice and restart tests are included in the focused validation.

98 distinct focused tests passed across the lifecycle, provider, Brainstorm,
Shared Spaces and restart files (affected tests were rerun after the final changes).
The isolated built-renderer `brainstorm-chat` check passed, including End,
Earlier/Continue and draft preservation. TypeScript, focused ESLint, changed-file
formatting, diff checks and the production build passed. The live installed
Threadlight instance was left running throughout.

## Limits

This is ownership of locally spawned descendants, not remote-service shutdown or
an attempt to kill pre-existing desktop apps. Processes launched by an external
broker (for example WMI or an already-running service), remote work and processes
from older Threadlight builds are not retroactively owned. Windows containment is
tested on x64; ARM64 shares the 64-bit structure layout but was not run here.
Non-Windows uses a process group for normal cleanup; parent-crash containment is
only claimed for Windows. No live Claude/Codex user conversation was ended or
restarted for this validation. An installed, signed package and live provider
acceptance remain separate from these isolated runtime tests.
