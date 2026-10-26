import type { MouseEvent } from 'react'

import type { RelayStatus, Session, ThreadDiffSummary } from '../../shared/types'
import { compact, gitLine, threadDiffSentence } from '../lib/git'
import { en } from '../i18n/en'
import { lastActiveText } from '../lib/format'
import { relayLine } from '../lib/relay'
import { AttentionCard, attentionLine } from './AttentionCard'
import { ContextRing, contextLabel } from './ContextRing'
import styles from './Panel.module.css'
import { PullRequestBadge } from './PullRequestBadge'
import { SessionDetail } from './SessionDetail'
import { TaskTimer } from './TaskTimer'
import { Tip } from './Tip'
import { providerName, sessionProvider, workspaceFolder } from '../../shared/providers'
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
  /** Opens only this thread's recorded changes. */
  onShowChanges: () => void
}

/** The badge and opened viewer share this chat's recorded diff, never its worktree total. */
function ThreadCount({ diff, onOpen }: { diff: ThreadDiffSummary; onOpen: () => void }) {
  if (!diff.files) return null
  return (
    <Tip
      className={`${styles.diff} ${styles.diffLink}`}
      text={threadDiffSentence(diff)}
      onClick={(event) => {
        event.stopPropagation() // the row itself would expand
        onOpen()
      }}
    >
      {diff.added > 0 && <span className={styles.added}>+{compact(diff.added)}</span>}
      {diff.removed > 0 && <span className={styles.removed}>−{compact(diff.removed)}</span>}
      {!diff.added && !diff.removed && (
        <span>{diff.files ? en.changes.files(diff.files) : en.changes.title}</span>
      )}
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
      data-session-id={session.id}
      data-workspace-folder={workspaceFolder(session.git?.root || session.cwd) || undefined}
      data-provider={props.showProvider ? sessionProvider(session.id) : undefined}
    >
      <Tip
        as="button"
        text={lastActiveText(session.lastActiveAt, now)}
        restDelay={1000}
        className={styles.rowButton}
        data-provider={props.showProvider ? sessionProvider(session.id) : undefined}
        aria-description={
          props.showProvider ? `${providerName(sessionProvider(session.id))} chat` : undefined
        }
        onClick={onToggle}
        onContextMenu={onContextMenu}
        aria-expanded={expanded}
      >
        <span className={styles.rowTop}>
          {/* The context ring also carries the working animation. Amber still marks attention. */}
          <Tip
            data-workspace-anchor=""
            className={styles.dotSlot}
            text={
              session.contextUsed !== null
                ? contextLabel(session.contextUsed)
                : session.state === 'working'
                  ? 'Context unavailable'
                  : ''
            }
          >
            {(session.contextUsed !== null || session.state === 'working') && (
              <ContextRing
                used={session.contextUsed}
                wide={attention !== null}
                active={session.state === 'working'}
                thinking={session.thinking}
              />
            )}
            {(session.state === 'waiting' || attention) && (
              <span
                className={styles.stateDot}
                data-state={session.state}
                data-attention={attention ? '' : undefined}
              />
            )}
          </Tip>
          <span className={titleClass}>{session.title}</span>
          {!session.threadDiff && session.threadDiffStatus === 'loading' && (
            <Tip
              className={styles.diff}
              text="Loading thread changes"
              aria-label="Loading thread changes"
            >
              �
            </Tip>
          )}
          {session.threadDiff && (
            <ThreadCount diff={session.threadDiff} onOpen={props.onShowChanges} />
          )}
          {/* A long title fades out behind this, so it always shows. */}
          {attention && <span className={styles.needsYou}>{en.attention.needsYou}</span>}
          {/* Keep space for Open ↗, drawn outside this button on expanded rows. */}
          {expanded && appId && <span className={styles.openSpace} aria-hidden="true" />}
        </span>
        <span className={styles.rowBottom}>
          <PullRequestBadge pullRequests={session.pullRequests} />
          <span className={styles.stage} data-tone={line?.tone}>
            {line?.text ?? (attention && attentionLine(attention)) ?? session.stage}
          </span>
          {session.git && (session.git.ahead > 0 || session.git.behind > 0) && (
            <Tip data-git-tracker="" className={styles.diff} text={gitLine(session.git)}>
              {session.git.ahead > 0 && <span className={styles.ahead}>↑{session.git.ahead}</span>}
              {session.git.behind > 0 && (
                <span className={styles.behind}>↓{session.git.behind}</span>
              )}
            </Tip>
          )}
          {!(expanded && appId) && session.backgroundTasks.length > 0 && (
            <TaskTimer tasks={session.backgroundTasks} />
          )}
        </span>
      </Tip>
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
