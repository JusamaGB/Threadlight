# Shared Agent conversation UI — 28 October 2026

Brainstorm renders the ordinary AgentView: conversation lines, input, shortcut,
Stop/End, Earlier/Continue, model identity and request cards. Its project client
adapts those existing operations to Spaces. It does not implement another chat UI.

The adapter creates a discussion on the first send, keeps history inside its
project and preserves separate new/existing drafts and cursor positions. History
navigation caches are namespaced by project and discussion. Notes, source links,
explicit comparison, saved plans and reviewed assignment controls remain intact.

Passed checks include the shared chat UI flow, delayed-view-settings voice flow,
ordinary Agent voice regression, and a hidden native Electron fixture through
real Panel, preload, IPC and Spaces service. The native check covers linked notes,
source inspection, draft/cursor restoration, saved plans, explicit comparison and
no dispatch. Provider/model boundaries and audio are synthetic.
