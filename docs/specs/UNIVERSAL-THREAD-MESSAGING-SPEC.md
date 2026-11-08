# Universal Shared Space messaging

Direction agreed on 4 November 2026: provider chats participate in a common Shared
Space conversation using the same destination, message, receipt and reply tools.
Use an ordinary chat for bounded thinking or research and Work/Code for execution.
The shared-space boundary determines membership; the provider adapter determines
what the particular destination can actually do.

## Shared contract

Keep one communication journal and existing tools: resolve destination, send to
exact targets, inspect receipt, read inbox, and reply with the original correlation
ID. One operation ID represents one mutation. Group replies retain the original
group membership rules; no provider may silently broaden recipients.

Keep delivery acceptance, completed model response, saved output submission and
human acceptance distinct. Native transcript history is not automatically shared.
Briefs carry the minimum useful context, constraints and expected result; they do
not carry provider credentials, private reasoning or assumed filesystem access.

The common contract must represent native identity, provider, host, connection
generation, send/queue capability, observed reply support, memory-tool access and
workspace access. Do not infer any of these from a provider name. A new adapter
must preserve current account identity and prove its delivery path before admission.

## Implemented first step

Claude/Codex keep their established adapters. Ordinary ChatGPT and Perplexity now
have separate account-chat destinations in the same message service. An authorized
sender can send a brief and retrieve its correlated text result. These destinations
keep their native model selection and receive no memory enrollment or machine
permissions. Delivery uses existing durable receipts and rejects uncertain replay.

See [implementation evidence and open gates](../validation/UNIVERSAL-THREAD-MESSAGING-2026-11-04.md).

## Remaining steps

1. Verify the ChatGPT production transport under normal discovery availability.
2. Add a supported, scoped Chat-side tool connection where the host permits one,
   so an ordinary Chat can originate a message rather than only answer a brief.
   A skill supplies behavior; it cannot supply that connection or wake-up API.
3. Add explicit bounded reply notification for idle senders only when their native
   adapter supports it. Preserve human scope, expiry, budget and loop controls;
   avoid automatic acknowledgements that create reciprocal message loops.
4. Admit further providers through the same contract with their own live evidence.
   Expose unavailable capabilities clearly instead of claiming provider parity.

Do not promise zero token/subscription consumption. Compare observed usage for the
same work under the user's actual plan before claiming savings.
