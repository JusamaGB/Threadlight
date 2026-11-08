# Threadlight UI guideline: compact, contextual UI

Agreed with Kris on 29 October 2026. Applies to new interfaces and changes to
existing interfaces. Shorthand: **Use Threadlight's compact, contextual UI.**

The guiding rule is: **show what matters now; reveal detail when needed.**
Threadlight should help users do their work with minimal coordination overhead.
Keep the interface visually quiet, close to its content and quick to navigate.

## Density and layout

- Size buttons and controls around their label or icon. Avoid large minimum widths,
  tall cards, decorative padding and full-width buttons unless the interaction
  needs them. Composers and reading surfaces may use the available width.
- Use small, consistent gaps, padding, row heights and line spacing. Reuse the
  existing compact components and spacing values before adding another variant.
- Keep titles and list previews on one line where appropriate, using Threadlight's
  existing gradient fade. Opening an item must expose the full content.
- Maintain a readable hierarchy through alignment, restrained weight, icons and
  state markers. Do not rely on large headings or repeated text for structure.
- Compact controls must remain easy to target and read. Preserve visible focus,
  contrast and sensible interaction areas; shrinking text is not the default way
  to fit more information.

## Information and actions

- Prefer short labels and familiar icons. Do not put explanatory paragraphs,
  implementation details or setup instructions in routine product flows.
- Use the existing hover-hint system for concise explanations. Make the same
  meaning available on keyboard focus and give icon controls accessible names.
- Reveal controls when their prerequisites exist: a selection, a nonempty draft,
  available content, or a relevant current state. For example, show Send when the
  composer has something to send. Keep necessary entry points discoverable.
- Put secondary actions in the shared context menu. Examples: Rename and Discuss
  on a note. Support keyboard invocation and Escape; do not make mouse-only access
  the sole way to perform an action.
- Keep empty states short and useful. Avoid a wall of unavailable options, repeated
  titles, duplicated navigation or explanatory panels for an empty feature.
- Show operational detail inside the selected item or an expandable section. A
  compact overview should make progress and required action understandable without
  exposing every record, permission or diagnostic field.
- Automate bookkeeping where supported. Present a clear action only when user input
  is actually needed; do not turn internal verification into routine user homework.
- Preserve meaningful error, permission and approval information. Brevity must not
  hide a failed save, unavailable input or consequential action.

## Shared behavior

- Reuse the same composers, context menus, hint treatment, icons, fades and spacing
  conventions across pages. Caller-specific actions should sit on shared controls.
- Preserve drafts, selection and reading position across ordinary navigation.
  Keep failed input available for retry. Avoid layout jumps when controls appear.
- Separate selection, opening, dragging and destructive actions. A drag must not
  accidentally activate a task; opening context must not implicitly dispatch work.
- Use real state and explicit relationships. Do not imply activity, completion,
  dependencies or access that the application cannot substantiate.

## Handoffs and Workflows canvas direction

This section is accepted design direction, not a claim that it is implemented.

Handoffs displays live work grouped by objective, such as Improve onboarding and
Improve Chats. Each group has compact task nodes with title, assigned chat and
state. A dynamic number of chats can participate; task identity does not depend on
which chat currently owns it. Expand a node for its brief, sources, discussion and
results. Keep completed objectives collapsible and make work needing attention
easy to find. Folder browsing remains available as supporting detail.

Use automatic layout for Handoffs. Connections must represent known relationships
and distinguish dependency from ordinary association. Do not invent a sequence
from folder order or infer completion merely because an agent returned text.

Use consistent navigation in the Handoffs canvas and future workflow canvas:

- Drag empty canvas space to pan.
- Scroll vertically; Shift+scroll horizontally.
- Ctrl+scroll zooms towards the pointer.
- Compact Fit all and Reset zoom controls recover orientation.
- Clicking a node opens its details.
- A header expand/collapse control, at the top-left where layout allows, switches
  between compact and larger square views on Handoffs and Workflows. Fit the larger
  view to the available display; preserve selection and per-page viewport state
  when switching back. Do not treat this as application fullscreen.

Pan and zoom complement grouping, search and collapse; they do not remove the need
to manage clutter. Workflows will design reusable processes, while Handoffs follows
individual work instances. Share canvas primitives where practical without
requiring the full future workflow builder for the Handoffs update.

## Review each UI change

Check the narrow panel with empty, populated, long-content and busy/error states.
Inspect pointer and keyboard interactions, clipping, overflow and viewport recovery.
Confirm that full content is reachable, contextual actions appear when useful,
and spacing follows the existing components. Use isolated visual evidence and
focused behavior checks; record live acceptance separately from automated tests.
