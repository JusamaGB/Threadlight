# Perplexity integration evidence — 4 November 2026

Implemented in the primary checkout; built, not released or reloaded into the
regular running Threadlight app. Existing unrelated work was preserved.

## Live provider checks

- Original discovery verified the Store app, its same-logon native pipe and native
  version 26.10.3. Read-only chat metadata was available; cloud transcript lookup
  through the native local-session reader was not. No CDP listener was enabled.
- User completed official Computer OAuth consent. Saved credentials use Electron
  safeStorage/Windows DPAPI, not plaintext. Reconnection succeeded on 4 November.
- Six allowlisted Computer tools were discovered and `models_list` succeeded.
- User confirmed the earlier ambiguous test had created no task and authorized a
  retry. The retry returned a text-only `insufficient_credits` event with
  `interactive.reason = free_turns_exhausted`, no `thread_id` and no `task_status`.
  The official contract identifies this as rejection before any message is sent.
- The parser now recognizes that specific response. Regression tests replay the
  observed shape: send fails clearly, draft is retained, receipt is settled, and
  no fake task or uncertain-delivery state is created. General errors remain
  conservative; there is no blind retry.
- A subsequent **read-only** proof, after reopening Perplexity, discovered five
  desktop chats and repeated OAuth/catalogue checks. The old uncertain receipt was
  reconciled using the explicit user confirmation and actual rejection evidence.
  No further test message was sent.

## Local checks

- `npx vitest run test/perplexity.test.ts`: 18 passing tests, including frame
  bounds, read-only methods, identity checks, OAuth callback/origin checks,
  receipt-before-send ordering, duplication prevention, rejection handling,
  retargeted reads, in-flight disconnect protection and encrypted-store revision
  ordering, interrupted-receipt recovery and failure preservation.
- Focused ESLint: passed for Perplexity modules and tests.
- `npx tsc -p tsconfig.web.json --noEmit`: passed.
- `npm run build`: passed in the primary checkout.
- `git diff --check`: passed.
- Isolated UI smoke with `THREADLIGHT_UI_FOCUS=perplexity`: passed. Synthetic IPC
  covers the Settings-only disclosure and absence of the panel from Threads,
  read-only refresh, expanded long previews,
  keyboard access, Shift+Enter, failed-send draft retention, collapse/reopen,
  success/read receipts, uncertain delivery, busy controls and inherited theme.
  The move to Settings was checked at the narrow panel width; collapsed, empty
  and credit-error screenshots were inspected. The rebuilt app has not been
  restarted for this follow-up while another Perplexity update is active.
- Full `npm run typecheck` remains blocked by existing audio DOM types and the
  node-project inclusion of `audioEnergy.ts` and `kimi/preview.ts`. The reported
  errors are outside the Perplexity change; the renderer check passes separately.

## Remaining acceptance gates

Account credits are required to prove a successful model response. Follow-up,
transcript reading, task cancellation, pending questions and reconnect-after-task
must then be validated against real Computer tasks. Synthetic receipts and a
successful OAuth connection are not evidence of those capabilities working live.

The Settings section is an explicit preview with account-level discovery, not full
Claude/Codex integration. No Perplexity shared memory, hosted Agent, project/change
attribution, voice or artifact downloads are claimed. The public task list is
opened because MCP IDs are opaque and cannot safely be used as web session IDs.

Source: [official Computer MCP documentation](https://docs.perplexity.ai/docs/getting-started/integrations/computer-mcp-server).
