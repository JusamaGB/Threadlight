# Native Codex thread creation proof

Date: 28 October 2026. The user authorized the next technical proof for Codex
only; Claude testing remains pending. This validates a creation/handoff route,
not the proposed header menu or automatic smart-view navigation.

## Result

One persistent blank chat was created using the installed Codex app server's
`thread/start`, with a dedicated disposable working directory, inherited model,
read-only sandbox and on-request approvals. No initial prompt or synthetic turn
was sent. The creation response returned the native ID, and `thread/read` could
read it after naming it **Threadlight new-thread proof (disposable)**.

Native ID: `e98dfed9-45fb-53dc-be6e-5a77d7a6387b`.

The bootstrap app server was closed before desktop ownership or message tests.
The existing desktop coordination connection initially returned `no-client-found`.
Opening `codex://threads/<id>` then allowed owner discovery to succeed. Discovery
was not immediate: the first request after opening still returned no owner.
An implementation needs bounded readiness handling, without creating another chat.

The production `CodexTracker` subsequently discovered the exact namespaced ID.
The Codex app's thread listing showed the chat after the first turn, and its
read-thread API confirmed all three completed turns under the same native ID.
Blank persistence/readability is proven; blank sidebar visibility is not.

## First-message correction

`NativeCodexMessages` previously treated every missing previous turn as missing
history. A newly created chat legitimately has no turns. It now accepts that
case only when the same read-only transaction finds the chat in
`thread_history_projection_state`, after successful native owner discovery.
Missing history or an unreadable projection still prevents sending.

The first message used the corrected production messaging service and the normal
desktop follower-start-turn route. The desktop, not the bootstrap process,
executed it. No Codex database or transcript was written directly.

| Check                     | Evidence                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| First message             | Accepted in 370 ms; completed with `CODEX_NEW_THREAD_OK`                                             |
| First-turn identity       | `d80dec7b-2994-569b-b550-f1a61168262a`; one native user item matching its client message ID          |
| Follow-up                 | Accepted in 660 ms; completed with `CODEX_FOLLOWUP_OK` in the same chat                              |
| Follow-up identity        | `f0831e63-d423-5442-9e86-450c3023810a`; one native user item matching its client message ID          |
| Smart-view transport      | Production `followCodexThread` received a live stream with both user/reply pairs                     |
| Focus independence        | Follow-up and streaming succeeded after navigating back to the originating chat                      |
| Desktop tool availability | Native history records a completed `codex_app.list_artifacts` call with empty artifacts and no error |
| Desktop-tool turn         | `75c957ed-3b3d-537a-9b5a-0e827f9353b3`; final reply `CODEX_DESKTOP_TOOLS_OK`                         |

## Local checks

- All 12 focused native-message tests passed, including three new cases for a
  known empty chat, missing projection, and unavailable projection schema.
- Focused ESLint and Prettier checks passed.
- Typecheck, changed-file diff checks, and production build passed.
- No regular app restart, pull request, push, or Claude live test was performed.

## Remaining product work

The requested context menu, two-option provider pill, creation IPC, durable
creation receipts, workspace selection, and automatic smart-view navigation are
not implemented by this proof. The verified handoff opens Codex visibly; a
product implementation must restore Threadlight focus after ownership is ready.
Desktop restart/reconnection and uncertain-creation recovery need further tests.

The desktop coordination protocol is internal and version-dependent. The
documented app-server creation operation alone does not prove desktop ownership;
the deep-link handoff and successful native messages provide that evidence here.

Reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).
