import type { MouseEvent } from 'react'

import type { RelayStatus, Session } from '../../shared/types'
import { en } from '../i18n/en'
import { ageText } from '../lib/format'
import { relayLine } from '../lib/relay'
import { AttentionCard, attentionLine } from './AttentionCard'
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
  /** Opens the composer on this thread (a waiting thread's card uses it for Other). */
  onCompose: () => void
}

export function SessionRow(props: SessionRowProps) {
  const { session, relay, composing, now, expanded, onToggle, onContextMenu, onCompose } = props
  // A message in flight, or a fresh reply, replaces the stage line for a while.
  const line = relayLine(relay, now)
  const appId = session.appId
  const attention = session.attention
  const titleClass = [styles.title, composing && styles.composing, attention && styles.fadeTitle]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={expanded ? `${styles.row} ${styles.expanded}` : styles.row}>
      <button
        className={styles.rowButton}
        onClick={onToggle}
        onContextMenu={onContextMenu}
        aria-expanded={expanded}
      >
        <span className={styles.rowTop}>
          <span
            className={styles.stateDot}
            data-state={session.state}
            data-attention={attention ? '' : undefined}
          />
          <span className={titleClass}>{session.title}</span>
          {/* A long title fades out behind this, so it always shows. */}
          {attention && <span className={styles.needsYou}>{en.attention.needsYou}</span>}
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
            {line?.text ?? (attention && attentionLine(attention)) ?? session.stage}
          </span>
        </span>
      </button>
      {expanded && appId && (
        <button className={styles.rowOpen} onClick={() => window.threadlight.openInClaude(appId)}>
          {en.detail.open}
        </button>
      )}
      {/* Waiting on the user, the card is all an expanded thread shows. */}
      {expanded &&
        (attention ? (
          <div className={styles.cardSlot}>
            <AttentionCard session={session} attention={attention} onCompose={onCompose} />
          </div>
        ) : (
          <SessionDetail session={session} relay={relay} now={now} />
        ))}
    </div>
  )
}
