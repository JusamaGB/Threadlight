import type { Attention } from '../../shared/types'
import type { ThreadVisibleItem } from '../../shared/threadRead'

/** Copy display data only: hold IDs and response callbacks never cross the read boundary. */
export function attentionEvidence(
  attention: Attention | null,
  at: number,
  source: string,
): ThreadVisibleItem | undefined {
  if (!attention) return undefined
  const text =
    attention.kind === 'question'
      ? attention.questions.map((q) => q.question).join('\n')
      : attention.kind === 'approval'
        ? [attention.tool, attention.action].filter(Boolean).join(': ')
        : attention.kind === 'offer'
          ? attention.title
          : attention.ask
  const until = attention.answerableUntil
  return {
    id: `${source}:${at}`,
    role: 'activity',
    kind: 'attention',
    text: `${text.slice(0, 4000)}\nRead-only. ${until ? `Observed response window ends ${new Date(until).toISOString()}.` : 'Response availability unverified; use the provider chat.'}`,
    phase: 'progress',
    at,
    turnId: null,
    complete: false,
    source,
    expiresAt: until,
  }
}
