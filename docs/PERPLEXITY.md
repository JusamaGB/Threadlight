# Perplexity preview

The [Threadlight setup skill](../perplexity-skill/threadlight-setup/SKILL.md)
is prepared for Perplexity Computer's custom skill upload. On accounts with this
capability, the documented path is **Plugins → Add custom → Upload plugin or skill**.
The Markdown package was validated locally. Upload and automatic setup from
Perplexity remain unverified because computer use was unavailable on the trial account.
If Computer runs remotely, follow its commands on the intended PC. Choose
`node scripts/install.mjs --providers perplexity` in the source checkout, open the
signed-in Windows app and check a known chat under Recent. This route uses the desktop
chat adapter. The skill provides setup instructions. Project memory enrollment uses
the Claude Code and Codex plugins. See [Perplexity's skill upload guide](https://www.perplexity.ai/help-center/en/articles/13914413-how-to-use-computer-skills).

Select Perplexity under **Settings → Providers shown**, then open **Perplexity**.
The compact disclosure follows the app theme and reveals its controls when opened.
This section contains account chats; Claude/Codex workspace, recency, active-only
filters and dual-column grouping do not apply to it.

## Desktop chats

The foreground Threadlight Agent can request an ordinary Perplexity chat for a named Shared Space. Approve the opening message on the Agent card. Subsequent space messages use the saved Perplexity destination, and replies return to the sender inbox. Creation reuses the verified desktop connection. If Windows denies access to the pipe, open Threadlight and Perplexity in the same Windows sign-in.

For **ordinary conversation text**, choose **Chat** or **All** in Threads, then
use the **Recent** or **All** thread view. This adapter lists recent chats with Computer
tasks excluded, reads question/answer text and supports older-message pages.
Open conversations update automatically and use the shared composer for ordinary
chat follow-ups. Native pending status feeds Active. Delivery is checked against a
new saved entry in the same conversation; uncertain sends require checking the
native chat before retrying. This does not start a Computer task or require its OAuth.
It uses the existing row style with the supplied cyan provider accent. Refresh is
available in the chat menu. Inside an open conversation, formatted answers and
collapsed **Sources**, **Steps** and **Follow-ups** use the compact panel style.
Choosing a suggestion fills an empty draft for review; sending remains explicit.
Reported plan goals do not change the thread's activity state. Settings shows
connection errors and Retry only when needed. Ordinary chat
visibility is selected separately under **Chat providers shown**. See
[account-chat setup and limits](ACCOUNT-CHATS.md).

Open the installed Perplexity Windows app, then choose **Refresh chats**.
Threadlight shows the current page's titles, answer previews and reported states.
Expand a chat for its preview and **Open chat in Perplexity**. Refresh is explicit;
an empty result, an unavailable app and an incompatible app version are distinct.
This is not a full transcript or an exhaustive account history.

Discovery uses the native Windows pipe. It verifies the pipe server's executable,
Microsoft Store package, publisher and current Windows logon before using the same
handle. Only `server_status` and `threads_snapshot` are exposed, and read/write
tokens are discarded. Version 26.10.3 is validated; other versions fail closed.
CDP and remote debugging are not enabled. The pipe is a same-user local trust
boundary, not a scoped OAuth authorization.

## Computer tasks

Choose **Connect Computer** and authorize Threadlight in the browser if prompted.
The official Computer MCP server uses the Perplexity account rather than an API key.
It consumes account credits. Threadlight stores its sign-in encrypted with Windows
DPAPI, uses PKCE and validates the loopback callback and provider endpoints.

The composer supports a new task or a follow-up to a task created through this
connection. **Read task** requests its latest transcript without sending a message.
**Stop task** requests cancellation when the reported task state permits it; read
the task again to confirm. Task status is separate from whether an MCP call ended.
Questions, approvals and connector sign-ins currently need completion in Perplexity.
**Open Perplexity Computer** opens the task list: MCP task IDs are opaque handles,
so Threadlight does not construct public task links from them.

Sending is explicit. A saved operation receipt prevents duplicate submissions;
ambiguous delivery blocks further sends until the user checks Perplexity and
chooses **I checked Perplexity**. A documented pre-send credit rejection instead
states that no message was sent and preserves the draft. Drafts survive collapsing
the section during the app session; they are not yet persisted across app restarts.

**Disconnect** removes the saved sign-in, not the task history, running tasks or
Perplexity account authorization. It is unavailable while a request is in flight.
Revoke authorization in Perplexity itself if required.

## Current limits and validation

On 4 November 2026, the production adapter discovered five desktop chats,
reconnected with the previously authorized sign-in, enumerated Computer tools and
read its model catalogue. The explicitly authorized minimal test returned
`insufficient_credits` / `free_turns_exhausted`, without a task ID. No test task was
created. Successful sending, follow-up, transcript reading and cancellation remain
live acceptance gates; simulated receipts do not establish provider parity.

There is no Perplexity hosted Agent, shared-memory enrollment, voice composer,
artifact download or Claude/Codex-style project/change tracking in this preview.
The Settings discovery reader remains a title/preview snapshot; the separate
ordinary-chat adapter reads discovered cloud conversations through the native
HTTP read transport. The official Computer
connection is the recommended path for task operations; its permissions and
documented responses provide a firmer boundary than private desktop writes.

See [validation evidence](validation/PERPLEXITY-2026-11-04.md) and the
[official Computer MCP documentation](https://docs.perplexity.ai/docs/getting-started/integrations/computer-mcp-server).
