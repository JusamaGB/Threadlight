# Shared Spaces live end-to-end evaluation — 5 November 2026

## Method

Used the primary checkout and the user's existing Threadlight Space, with explicit
authorization to add test context, prepare a plan and run a bounded two-worker
documentation exercise. Playwright controlled the real Electron renderer and
preload; read-only snapshots checked persisted backend state. Native computer-use
automation was excluded after the user's correction.

The attachment picker alone was supplied a known local text-file selection by the
Electron harness. Import, persistence, context retrieval, Brainstorm model turns,
workflow drafting, authorization and run execution used production code. Provider
responses and delivery outcomes were not mocked. Overlay screenshots were
unreliable; DOM and persisted records are the authoritative evidence for this run.
Raw evidence is retained in the initiating chat's private workspace, not published
with native chat identifiers or account content.

## Observed results

| Stage                | Result                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes                | Two evaluation notes saved; amendment persisted as revision 2.                                                                                                                                 |
| Attachment           | A background text document imported into Plans as revision 1.                                                                                                                                  |
| Brainstorm retrieval | Live Codex Brainstorm read both exact note revisions and the attachment; returned its AMBER ORCHARD reading-check phrase.                                                                      |
| Provisional plan     | Proposed independent evidence-review and acceptance-checklist assignments. Reported missing workers honestly; no premature dispatch.                                                           |
| Worker preparation   | Harness used the app's native chat creation path for two test chats in the Space workspace, then UI enrollment and role configuration. Brainstorm cannot provision these workers itself.       |
| Draft                | Brainstorm validated, saved and reread a two-AI-step graph with join and finish. Human review corrected the operation budget and overlapping positions before authorization of revision 2.     |
| Approval/run         | UI authorized the exact revision and invoked one bounded run.                                                                                                                                  |
| Delivery             | **Blocked:** `AI destination has no supported delivery adapter.` The first node became uncertain/Needs you; other nodes remained pending. Backend recorded zero assignments and zero messages. |
| Restart              | Failed run and source context persisted. Recovery retained Needs you, requiring review before any resume.                                                                                      |
| Final state          | Both project and workflow dispatch paused. No completed worker reports or accepted outputs.                                                                                                    |

This is **not** a successful full delegation round trip. Native delivery
compatibility/ownership admission remains the next release gate. Do not bypass
that gate, infer execution from a saved draft, or reconcile the blocked node as a
completed worker result. Direct messaging between ordinary account chats was not
retested by this exercise.

## Fixes and verification

- Destination discovery now applies its 100-row limit per enabled work provider;
  a large Claude catalogue no longer removes all Codex choices. Confirmed through
  the live role picker after reload.
- Hosted `threadlight_get_workflow` now returns paged, active folder IDs/titles,
  scoped to the requested readable project. Live Brainstorm confirmed Plans,
  Handoffs and Results after reload, without needing a supplied folder ID.
- The workflow response explains that operation budgets include join and finish,
  separately from the AI dispatch budget.

Focused checks: 43 communication/catalogue tests and 11 scoped-context tests
passed. Final affected catalogue/context rerun: 13 passed. Type checks, targeted
lint, formatting, production build and diff whitespace checks passed. Existing
unrelated changes were preserved; no commit, push or PR was made.
