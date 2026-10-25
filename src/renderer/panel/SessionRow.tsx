import type { MouseEvent } from 'react'

import type { GitState, RelayStatus, Session } from '../../shared/types'
import { compact, gitSentence } from '../lib/git'
import { en } from '../i18n/en'
import { ageText } from '../lib/format'
import { relayLine } from '../lib/relay'
import { AttentionCard, attentionLine } from './AttentionCard'
import { ContextRing, contextLabel } from './ContextRing'
import styles from './Panel.module.css'
import { PullRequestBadge } from './PullRequestBadge'
import { SessionDetail } from './SessionDetail'
import { TaskTimer } from './TaskTimer'
import { Tip } from './Tip'
import { providerName, sessionProvider } from '../../shared/providers'
import { CodexPlan } from './CodexPlan'

interface SessionRowProps {
  showProvider?: boolean
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
  /** The Active list leaves the age out: everything there is happening now. */
  hideAge?: boolean
  /** Opens the Changes view on this thread's git folder. */
  onShowChanges: () => void
}

/**
 * Where its git folder stands, compactly, only what is not zero: "+22 −1" changed since the last
 * commit (as Claude shows it), "↑2" commits to push, "↓5" commits behind main. Hovering says it
 * in one sentence; clicking opens the Changes view.
 */
function GitCount({ git, onOpen }: { git: GitState; onOpen: () => void }) {
  if (!git.added && !git.removed && !git.ahead && !git.behind) return null
  return (
    <Tip
      className={`${styles.diff} ${styles.diffLink}`}
      text={gitSentence(git)}
      onClick={(event) => {
        event.stopPropagation() // the row itself would expand
        onOpen()
      }}
    >
      {git.added > 0 && <span className={styles.added}>+{compact(git.added)}</span>}
      {git.removed > 0 && <span className={styles.removed}>−{compact(git.removed)}</span>}
      {git.ahead > 0 && <span className={styles.ahead}>↑{git.ahead}</span>}
      {git.behind > 0 && <span className={styles.behind}>↓{git.behind}</span>}
    </Tip>
  )
}

export function SessionRow(props: SessionRowProps) {
  const { session, relay, composing, now, expanded, onToggle, onContextMenu, onCompose } = props
  // A message in flight, or a fresh reply, replaces the stage line for a while.
  const line = relayLine(relay, now)
  const appId = session.appId
  const attention = session.attention
  const titleClass = [styles.title, composing && styles.composing].filter(Boolean).join(' ')
  return (
    <div
      className={expanded ? `${styles.row} ${styles.expanded}` : styles.row}
      data-provider={props.showProvider ? sessionProvider(session.id) : undefined}
    >
      <button
        className={styles.rowButton}
        data-provider={props.showProvider ? sessionProvider(session.id) : undefined}
        title={props.showProvider ? `${providerName(sessionProvider(session.id))} chat` : undefined}
        aria-description={
          props.showProvider ? `${providerName(sessionProvider(session.id))} chat` : undefined
        }
        onClick={onToggle}
        onContextMenu={onContextMenu}
        aria-expanded={expanded}
      >
        <span className={styles.rowTop}>
          {/* The state dot, with the thread's context ring around it. */}
          <span
            className={styles.dotSlot}
            title={session.contextUsed !== null ? contextLabel(session.contextUsed) : undefined}
          >
            {session.contextUsed !== null && (
              <ContextRing used={session.contextUsed} wide={attention !== null} />
            )}
            <span
              className={styles.stateDot}
              data-state={session.state}
              data-attention={attention ? '' : undefined}
            />
          </span>
          <span className={titleClass}>{session.title}</span>
          {session.git && <GitCount git={session.git} onOpen={props.onShowChanges} />}
          {/* A long title fades out behind this, so it always shows. */}
          {attention && <span className={styles.needsYou}>{en.attention.needsYou}</span>}
          {/* Expanded, Open ↗ takes the age's place (drawn outside this button, below). */}
          {expanded && appId ? (
            <span className={styles.openSpace} aria-hidden="true" />
          ) : session.backgroundTasks.length > 0 ? (
            <TaskTimer tasks={session.backgroundTasks} />
          ) : (
            !props.hideAge && (
              <span className={styles.age}>{ageText(session.lastActiveAt, now)}</span>
            )
          )}
        </span>
        <span className={styles.rowBottom}>
          <PullRequestBadge pullRequests={session.pullRequests} />
          <span className={styles.stage} data-tone={line?.tone}>
            {!line && !attention && session.thinking && <span className={styles.spinner} />}
            {line?.text ?? (attention && attentionLine(attention)) ?? session.stage}
          </span>
        </span>
      </button>
      {expanded && appId && (
        <button className={styles.rowOpen} onClick={() => window.threadlight.openInClaude(appId)}>
          {en.detail.open}
        </button>
      )}
      {/* Codex's plan remains visible while its question or approval card waits for an answer. */}
      {expanded &&
        attention &&
        sessionProvider(session.id) === 'codex' &&
        (session.plan.length > 0 || session.planText) && (
          <div className={styles.detail}>
            <CodexPlan session={session} />
          </div>
        )}
      {expanded &&
        (attention ? (
          <div className={styles.cardSlot}>
            <AttentionCard
              session={session}
              attention={attention}
              relay={relay}
              onCompose={onCompose}
              onCollapse={onToggle}
            />
          </div>
        ) : (
          <SessionDetail session={session} relay={relay} now={now} />
        ))}
    </div>
  )
}
