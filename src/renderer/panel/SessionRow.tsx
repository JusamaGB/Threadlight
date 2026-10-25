import type { MouseEvent } from 'react'

import type { RelayStatus, Session } from '../../shared/types'
import { en } from '../i18n/en'
import { ageText } from '../lib/format'
import { relayLine } from '../lib/relay'
import styles from './Panel.module.css'
import { PullRequestBadge } from './PullRequestBadge'
import { SessionDetail } from './SessionDetail'
import { TaskTimer } from './TaskTimer'

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
  const appId = session.appId
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
          {/* Expanded, Open ↗ takes the age's place (drawn outside this button, below). */}
          {expanded && appId ? (
            <span className={styles.openSpace} aria-hidden="true" />
          ) : session.backgroundTasks.length > 0 ? (
            <TaskTimer tasks={session.backgroundTasks} />
          ) : (
            <span className={styles.age}>{ageText(session.lastActiveAt, now)}</span>
          )}
        </span>
        <span className={styles.rowBottom}>
          <PullRequestBadge pullRequests={session.pullRequests} />
          <span className={styles.stage} data-tone={line?.tone}>
            {line?.text ?? session.stage}
          </span>
        </span>
      </button>
      {expanded && appId && (
        <button className={styles.rowOpen} onClick={() => window.threadlight.openInClaude(appId)}>
          {en.detail.open}
        </button>
      )}
      {expanded && <SessionDetail session={session} relay={relay} now={now} />}
    </div>
  )
}
