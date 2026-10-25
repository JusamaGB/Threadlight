import type { MouseEvent } from 'react'

import type { Session } from '../../shared/types'
import { ageText } from '../lib/format'
import styles from './Panel.module.css'
import { SessionDetail } from './SessionDetail'

interface SessionRowProps {
  session: Session
  now: number
  expanded: boolean
  onToggle: () => void
  onContextMenu: (event: MouseEvent) => void
}

export function SessionRow({ session, now, expanded, onToggle, onContextMenu }: SessionRowProps) {
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
          <span className={styles.title}>{session.title}</span>
          <span className={styles.age}>{ageText(session.lastActiveAt, now)}</span>
        </span>
        <span className={styles.stage}>{session.stage}</span>
      </button>
      {expanded && <SessionDetail session={session} />}
    </div>
  )
}
