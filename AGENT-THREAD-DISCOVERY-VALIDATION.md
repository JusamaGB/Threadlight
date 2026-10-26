# Thread discovery and reading: implementation and validation

Date: 26 October 2026. Branch: `feat/agent-thread-reading`.

The [specification](AGENT-THREAD-DISCOVERY-SPEC.md) is implemented in the local checkout. The general Agent receives two scoped, read-only tools: `threadlight_find_threads` and `threadlight_read_thread`. Both hosted providers can read enabled local Claude and Codex chats. Discovery is independent of the panel's row limits and workspace expansion.

## Delivered behavior

- Provider metadata catalogues, deterministic name matching, candidate clarification, stable provider-qualified identities, archive lookup and scope checks.
- Fresh selected-chat reads, bounded backward history, provenance, per-source health, current-turn status, completed-reply separation, plans, pending questions and observation deltas.
- A private authenticated loopback MCP service with per-runtime capabilities, revocation, exact tool inventory verification and narrowly scoped automatic permission for these reads.
- Direct Claude front-desk reads and Codex backend/Live instructions that require new evidence for current-state follow-ups.
- Inspectable source details and candidate choices in the Agent panel. Bounded evidence journals survive conversation restoration and are labelled historical.
- Read queues and source deadlines, background SQLite workers, read-only transactions, real-path checks, complete-record JSONL boundaries, streaming/partial-write handling and explicit coverage gaps.

The implementation adds no send, resume, approval-response or remote-host capability. Reader operations do not create provider turns. Synthetic target messages used in the proofs are sent by the test harness through the target's normal runtime, separately from the reader.

## Installed-runtime evidence

These are authenticated runs against the installed provider runtimes, using disposable synthetic chats and known answer keys. Reports and local screenshots remain outside the repository. Earlier failed harness attempts are retained there; the passing runs are identified below.

| Path or scenario                                                                                                                               | Result | Evidence artifact under the local E2E directory              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Hosted Codex: typed reads of Claude and Codex, then changed answer on a fresh follow-up                                                        | PASS   | `thread-reading-proof-06/report.json`                        |
| Hosted Claude: typed reads of both providers and changed answer on a fresh follow-up, without a worker solely for lookup                       | PASS   | `thread-reading-proof-04/report.json`                        |
| Recorded voice: generated WAV through the production Electron speech worker, actual recorded-voice hook, hosted Claude and a real Codex target | PASS   | `thread-reading-recorded-proof-02/recorded-read.json`        |
| Codex Live: uninterrupted native WebRTC conversation, changed target, second spoken question, new read and new spoken answer                   | PASS   | `thread-reading-live.json`                                   |
| Duplicate names across providers, actual clarification/selection, disabled provider and archive/history restoration                            | PASS   | `thread-reading-proof-06/report.json`                        |
| Actual pending native question: observation leaves it unanswered; later answer clears the observed attention                                   | PASS   | `thread-reading-attention-proof-final/attention-report.json` |
| Actual active reply: current native turn remains working and is not reported as a completed reply                                              | PASS   | `thread-reading-attention-proof-final/attention-report.json` |
| Real built renderer: escaped titles, candidate dispatch, busy-state prevention and source details                                              | PASS   | `thread-reading-ui/agent-thread-source.local.png`            |

The recorded-voice proof injects a WAV at the existing transcription boundary. The Live proof supplies the WAV as WebRTC microphone input. These verify the application paths and real models; they do not test physical microphone hardware. Model generation and transcription latency are excluded from source-reader performance figures.

The active-reply run caught a native turn starting before its user message reached local history. The reader now leaves `currentRequest` absent with an explicit coverage explanation instead of relabelling the preceding request. A focused regression covers this correction. Final-channel text associated with an active turn is incomplete; a previous turn's completed reply remains separately identified.

## Source and environment limits

- One existing Claude desktop metadata file was unreadable in this environment. Discovery correctly reported incomplete coverage. The proof explicitly selected its known synthetic candidate; a healthy selected transcript remained readable. No provider data was repaired or overwritten.
- An unindexed CLI transcript can contain a title outside its bounded header/tail metadata. If an explicit indexed title cannot be established, coverage is incomplete rather than a confident negative or unique match. Indexed titles are preserved over first-message fallbacks.
- Local evidence may lag the provider runtime. Check time, source update time and message time remain distinct. Unknown state is not idle, and a chat's reported success is not an independent repository or deployment check.
- Parsed metadata may be reused after successful source revalidation. Reads are serialized per chat; a timed-out underlying I/O operation retains its queue slot until it settles. Overall tool calls are bounded, and provider failures do not become empty successful conversations.
- Discovery/history continuations are bounded and expire. A changed catalogue generation or source identity requires a new search/page. Old source receipts do not authorize reads in a new runtime.

## Performance

`test/live/thread-reading.perf.mjs` used 5,001 catalogue entries and a 21,270,000-byte synthetic transcript, with ten measured warm iterations:

| Measurement               | Observed |
| ------------------------- | -------: |
| Cold catalogue lookup     |   800 ms |
| Warm catalogue lookup p95 |    77 ms |
| Selected status read p95  |   295 ms |

The warm 500 ms and cold 2 second fixture targets passed. The cold figure is one measured cold start, not a cold-start p95 estimate. Results are machine-specific and exclude model/speech latency. Report: `thread-reading-performance.json`.

## Repeatable checks

Final local preflight: 394 tests passed and 4 existing opt-in tests were skipped, across 40 passing test files. Plugin asset verification, ESLint, both TypeScript projects, formatting, observer checks, production build and diff checks passed. The full suite used `npm run test -- --maxWorkers=2 --testTimeout=30000`: the default 41-worker run hit short relay/SQLite fixture timeouts, and a focused rerun confirmed relay behavior before the bounded-concurrency full run passed. No production timeout or unrelated relay implementation was changed.

Focused regressions cover resolution, scope changes during reads, freshness, source failures/deadlines, duplicate names, provider UUID collisions, 5,001-entry pagination, UTF-8/partial/oversized JSONL records, replacement/truncation, read-only native SQLite and WAL changes, archive movement, private-reasoning exclusion, context-envelope stripping, current-turn association, question resolution, output bounds and evidence restoration.

```powershell
npx vitest run test/threadRead.test.ts test/threadReadAdapters.test.ts test/agentRun.test.ts test/agentCodex.test.ts test/agentHistory.test.ts test/briefing.test.ts test/codex.test.ts test/codexClient.test.ts
node test/live/observer/check.mjs
npm run check
npm run build
```

On a busy Windows machine, run the test stage as `npm run test -- --maxWorkers=2 --testTimeout=30000` and retain the other `check` stages (plugin assets, lint, typecheck and formatting).

The opt-in runtime harnesses are `test/live/thread-reading.proof.mjs`, `test/live/thread-reading-attention.proof.mjs`, `test/live/recorded-reader.proof.mjs` and `test/agentLive.live.mjs`. Their headers/environment guards describe activation. Supply installed CLI paths and an evidence directory outside the repository; retain existing authentication without copying credentials. The recorded harness must run under Electron. The UI smoke uses `THREADLIGHT_UI_FOCUS=thread-reading` with `test/ui/providers.smoke.mjs` after a production build.

The development build must be restarted to load the new main-process reader. Existing running conversations were not forcibly restarted by this work.
