import type { RelayStatus } from '../../shared/types'
import { en } from '../i18n/en'

/** How long a reply or failure stays on the row before the session's own stage returns. */
const SHOW_RESULT_MS = 2 * 60 * 1000

export type Tone = 'muted' | 'accent' | 'amber'

/** The composer's delivery mark: …, ✓ Sent, ✓✓ Read, or Not sent. */
export function ticks(status: RelayStatus | undefined): { text: string; tone: Tone } | null {
  switch (status?.state) {
    case 'sending':
      return { text: en.relay.sending, tone: 'muted' }
    case 'sent':
      return { text: en.relay.sent, tone: 'muted' }
    case 'replied':
      return { text: en.relay.read, tone: 'accent' }
    case 'failed':
      return { text: en.relay.notSent, tone: 'amber' }
    default:
      return null
  }
}

/** What the session's row shows while a message is in flight or just answered. */
export function relayLine(
  status: RelayStatus | undefined,
  now: number,
): { text: string; tone: Tone } | null {
  if (!status) return null
  if (status.state === 'sending') return { text: en.relay.rowSending, tone: 'muted' }
  if (status.state === 'sent') return { text: en.relay.rowSent, tone: 'muted' }
  if (now - status.at > SHOW_RESULT_MS) return null
  if (status.state === 'replied')
    return { text: `${en.relay.ticks} ${status.detail}`, tone: 'accent' }
  return { text: status.detail, tone: 'amber' }
}
