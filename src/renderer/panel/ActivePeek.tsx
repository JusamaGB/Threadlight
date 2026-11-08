import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useThreadTimeline } from '../hooks/useThreadTimeline'
import { SessionRowDetails } from './SessionRow'
import { ThreadComposerContext } from './ThreadComposer'
import type { RelayStatus, Session } from '../../shared/types'
import { relayLine } from '../lib/relay'
import { attentionLine } from './AttentionCard'
import { ContextRing } from './ContextRing'
import styles from './Panel.module.css'

/** A live preview shared by the temporary peek and the pinned Active section. */
export function ActivePeek({
  sessions,
  relays,
  now,
  pinned = false,
  expanded,
  renderDetail,
  onOpen,
}: {
  sessions: Session[]
  relays: Map<string, RelayStatus>
  now: number
  pinned?: boolean
  expanded?: string | null
  renderDetail?: (session: Session) => ReactNode
  onOpen: (session: Session) => void
}) {
  const active = sessions.filter(
    (s) =>
      s.id === expanded ||
      s.state === 'working' ||
      s.state === 'waiting' ||
      s.unread ||
      now - s.lastActiveAt < 30_000,
  )
  const list = useRef<HTMLDivElement>(null)
  const lastOpened = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    if (!expanded) {
      if (document.activeElement === document.body)
        lastOpened.current?.focus({ preventScroll: true })
      lastOpened.current = null
      return
    }
    if (!list.current) return
    const row = list.current.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
    if (row) {
      lastOpened.current = row
      list.current.scrollTop +=
        row.getBoundingClientRect().top - list.current.getBoundingClientRect().top
    }
  }, [expanded])
  return (
    <section
      className={`${styles.peekView}${pinned ? ` ${styles.pinnedActive}` : ''}`}
      aria-label={pinned ? 'Pinned Active threads' : 'Temporary Active threads'}
      data-reader-open={!!expanded || undefined}
    >
      <header className={styles.header}>
        <span className={styles.heading}>Active · {active.length}</span>
      </header>
      <div className={styles.peekList} ref={list} tabIndex={pinned ? 0 : undefined}>
        {!active.length && <p className={styles.empty}>No active threads</p>}
        {active.map((session) => (
          <div key={session.id} className={styles.row}>
            <button
              type="button"
              className={`${styles.rowButton} ${styles.peekRow}`}
              onClick={() => onOpen(session)}
              aria-expanded={pinned ? expanded === session.id : undefined}
            >
              <div className={styles.rowTop}>
                <span className={styles.dotSlot}>
                  <ContextRing
                    used={session.contextUsed}
                    wide={!!session.attention}
                    active={session.state === 'working'}
                    thinking={session.thinking}
                    unread={session.unread}
                  />
                </span>
                <span className={styles.title}>{session.title}</span>
              </div>
              <div className={styles.rowBottom}>
                <span className={styles.stage}>
                  {session.compacting && session.state === 'working'
                    ? session.stage
                    : ((relays.get(session.id)?.state === 'failed'
                        ? relayLine(relays.get(session.id), now)?.text
                        : null) ??
                      (session.attention && attentionLine(session.attention)) ??
                      session.stage)}
                </span>
                {session.attention && <span className={styles.needsYou}>Needs your input</span>}
              </div>
            </button>
            {session.id === expanded && renderDetail?.(session)}
          </div>
        ))}
      </div>
    </section>
  )
}
/** Keep the pin's composer focus and close action independent of the page above it. */
export function PinnedThreadReader({
  session,
  relay,
  now,
  onClose,
  onOpenArtifact,
  renderComposer,
}: {
  session: Session
  relay: RelayStatus | undefined
  now: number
  onClose: () => void
  onOpenArtifact: (id: string) => void
  renderComposer: (hidden: boolean, focusToken: number) => ReactNode
}) {
  const composer = useContext(ThreadComposerContext)
  const timeline = useThreadTimeline(
    session.id,
    typeof window.threadlight.threadTimeline === 'function' &&
      typeof window.threadlight.onThreadTimeline === 'function',
  )
  const [focusRequest, requestFocus] = useState<{ id: string; token: number } | null>(null)
  return (
    <ThreadComposerContext.Provider
      value={
        composer && {
          dictation: composer.dictation,
          focusRequest,
          render: (_session, _relay, hidden) => renderComposer(hidden, focusRequest?.token ?? 0),
        }
      }
    >
      <SessionRowDetails
        session={session}
        relay={relay}
        now={now}
        timelineState={timeline}
        onToggle={onClose}
        onOpenArtifact={onOpenArtifact}
        onCompose={() =>
          requestFocus((previous) => ({ id: session.id, token: (previous?.token ?? 0) + 1 }))
        }
      />
    </ThreadComposerContext.Provider>
  )
}
