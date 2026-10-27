# Stage 0 follow-up: shared runtime experiment

Date: 25 October 2026. Product baseline: `90d4974`. Research branch: `research/codex-stage0`.

## Result

**A technically working experimental route was demonstrated: the actual desktop application and an independently identified protocol client can connect to one shared app server and access the same existing synthetic chat.**

This does not attach to the currently running desktop's private stdio connection. It requires starting a desktop instance with its local connection directed to a separately listening server. It is not yet a supported, production-ready Threadlight route.

There is also a material qualification: the attempted profile-level isolation was insufficient. The disposable desktop automatically provisioned shared Windows sandbox accounts and network rules. This temporarily invalidated the live installation's cached sandbox credentials. The mismatch was repaired and verified, but the experiment cannot be described as having made no host-level changes. No further desktop launch should be attempted on this host for this investigation; use a disposable virtual machine.

No Threadlight integration code was built. This report records experimental evidence and the remaining decisions.

## Experiment design

The test used:

- The desktop-managed Codex executable, version `0.164.0-alpha.11.1`.
- Desktop application code from Store package `26.1021.3705.0`; the app identified itself as `26.1021.31345` during protocol initialization.
- A fresh Codex data home, a fresh desktop user-data profile, and a synthetic workspace outside the product repository.
- Loopback-only model-fixture and WebSocket ports, allocated for the experiment.
- A temporary logging relay that forwarded JSON-RPC messages between desktop/client connections and the real app server. It negotiated ordinary JSON frames, without the desktop's optional compression.
- A deterministic local Responses-format fixture, which returned `FIXTURE_ACK` and a synthetic marker. No OpenAI model authentication or production model calls were required for the test turns.
- Distinct independent-client names beginning `threadlight_stage0_`; no desktop client identity or executor metadata was impersonated.
- An actual desktop process launched on a newly created Windows desktop that was never switched into view. This was window-station isolation, not a virtual machine or an OS security boundary.

The model responses were deliberately synthetic. They prove transport, turn lifecycle and persistence; they do not prove signed-in account behavior, real model tool selection or desktop-provided tool availability.

The installed package could not be launched directly on the separate Windows desktop: process creation returned access denied. A disposable copy of the executable and required application resources was used instead. The copied executable's SHA-256 matched the installed executable. Application code was not patched. The first copy could not load native modules through references back into the Store package; copying the required resources resolved that startup issue.

The original desktop and app-server processes were neither terminated nor restarted. Their original process identities and creation times were checked before and after the experiment.

## Connection route exercised

```text
Actual disposable desktop ──┐
                            ├─ loopback JSON-RPC relay ─ shared Codex app server
Independent test client ────┘                              │
                                                         ├─ synthetic chat history
                                                         └─ local response fixture
```

The app server was started with its WebSocket listener. The desktop process received separate `CODEX_HOME` and `CODEX_ELECTRON_USER_DATA_PATH` values, plus `CODEX_APP_SERVER_WS_URL` pointing to the test listener. These were child-process settings, not changes to the live desktop's environment.

The desktop connection sent its own `initialize` request identifying `Codex Desktop`. It subsequently made real requests including `account/read`, `config/read`, `project/list` and `thread/list`. This was the shipped desktop code running, not a harness pretending to be the desktop.

The [App Server documentation](https://learn.chatgpt.com/docs/app-server) describes shared WebSocket connections and thread/turn methods, but labels the WebSocket transport experimental and unsupported for production workloads. The desktop environment override was found in installed code; a supported end-user configuration contract for it has not been established.

## Observed proof sequence

| Check                                            | Observation                                                                                                                           | Interpretation                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Independent handshake                            | The probe initialized with its own client name and received responses                                                                 | Independent protocol access works when a listener exists                             |
| Create and persist a synthetic chat              | A first turn completed with `FIXTURE_ACK TL_LAB_BEFORE_DESKTOP`                                                                       | The chat existed before the desktop connected                                        |
| Actual desktop discovery                         | Two desktop `thread/list` responses included that same chat identifier                                                                | Desktop and probe saw the same persisted chat through the same server                |
| Independent continuation while desktop connected | The probe resumed that identifier and submitted `TL_LAB_EXTERNAL_FOLLOWUP`; one user-message item and a completed reply were observed | External input can become an ordinary user turn in a desktop-visible chat            |
| App-server restart                               | A fresh independent connection read the same persisted chat with `notLoaded` runtime status                                           | Discovery did not rely on the original process keeping it in memory                  |
| Read without subscription                        | An observer used `thread/read` and received no completion notification for another client's next turn                                 | Reading a chat does not establish live observation                                   |
| Two subscribed clients                           | After both used `thread/resume`, both received the same completed turn identifier for `TL_LAB_TWO_SUBSCRIBERS`                        | Shared live event delivery worked for this scenario                                  |
| User-input integrity                             | The observer saw one completed user-message item for that turn                                                                        | This avoids the delegated-tool-output limitation of the earlier built-in-bridge test |
| Reconnect and read                               | A newly connected reader paged history and found four turns                                                                           | History remained available after the sending client disconnected                     |

The first turn created the persisted chat before the desktop connected; the second continued it while the desktop connection was present. The restart and subscription tests used two clearly named protocol test clients, with the disposable desktop stopped. Do not present the latter as a second desktop lifecycle test.

The desktop issued chat-list reads but did not resume or subscribe to the synthetic chat. No `turn/completed` event was observed on its connection during the external follow-up. This is consistent with the explicit-subscription test, but the exact desktop behavior after opening the chat remains unverified. No claim is made about the visible UI or a live transcript update.

## Isolation incident and recovery

### What happened

The new desktop profile automatically issued `windowsSandbox/setupStart` with elevated mode. The real server reported setup completion. This was not an intentionally requested part of the connection test.

A separate Codex data directory did not isolate the legacy Windows sandbox's machine-wide state. Setup reused the shared online/offline sandbox accounts and changed their passwords. It refreshed the sandbox firewall/WFP configuration and performed read-ACL setup. The [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox) explains that the legacy elevated implementation uses dedicated Windows accounts, firewall rules and local policy changes.

The test desktop was stopped on discovery. All first-run test server/relay/fixture processes were then stopped. The later server-only test did not launch a desktop or request provisioning; its relay was also configured to reject `windowsSandbox/setupStart` as outside the experiment.

### Evidence and repair

- The machine sandbox service predated this experiment and remained running; it was not newly installed or restarted by the test.
- Both sandbox accounts' password timestamps matched the unexpected setup operation.
- Windows logon checks showed that the pre-existing live credential cache no longer authenticated, while the newly provisioned test cache did.
- Direct restoration of the old account passwords was denied by Windows permissions. No elevation prompt was opened.
- The repair synchronized only the two encrypted password fields in the live sandbox credential cache to the credentials Windows now accepted. It did not change model authentication, provider settings or the live `config.toml`.
- An encrypted copy of the pre-experiment cache was retained in the original protected secrets directory. No password values were printed, committed or copied into the product repository.
- An initial atomic replacement changed file metadata. The original file owner and complete security descriptor were subsequently restored exactly, and checked against the original descriptor.
- Both live-cache sandbox account logon checks then passed.
- A normal Codex sandbox command printed `TL_SANDBOX_REPAIR_OK` and exited with code 0. The live configuration and repaired credential cache hashes were unchanged by that verification command.
- The five normalized firewall rule definitions in the experiment's setup log matched the five definitions from the prior live provisioning log. Both runs reported 12 WFP filters. This establishes matching recorded policy, not a full before/after snapshot of every Windows networking setting.
- The ACL setup log mentioned a pre-existing configuration file. Its current ACL showed no explicit new sandbox-account entry, and the previous provisioning log already mentioned that same path. No speculative ACL reversal was attempted.

The shared account passwords remain rotated, with the live cache synchronized. They were not restored to their previous values. The successful sandbox command verifies recovery of the tested live installation; it is not proof that every possible alternate Codex data home on the machine was unaffected.

This incident is a failed isolation acceptance check. Future actual-desktop experiments belong in a disposable VM with its own Windows accounts, firewall and user profile. A second desktop/profile on the same Windows installation is insufficient.

## What is and is not now proven

| Capability                                                           | Current conclusion                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Independent connection to a listening shared runtime                 | Proven in the synthetic environment                                                 |
| Actual desktop and independent client discover the same chat         | Proven                                                                              |
| Independent normal user input and completed turn                     | Proven with a local response fixture                                                |
| Multi-client subscription and reconnect/history                      | Proven with two protocol clients                                                    |
| Attach to the already running production stdio process               | Not proven; this experiment does not provide that capability                        |
| Migrate the existing live desktop to a shared runtime safely         | Not tested                                                                          |
| Desktop opens a chat and updates its transcript live                 | Not tested                                                                          |
| Preserve desktop-provided tools under independent sends              | Not tested in this shared-runtime configuration                                     |
| Real account authentication and real model execution                 | Not tested                                                                          |
| Authenticated local transport usable by both desktop and Threadlight | Not tested; the fixture listener was loopback-only without transport authentication |
| Structured questions and approvals across clients                    | Not tested                                                                          |
| Exactly-once recovery after uncertain acknowledgement                | Not tested                                                                          |
| Safe, fully isolated desktop test on this host                       | Failed; repaired shared-sandbox credential mismatch is documented above             |

The shared runtime is therefore a concrete experimental candidate, not a passed production integration gate. The earlier finding about the default live installation remains valid: it exposes no independently usable control socket in its current configuration.

## Decision for the next investigation

Continue feasibility work only in a disposable OS-level environment before proposing a live desktop startup change.

The next proof should use the same desktop build and one explicitly owned shared server, with authenticated transport and the actual desktop opening an existing synthetic chat. Exercise independent sends while open/minimized, desktop-provided tools, structured questions, per-family approval handling, client disconnection and desktop/server restart. Verify that the desktop remains able to operate when Threadlight exits.

Separate two product choices:

1. **Independent attachment to today's already running desktop:** still unresolved. The tested route does not offer a transparent toggle for this case.
2. **A desktop launched against a shared runtime:** technically demonstrated at the connection and synthetic-turn level. It needs a supported startup/authentication arrangement, ownership rules, desktop-tool compatibility and lifecycle evidence before implementation.

Do not replace the desktop's live process, change its launch configuration or enable Threadlight sending based only on this experiment.

## Final state and validation

- All experiment desktop, server, relay and response-fixture processes were stopped. A final check found no listeners on any of the six test ports.
- The original desktop, original app server and existing sandbox service remained running.
- The temporary lab scripts, synthetic evidence, copied application files and generated test data remain outside the product repository. Automatic approval review blocked removal of the disposable files, reporting only that the cleanup command was blocked by policy. No alternate deletion method was used.
- The lab contains an encrypted sandbox credential cache created by the unexpected setup. Treat the lab as private and do not publish it or package it as a fixture.
- The product diff contains research documentation only. No source, dependencies, hooks, integrations or build outputs changed.
- The documentation passed focused formatting, whitespace and sensitive-data checks, and the complete diff was reviewed. Application tests/build are not evidence for this protocol experiment and were not rerun. No pull request or release was published.
