# Preview status and known limitations

This is a Windows source preview for early adopters, not a supported production
release. Build and isolated tests describe the checked candidate; they do not
certify every provider version or every live-account action.

- **VS Code Coach.** File proposals and predictions operate on one active source buffer
  up to 32,768 UTF-16 units. Local Python predictions use nearby code and observed
  editing patterns. Optional model suggestions depend on a model accessible through
  VS Code. Theme, editor settings, and other providers affect what appears. Workspace-wide
  edit review and exact Copilot next-edit rendering are outside this companion.
- **Provider compatibility:** integrations use version-dependent desktop protocols,
  local files and schemas. An upstream update can require a Threadlight adapter fix.
- **Claude:** existing Claude Code support remains. Catch-up work and renewed live
  acceptance are priorities. Ordinary Claude account chats, native new-chat creation
  and production automatic Claude runtime wakeup are not ready.
- **ChatGPT / Perplexity ordinary chats:** history and replies are available through
  the installed apps. Updates poll snapshots. No complete attachment, widget,
  scheduled-task or approval-card parity is claimed. Workspace view excludes chats
  without a verified filesystem association. Perplexity history is a recent list,
  not an exhaustive account search.
- **Perplexity Computer:** experimental and separate from ordinary chats. It can
  require credits. Full send/read/cancel acceptance is not established; questions,
  approvals and connector sign-ins still need Perplexity. Do not treat it as a
  validated production workflow.
- **Kimi:** the provider choice, setup and workspace preview are disabled in public
  builds. The repository retains development code and historical investigation.
  Scripted/simulated proofs are not a working provider integration.
- **Workflows / Shared Spaces:** local and experimental. Exact authority, budgets
  and provider capability checks still apply. No unrestricted desktop wakeup,
  remote execution or universal tool parity is claimed.
  Hosted Brainstorm can prepare drafts but cannot provision worker chats. The
  [5 November live evaluation](validation/SPACES-LIVE-E2E-2026-11-05.md) verified
  context retrieval, planning and approval, but execution stopped at the Codex
  delivery gate; a complete live delegation round trip is still unverified.
- **Voice:** local STT and provider-backed GPT Live are different paths. Device,
  microphone and provider behaviour require testing on each installation.
- **Artifacts:** supported local images, text and self-contained HTML only. No full
  PDF/Office/media preview or cloud-artifact retrieval. HTML previews are isolated
  from application authority and external resources.
- **Distribution:** no signed installer, automatic updater, macOS/Linux support,
  or Triple/Quad provider layout in this preview.

Historical records under `docs/validation/` and `docs/specs/` contain dated evidence
and proposals. They are not all current product promises. Personal paths and native
identifiers in public documentation have been generalised; private raw proof files
are not part of the source release.
