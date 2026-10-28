# Interactive and cloud artifact investigation

Status: researched 2026-10-28. The first local-HTML implementation is now built;
hosted references, component runners and multi-file assets remain proposed.
See [local interactive validation](../validation/INTERACTIVE-ARTIFACTS-VALIDATION.md).

## Current behavior

Discovery and rendering are separate. Local HTML now runs in an isolated native
preview with inline JavaScript. The original sanitized static iframe remains the
fallback. JSX/TSX appears as source text and hosted URLs are still excluded.

## Provider findings

Claude Code documents publishing an HTML/Markdown source file, normally written in
a temporary directory, to a hosted artifact URL. Updates edit that file and publish
again. Thus a hosted artifact can have a reusable local original. Its hosted runtime
also provides capabilities such as connectors and downloads that a local page does
not automatically inherit. [Claude Code artifacts](https://code.claude.com/docs/en/artifacts)

Claude also supports artifacts with AI, connected apps and persistent data. Running
exported HTML cannot be assumed to preserve those services. Keep their hosted view
as the authoritative working version when those capabilities are needed.
[Claude artifact capabilities](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)

Private access and sharing must remain provider-controlled. Claude documents an
embed workflow for published legacy chat artifacts with allowed embedding domains;
that is not evidence that every new/private artifact supports embedding in a desktop
app. Do not publish or widen sharing just to make a preview work.
[Claude sharing](https://support.claude.com/en/articles/9547008-share-artifacts)

Codex App Server documents thread metadata/history access. The documentation reviewed
does not establish a universal cloud-artifact download API keyed only by thread ID.
Use observed local references and canonical hosted links; require a supported,
authenticated provider integration for cloud retrieval.
[Codex App Server](https://learn.chatgpt.com/docs/app-server)

This Codex session also exposes authorized Page/reference-reading tools and native
document connections. Those are capabilities of this host session, not credentials
or public integration APIs Threadlight automatically inherits. A future Pages adapter
needs its own supported authorization route and exact Page/file references.

## Routing proposal

| Artifact                               | Proposed behavior                                                   | Storage                                                  |
| -------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Self-contained local HTML/JavaScript   | Isolated interactive preview in the existing dual-width square      | Read original; no saved duplicate                        |
| Local HTML with sibling files          | Later, narrowly scoped asset resolver                               | Read declared assets in place                            |
| JSX/TSX component                      | Source view until a supported component runner exists               | Later compilation in memory; shared bundled dependencies |
| Existing running local web app         | Later, explicit preview URL; do not automatically start its project | Use its existing server                                  |
| Hosted artifact with a URL             | Provider view where supported, browser fallback otherwise           | Save reference metadata only                             |
| Hosted artifact with only an opaque ID | Provider-specific resolution or clear unavailable state             | Never guess URLs or scrape credentials                   |

Location and rendering capability should be independent fields. A reference may have
both a local path and a hosted URL. Bind them only with explicit provider evidence,
not matching filenames or titles. Track provider, thread ID, artifact ID, locator,
version if known, and capability requirements. Do not store signed download URLs as
permanent identity. Prefer observed canonical links; do not strip URL components
without knowing the provider's rules.

## First implementation: local interactivity

Use a dedicated Electron `WebContentsView` positioned inside the existing artifact
stage, separate from Threadlight's privileged renderer and preload. Enable JavaScript
only there, with Node integration disabled, context isolation, process sandboxing,
no Threadlight bridge and a separate ephemeral session. Electron documents this
separation for remote content; this proposal applies it to artifact code as well.
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)

Serve the selected document from memory through a narrowly scoped custom protocol;
do not load arbitrary `file:` URLs. The session can resolve only the selected artifact,
not paths supplied by artifact JavaScript. Keep networking, navigation, popups,
downloads, device access and arbitrary file access unavailable in this first slice.
Use browser policy plus main-process request/navigation controls, including subframes.
Do not weaken the existing panel CSP or use its React runtime to execute artifacts.

Implementation note: the memory protocol has no server or filesystem mapping. A
trusted script prefix locks the WebRTC constructors before artifact code runs; CSP
alone does not cover that networking API. Opaque-origin sandboxing and blocked child
frames/workers prevent obtaining an unmodified constructor from another realm.
The Connection-Allowlist header is defense in depth, not a relied-upon boundary:
native tests showed it did not prevent ICE gathering in this Electron environment.

Opening the tile can run eligible self-contained HTML directly. Keep an ordinary
preview fallback for incompatible content. Reload rereads the original. Closing or
switching the artifact destroys its view/session; a stuck renderer must remain
closable through Threadlight's own controls. Handle bounds, clipping, menus, focus,
Escape and dual-layout restoration explicitly.

React components require compilation and dependency resolution beyond enabling
scripts. Add that separately with a small supported dependency set, no package
installation or project startup scripts triggered by previewing a file. Explain
missing dependencies rather than displaying a broken blank page.

## Hosted references

Extend discovery to recognize verified provider artifact links in visible messages.
For Claude Code, investigate its actual successful `Artifact` tool records to pair
the hosted URL and local source file. This is a narrow provider adapter, not a change
to treating arbitrary tool output or every edited file as an artifact. Confirm its
installed schema with real records before implementing it.

Start with a reference tile and an Open in provider action using the normal browser's
existing login. This already gives access to interactive cloud content without an
export. Treat in-panel hosted rendering as a separate compatibility milestone:
test one real private and one published artifact with authorized access. A separate
WebContentsView may host the provider page if authentication and provider rules allow;
it is not a means to bypass denied access or embedding restrictions.

Embedded views have their own browser session and may require sign-in. Do not copy
cookies or tokens from Claude/Codex. Keep AI and connector operations in the provider's
own permissions flow. If embedded login is unsupported, retain the browser fallback.

“No duplicate artifacts” does not mean zero browser storage. An ephemeral session can
avoid persistent login/cache, while remembering sign-in requires provider session data.
Keep this choice separate from artifact copies, bound caches and provide sign-out/clear.
[Electron sessions](https://www.electronjs.org/docs/latest/api/session)

## Delivery sequence and evidence

1. Add isolated self-contained HTML interactivity. Prove a real storyboard's controls
   and animation work, originals refresh, and no artifact bodies are persisted.
2. Discover hosted links and the evidenced Claude publication mapping. Prove exact
   thread association, local/hosted pairing and normal-browser opening without changing
   provider sharing settings.
3. Validate embedded hosted access using real permitted artifacts. Document login,
   revocation, offline behavior and provider-runtime compatibility. Keep fallback.
4. Add component dependencies and multi-file assets only against concrete examples.

Acceptance tests must cover functional sliders/buttons/canvas, two artifacts with
isolated state, denied Node/IPC/file/network access, nested navigation and redirects,
cleanup after close/crash, resizing/focus, changed and deleted originals, and existing
static previews. Cloud tests must distinguish discoverable, accessible and runnable:
finding a link does not prove the viewer can authenticate or execute it.

Remaining unknowns: installed Claude publication-record shape, actual private-provider
login behavior inside Electron, hosted page embedding support, and a supported
standalone authorization route for any cloud-content API. These are validation tasks,
not capabilities claimed by this proposal.
