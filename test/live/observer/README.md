# Threadlight conversation E2E observer

Kris operates the installed Agent; this process captures evidence locally. Product source and settings are unchanged. Evidence contains real conversation data and stays outside the application repository.

Run commands from the repository root using Node 22.16 or newer. Evidence defaults
to a sibling `threadlight-e2e` directory. `THREADLIGHT_E2E_DIR` selects another
external evidence directory; `THREADLIGHT_E2E_REPO` selects the running checkout
when it differs from this script's repository. All commands use that same evidence
directory. The versioned scripts do not replace or stop an existing observer.

The running Electron app exposes CDP on loopback port 9333. The observer attaches only to its panel. It subscribes to the existing read APIs, samples DOM state every 500 ms, and saves a panel screenshot at most once per ten seconds while state changes. An additive wrapper observes newly created RTC data channels; it preserves the application's handlers. RTC statistics are sampled every two seconds. No raw microphone or speaker audio is recorded.

`latest.json` locates the run. `status.json` is refreshed about every two seconds; always check its timestamp and attached targets before saying capture is live. A background process saving evidence does not mean the assistant is continuously interpreting it between chat turns. Ask for a checkpoint or describe a problem, and the assistant can read the accumulated evidence.

Evidence:

- `session.json`: source revision, working tree, compiled-file hashes/timestamps and relevant settings. On-disk hashes identify the files present at attachment, not proof of the already-loaded main-process bytes.
- `events.jsonl`: ordered receipt timestamps, original page timestamps, Agent state, visible UI/drafts, question and approval cards, mic/STT/motion events, console errors, RTC messages/state/stats, screenshots and selected persisted provider transcript rows.
- `agent-latest.json`, `ui-latest.json`, `conversations-latest.json`: latest captured state and matching persisted conversation metadata.
- `shots/`: renderer screenshots; these do not prove desktop visibility or focus.
- `marks.jsonl`: operator/test checkpoint notes.

Native transcript reading follows only session IDs emitted by the hosted Agent. Initial rows may predate attachment and retain their original timestamp. Reasoning is excluded. Generic token/key redaction is best effort; screenshots and arbitrary conversation text may contain sensitive material. Do not publish evidence. A missing native source is a gap, not proof that nothing persisted.

If Codex moves a known transcript into `archived_sessions`, the observer finds it
again and resumes from the previous byte position without replaying old rows.
This recovery is included in the versioned tooling; an already running observer
continues using the code loaded when that capture started.

Commands (PowerShell):

```powershell
node test/live/observer/observe.mjs status
node test/live/observer/observe.mjs mark "Beat 1: opening exchange"
node test/live/observer/observe.mjs stop
node test/live/observer/check.mjs
```

To start another run after the previous one has stopped:

```powershell
$nodePath = (Get-Command node).Source
$observerPath = (Resolve-Path 'test/live/observer/observe.mjs').Path
Start-Process -FilePath $nodePath -ArgumentList ('"{0}" run' -f $observerPath) -WindowStyle Hidden
```

Each run stops after four hours, a stop marker or process termination. Attachment retries while the app is unavailable and records gaps. No messages, approvals, configuration writes or microphone starts are initiated. The capture sees existing Agent state but RTC details cover only connections created after attachment. No main-process RPC wire tap is installed. Audible quality, interruption feel and whether a reply was actually heard require Kris's report.

At each checkpoint compare: what Kris said/intended; transcription; backend reply/tool/card; visible or spoken transcript; persisted outcome. Label observed versus inferred results, preserve failed evidence, and record the smallest reproduction. Do not call an unexercised case PASS.
