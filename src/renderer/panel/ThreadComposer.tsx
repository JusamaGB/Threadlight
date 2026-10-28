import { createContext, useContext, type ReactNode } from 'react'
import type { RelayStatus, Session } from '../../shared/types'

export const ThreadComposerContext = createContext<{
  render: (session: Session, relay: RelayStatus | undefined, hidden: boolean) => ReactNode
  report: (id: string, reading: boolean | null) => void
  focusRequest: { id: string; token: number } | null
} | null>(null)

/** Both locations render the same composer; the panel owns microphone routing. */
export function ThreadComposer({
  session,
  relay,
  hidden,
}: {
  session: Session
  relay?: RelayStatus
  hidden: boolean
}) {
  const host = useContext(ThreadComposerContext)
  return host?.render(session, relay, hidden) ?? null
}
