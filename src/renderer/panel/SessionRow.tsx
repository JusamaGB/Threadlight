import type { MouseEvent } from 'react'

import type { RelayStatus, Session } from '../../shared/types'
import { ageText } from '../lib/format'
import { relayLine } from '../lib/relay'
import styles from './Panel.module.css'
import { SessionDetail } from './SessionDetail'

interface SessionRowProps {
  session: Session
  relay: RelayStatus | undefined
  /** This is the thread the composer is writing to. */
  composing: boolean
  now: number
  expanded: boolean
  onToggle: () => void
  onContextMenu: (event: MouseEvent) => void
}

export function SessionRow(props: SessionRowProps) {
  const { session, relay, composing, now, expanded, onToggle, onContextMenu } = props
  // A message in flight, or a fresh reply, replaces the stage line for a while.
  const line = relayLine(relay, now)
  return (
    <div className={expanded ? `${styles.row} ${styles.expanded}` : styles.row}>
      <button
        className={styles.rowButton}
        onClick={onToggle}
        onContextMenu={onContextMenu}
        aria-expanded={expanded}
      >
        <span className={styles.rowTop}>
          <span className={styles.stateDot} data-state={session.state} />
          <span className={composing ? `${styles.title} ${styles.composing}` : styles.title}>
            {session.title}
          </span>
          <span className={styles.age}>{ageText(session.lastActiveAt, now)}</span>
        </span>
        <span className={styles.stage} data-tone={line?.tone}>
          {line?.text ?? session.stage}
        </span>
      </button>
      {expanded && <SessionDetail session={session} relay={relay} now={now} />}
    </div>
  )
}
