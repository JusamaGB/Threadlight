# Project participants and capability reports

A Shared Space is a project area bound to a workspace. Its **Chats** tab lists
the native chats linked through existing memory grants, their Claude/Codex provider,
connection state, last observed plugin use, publishing access and capability reports.
Creating a space does not enroll chats automatically or pool their tools.

Participants are derived from grants rather than a second membership registry.
Revoked or expired enrollments remain visible as needing reconnection. A chat
missing from the workspace is unavailable. Connected means the plugin has used
its approved connection; it does not establish native delivery readiness or prove
that every listed tool currently works. Existing dispatch checks remain authoritative.

`memory_report_capabilities` records tools, skills, plugins and roles for the
requesting chat. Project-wide publishing access and explicit native-chat linkage
are required. The caller cannot select another chat or project, self-verify,
use temporary assignment access, or bypass a read-only/subtree grant. Human users
may record a separate manual report for an already linked project participant.
Reports retain provenance, server timestamps and operation receipts; retries do
not duplicate reports. A new report replaces that source's current inventory;
an empty list withdraws it. Historical records remain in the database and backup.

Reports start unverified. The human can verify an individual capability with
written evidence and a verification timestamp. Verification stays on that exact
report and entry; it is not inherited by later reports. Only the human panel API
exposes verification. This release records human verification rather than running
provider tools automatically. Report and verification text remain untrusted data.

The latest manual and chat reports appear separately. Project-wide memory
briefings and snapshots expose authorized reports, while subtree grants receive
none. Project and subtree filtering also covers report change events. Backups
retain reports and evidence; restoring still revokes grants and pauses coordination.

Every Brainstorm turn includes a bounded directory for its own project and current
workspace. Omitted participants are explicit. The prompt asks for exact chat IDs,
matching capabilities, report dates, verification evidence and a rationale, and
for missing evidence to be stated without inferring skills from provider names.
This internal context stays separate from the displayed user message.

Assignment drafts also offer transparent text-match suggestions using capability
names and descriptions. Only connected chats with project publishing access are
suggested. Human-verified matches receive additional weight; reports over seven
days old are visibly flagged for rechecking. No match produces an explanation
rather than an invented fallback. Selecting a suggestion edits the local plan
draft and its rationale. Saving and preparing reuse the existing reviewed handoff
flow. The rationale is included in plan snapshots and task briefs; preparation
creates draft tasks without authorizing or sending them. Existing communication
policies and participants are not changed by suggestions.

This slice does not discover every provider's installed tools automatically,
transfer tools across providers, create worker chats, or introduce autonomous
dispatch. Updated plugin tools must be reloaded by the provider before use.
