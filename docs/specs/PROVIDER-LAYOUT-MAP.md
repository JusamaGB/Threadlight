# Provider layout map

Planning only — 4 November 2026. Triple and Quad are not implemented or offered
in the application. This maps the next settings/layout work requested by Kris.

## Provider identity

Count provider families, not individual connection types. Proposed mapping:

| Family / column | Capabilities within it                               | Availability                                   |
| --------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Claude          | Claude Code; ordinary Claude chat if supported later | Existing Code integration                      |
| OpenAI          | Codex and ordinary ChatGPT chat                      | Existing separate adapters; one planned family |
| Perplexity      | Ordinary chat and Computer tasks                     | Chat reader and separate Computer preview      |
| Kimi            | Local, server or Moonshot connection                 | Configuration/preview only; execution is gated |

Selecting ChatGPT and Codex must not consume two provider columns. Likewise,
Perplexity chat and Computer, or multiple Kimi connection modes, each count once.
The Chat / Code & Computer / All filter chooses capabilities within families.
Capability-specific actions remain contextual: no diffs for ordinary chats.

## Right-click availability

Keep the existing thread/context-menu entry point. Generate one relevant expanded
layout option from the distinct selected families supported in the current view:

| Selected families | Offer from Single                | Geometry         |
| ----------------- | -------------------------------- | ---------------- |
| 0–1               | No multi-column option           | One compact list |
| 2                 | Dual view                        | Two columns      |
| 3                 | Triple view, replacing Dual      | Three columns    |
| 4                 | Quad view, replacing Dual/Triple | Four columns     |

Once expanded, offer **Single view** in the same place. Adding Kimi must not expose
a working fourth column until its real thread capability is enabled. Settings
configuration alone is not a live provider selection.

Use stable order: Claude, OpenAI, Perplexity, Kimi, omitting unselected families.
Keep selection separate from live row counts: finishing a task must not collapse
the layout or move the remaining columns. Empty columns contain no fake threads,
provider setup cards or diagnostic panels. Compact column labels are sufficient.

## Lists, sizing and navigation

- Single Recent is one global chronological list with one count limit. Existing
  active-work retention and stable completion ordering remain in force. Account
  chats use provider update timestamps; unknown timestamps are not invented.
- Multi-column Recent partitions that same selected result by family. Sorting is
  newest first inside each column; the count remains global, not multiplied by
  the number of columns. OpenAI interleaves ChatGPT and Codex within its column.
- Active shows only reported activity. Workspace requires a verified workspace
  association; ordinary account chats are not assigned arbitrary folders.
- Preserve the current Recent/Workspace eligibility for expanded layouts initially.
  Active and the All workspace tree remain compact until separately designed.
- Target existing column density: roughly 238 px per column, about 714 px for
  Triple and 952 px for Quad, plus measured gutters. Clamp to the current monitor's
  work area. Do not shrink text or put columns off-screen; if there is insufficient
  room, keep Single and explain the unavailable option in its hint.
- Preserve open conversations, drafts, focus and reading position on layout or
  provider changes. Keyboard menu actions and Escape match current shared menus.
- On a selection change, derive the effective column count again. Saved preference
  should express single versus provider columns, rather than an obsolete fixed
  number. Removing a provider must never leave a stale Quad/Dual setting in use.

## Settings work that follows

The compact four-choice **Providers shown** row and separate **Chat providers
shown** row are now implemented. Kimi selection reveals setup without activating
a runtime. The column mapping below remains future work.

Introduce a family/capability registry shared by Settings, the Apps filter and
layout calculation. Map current enabledProviders, chatSources and conversationFilter
without losing saved choices. Keep Kimi setup distinct from verified runtime
availability. Specify per-capability status and colour treatment, retaining clear
ChatGPT/Codex identification inside the OpenAI family.

The implementation would then replace hard-coded Claude-left/Codex-right rendering
and single/dual window sizing with measured provider columns; preserve artifact
viewer sizing separately. No schema migration, new setting, Kimi activation,
Triple or Quad renderer is part of this mapping change.

## Acceptance for that future implementation

Check every 1/2/3/4-family selection, Chat/Code/All combinations, source removal,
zero rows, unknown activity, one shared count, long titles, per-column ordering,
small-monitor fallback, keyboard/context-menu navigation, retained drafts and
reading positions, and restart/migration behaviour. Validate Kimi with genuine
provider evidence before enabling its live column; synthetic previews do not
establish execution support.
