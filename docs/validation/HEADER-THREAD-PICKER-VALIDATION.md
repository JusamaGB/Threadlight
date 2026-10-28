# Header thread picker

Validated 28 October 2026 in the primary checkout.

The whole header now opens a context menu. New thread expands into one
Claude / Codex pill; enabled options turn blue on hover or keyboard focus.
Shared Spaces and Agent are in the same menu, and their two header icons
have been removed. Existing view shortcuts remain. Shift+F10 and the menu
key expose the same menu from the keyboard.

Codex creates a persistent native chat in the selected workspace, or in a
new folder under Documents/Threadlight/Chats when no exact workspace is
selected. The desktop adopts the chat, then Threadlight regains focus and
opens its smart thread with the empty composer focused. Claude creation
is visibly disabled pending a verified native creation route.

## Creation and recovery

The bootstrap uses the installed Codex app server, inherits configured
provider settings, and sends no initial prompt. A live check found that
thread/start alone can leave the blank chat without readable native history
when the bootstrap exits. The implementation therefore names the chat via
thread/name/set and verifies thread/read before releasing the writer.

Durable creation receipts and a persisted renderer operation ID prevent
duplicate creation on repeated clicks, interrupted handoff, or restart.
An uncertain thread/start response is not automatically replayed. A known
identity is retained even when the desktop handoff fails.

Live production-service evidence: native chat
01a18399-ba98-71a2-ad87-c93b2bd78555 was created with zero turns, discovered
by the production tracker, adopted by the desktop, and reopened on retry
with the same identity and only one bootstrap. The Codex desktop's chat
listing also confirmed it. No direct database writes were used.

## Checks

- 21 focused tests passed across creation and native messaging.
- Header UI smoke passed: moved navigation, removed icons, keyboard picker,
  blue hover, unavailable Claude, in-flight guard, stable operation retry,
  visible failure from Agent, and focused empty smart-thread composer.
- Input-navigation, pinning/toolbar, and panel-layout UI focuses passed,
  covering the moved real callers and single/dual layouts.
- Changed-file ESLint, formatting, diff checks, typecheck, and build passed.
- Repository-wide lint encountered unrelated local scratch/generated files;
  it is not a clean baseline. The one error in the new smoke was fixed and
  the changed-file lint passed afterward.

The regular running app was not restarted: a Shared Spaces creation form
was open. The built change loads on its next restart. No PR or push was
requested. The desktop coordination protocol remains version-dependent.
