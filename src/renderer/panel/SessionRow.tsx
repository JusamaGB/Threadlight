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
import { useThreadTimeline, type ThreadTimelineState } from '../hooks/useThreadTimeline'
import { liveThreadActivity } from '../../shared/threadActivity'

interface SessionRowProps {
  striped?: boolean
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
  onOpenArtifact: (id: string) => void
  onRead: () => void
}

/** The badge and opened viewer share this chat's recorded diff, never its worktree total. */
function ThreadCount({
  diff,
  onOpen,
  details = false,
}: {
  diff: ThreadDiffSummary
  onOpen: () => void
  details?: boolean
}) {
  const hasRecorded = diff.groups?.some((group) => group.recorded?.length)
  if (!diff.files && diff.complete && !diff.hasOtherLensChanges && !diff.stale && !hasRecorded)
    return null
  const partial = !hasRecorded && !diff.complete
  const hasDetails = partial || diff.stale || (diff.groups?.length ?? 0) > 1
  if (details && !hasDetails) return null
  if (!details && !diff.added && !diff.removed && !diff.complete && !diff.hasOtherLensChanges)
    return null
  return (
    <Tip
      data-diff-coverage={details || undefined}
      aria-label={details ? `Diff coverage: ${threadDiffSentence(diff)}` : undefined}
      className={`${styles.diff} ${styles.diffLink}`}
      text={threadDiffSentence(diff)}
      infoContent={
        <span className={styles.tipDiff}>
          <span className={styles.tipDiffHeading}>
            <strong>{en.changes.title}</strong>
            <span>{en.git.filesChanged(diff.files)}</span>
          </span>
          {(diff.added > 0 || diff.removed > 0) && (
            <span className={styles.tipDiffCounts}>
              {diff.added > 0 && <span className={styles.added}>+{compact(diff.added)} added</span>}
              {diff.removed > 0 && (
                <span className={styles.removed}>−{compact(diff.removed)} removed</span>
              )}
            </span>
          )}
          <span className={styles.tipDiffStatus}>
            {hasRecorded && !diff.files ? 'No current changes matched' : en.changes.uncommitted}
            {!diff.complete && ` · ${en.changes.partialShort}`}
          </span>
          {diff.groups?.map((group) => (
            <span key={group.rootId} style={{ overflowWrap: 'anywhere' }}>
              {group.root}
            </span>
          ))}
          {(diff.groups?.length ?? 0) > 1 && (
            <span>{diff.groups!.length} source folders or checkouts</span>
          )}
        </span>
      }
      tourHelp="Click to view this thread's files and diffs."
      onClick={(event) => {
        event.stopPropagation() // the row itself would expand
        onOpen()
      }}
    >
      {!details && diff.added > 0 && <span className={styles.added}>+{compact(diff.added)}</span>}
      {!details && diff.removed > 0 && (
        <span className={styles.removed}>−{compact(diff.removed)}</span>
      )}
      {details && partial && <span>Partial</span>}
      {details && diff.stale && <span>Stale</span>}
      {details && (diff.groups?.length ?? 0) > 1 && (
        <span>
          {partial || diff.stale ? '· ' : ''}
          {diff.groups!.length} roots
        </span>
      )}
      {!details && !diff.files && diff.hasOtherLensChanges && <span>Staged</span>}
      {!details && !diff.added && !diff.removed && diff.complete && !diff.hasOtherLensChanges && (
        <span>{diff.files ? en.changes.files(diff.files) : en.changes.title}</span>
      )}
    </Tip>
  )
}

export function SessionRow(props: SessionRowProps) {
  const { session, relay, composing, now, expanded, onToggle, onContextMenu } = props
  // Delivery ticks must not replace the live activity or the latest reply.
  const line = relay?.state === 'failed' ? relayLine(relay, now) : null
  const appId = session.appId
  const attention = session.attention
  const timelineSupported =
    typeof window.threadlight.threadTimeline === 'function' &&
    typeof window.threadlight.onThreadTimeline === 'function'
  const timelineState = useThreadTimeline(
    session.id,
    timelineSupported && ((!attention && session.state === 'working') || expanded),
  )
  const activity = liveThreadActivity(session, timelineState.timeline)
  const titleClass = [styles.title, composing && styles.composing].filter(Boolean).join(' ')
  return (
    <div
      className={expanded ? `${styles.row} ${styles.expanded}` : styles.row}
      data-session-id={session.id}
      data-session-title={session.title}
      data-striped={props.striped || undefined}
      data-workspace-folder={workspaceFolder(session.git?.root || session.cwd) || undefined}
      data-provider={props.showProvider ? sessionProvider(session.id) : undefined}
      data-unread={session.unread || undefined}
    >
      {/* Provider-tinted top and bottom edges frame the open chat between its neighbours. */}
      {expanded && props.showProvider && (
        <>
          <span className={styles.edgeTop} aria-hidden="true" />
          <span className={styles.edgeBottom} aria-hidden="true" />
        </>
      )}
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
              session.unread
                ? `${session.contextUsed !== null ? contextLabel(session.contextUsed) + ' · ' : ''}Finished · Unread reply`
                : session.contextUsed !== null
                  ? contextLabel(session.contextUsed)
                  : session.state === 'working'
                    ? 'Context unavailable'
                    : ''
            }
            tourHelp="The ring shows the thread's context usage and animates while the thread is active."
          >
            {(session.contextUsed !== null || session.state === 'working' || session.unread) && (
              <ContextRing
                used={session.contextUsed}
                wide={attention !== null}
                active={session.state === 'working'}
                thinking={session.thinking}
                unread={session.unread}
              />
            )}
            {(session.state === 'waiting' || attention) && (
              <span
                className={styles.stateDot}
                data-state={session.state}
                data-attention={attention ? '' : undefined}
                data-ignored={session.ignored || undefined}
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
              &hellip;
            </Tip>
          )}
          {session.threadDiff && (
            <ThreadCount diff={session.threadDiff} onOpen={props.onShowChanges} />
          )}
          {/* Keep space for Open ↗, drawn outside this button on expanded rows. */}
          {expanded && appId && <span className={styles.openSpace} aria-hidden="true" />}
        </span>
        <span className={styles.rowBottom}>
          <PullRequestBadge pullRequests={session.pullRequests} />
          <span
            className={styles.stage}
            data-tone={line?.tone}
            data-compacting={(session.compacting && session.state === 'working') || undefined}
          >
            {session.compacting && session.state === 'working'
              ? session.stage
              : (line?.text ??
                (attention && attentionLine(attention)) ??
                activity ??
                session.stage)}
          </span>
          {/* Needs your input owns the bottom right; branch and task details give way. */}
          {session.git && !attention && (
            <Tip
              data-git-tracker=""
              className={styles.diff}
              text={gitLine(session.git)}
              tourHelp="This is the thread's Git branch. ↑ counts commits to push; ↓ counts commits behind main."
            >
              {!session.git.ahead && !session.git.behind && (
                <span className={styles.branch}>{session.git.branch ?? en.git.noBranch}</span>
              )}
              {session.git.ahead > 0 && <span className={styles.ahead}>↑{session.git.ahead}</span>}
              {session.git.behind > 0 && (
                <span className={styles.behind}>↓{session.git.behind}</span>
              )}
            </Tip>
          )}
          {session.threadDiff && (
            <ThreadCount diff={session.threadDiff} onOpen={props.onShowChanges} details />
          )}
          {!(expanded && appId) && !attention && session.backgroundTasks.length > 0 && (
            <TaskTimer tasks={session.backgroundTasks} />
          )}
          {attention && (
            <Tip
              className={styles.needsYou}
              data-ignored={session.ignored || undefined}
              text=""
              tourOnly
              tourHelp="This thread is waiting for an answer or approval. Open the thread to respond."
            >
              {en.attention.needsYou}
            </Tip>
          )}
        </span>
      </Tip>
      {expanded && appId && (
        <button
          className={styles.rowOpen}
          onClick={() => {
            props.onRead()
            window.threadlight.openInClaude(appId)
          }}
        >
          {en.detail.open}
        </button>
      )}
      {expanded && <SessionRowDetails {...props} timelineState={timelineState} />}
    </div>
  )
}

export function SessionRowDetails({
  session,
  relay,
  now,
  onCompose,
  onToggle,
  onOpenArtifact,
  timelineState,
}: Pick<
  SessionRowProps,
  'session' | 'relay' | 'now' | 'onCompose' | 'onToggle' | 'onOpenArtifact'
> & { timelineState: ThreadTimelineState }) {
  const attention = session.attention
  const card = attention && !session.questionDismissed && (
    <AttentionCard
      session={session}
      attention={attention}
      relay={relay}
      onCompose={onCompose}
      onCollapse={onToggle}
    />
  )
  if (
    !attention ||
    (typeof window.threadlight.threadTimeline === 'function' &&
      typeof window.threadlight.onThreadTimeline === 'function')
  )
    return (
      <SessionDetail
        session={session}
        relay={relay}
        now={now}
        timelineState={timelineState}
        onOpenArtifact={onOpenArtifact}
        pendingCard={card}
      />
    )
  return (
    <>
      {attention &&
        sessionProvider(session.id) === 'codex' &&
        (session.plan.length > 0 || session.planText) && (
          <div className={styles.detail}>
            <CodexPlan session={session} />
          </div>
        )}
      <div className={styles.cardSlot}>{card}</div>
    </>
  )
}
