import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RelayStatus, Session } from '../../shared/types'
import type { TimelineItem } from '../../shared/threadTimeline'
import type { ThreadArtifact } from '../../shared/artifacts'
import { useArtifactCatalog } from '../hooks/useArtifactCatalog'
import { timelineView, type ThreadTimelineState } from '../hooks/useThreadTimeline'
import { relayLine } from '../lib/relay'
import { conversationRows } from '../../shared/threadActivity'
import { ActivityGroup, ActivityIcon } from './ThreadActivity'
import { ThreadFileChanges } from './ThreadFileChanges'
import { ThreadComposer, ThreadComposerContext } from './ThreadComposer'
import { CodexPlan } from './CodexPlan'
import { ThreadMessageText } from './ThreadMessageText'
import styles from './ThreadConversation.module.css'

const itemSignature = (item: TimelineItem) => JSON.stringify([item.text, item.fileChanges])

function time(at: number | null) {
  return at === null
    ? ''
    : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Message({
  item,
  threadId,
  provider,
  streaming,
  onInspect,
  artifacts,
  cwd,
  onOpenArtifact,
}: {
  item: TimelineItem
  threadId: string
  provider: string
  streaming: boolean
  onInspect: (opening: boolean) => void
  artifacts: ThreadArtifact[]
  cwd: string
  onOpenArtifact?: (id: string) => void
}) {
  if (item.activity === 'files') return <ThreadFileChanges item={item} threadId={threadId} />
  if (item.role === 'activity' && !item.detail)
    return (
      <p className={styles.activityEvent} data-message-id={item.id}>
        <ActivityIcon kind={item.activity} />
        {item.text}
      </p>
    )
  if (item.role === 'activity')
    return (
      <details className={styles.tool} data-message-id={item.id}>
        <summary>{item.text}</summary>
        <pre>{item.detail || (item.complete ? 'Recorded activity' : 'In progress')}</pre>
      </details>
    )
  return (
    <article className={styles.message} data-role={item.role} data-message-id={item.id}>
      <div
        className={styles.meta}
        data-progress={item.role === 'assistant' && item.phase === 'progress'}
      >
        <span>
          {item.role === 'user'
            ? 'You'
            : `${provider}${item.phase === 'final' && item.complete ? ' · Reply' : ''}`}
        </span>
        {item.at !== null && (
          <time dateTime={new Date(item.at).toISOString()}>{time(item.at)}</time>
        )}
      </div>
      {item.role === 'user' ? (
        <details className={styles.userMessage} data-user-message="">
          <summary
            onClick={(event) =>
              onInspect(!(event.currentTarget.parentElement as HTMLDetailsElement).open)
            }
            aria-description="Expand or collapse your message."
          >
            <span className={styles.userMessageText}>{item.text}</span>
          </summary>
        </details>
      ) : (
        <p>
          <ThreadMessageText
            text={item.text}
            artifacts={artifacts}
            cwd={cwd}
            onOpenArtifact={onOpenArtifact}
          />
          {streaming && item.role === 'assistant' && (
            <span className={styles.caret} aria-label="Message in progress" />
          )}
        </p>
      )}
    </article>
  )
}

export function ThreadConversation({
  session,
  relay,
  now,
  timelineState,
  onOpenArtifact,
}: {
  session: Session
  relay?: RelayStatus
  now: number
  onOpenArtifact?: (id: string) => void
  timelineState: ThreadTimelineState
}) {
  const composerHost = useContext(ThreadComposerContext)
  const artifacts = useArtifactCatalog(session.id)
  const reportComposer = composerHost?.report
  const focusRequest = composerHost?.focusRequest
  const { timeline, error, older } = timelineState
  const [initialView] = useState(() => ({ ...timelineView(session.id) }))
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(initialView.following)
  const inspectingMessage = useRef(false)
  const previous = useRef(
    new Map(initialView.timeline?.items.map((item) => [item.id, itemSignature(item)]) ?? []),
  )
  const unseen = useRef(new Set<string>())
  const initialized = useRef(false)
  const [reading, setReading] = useState(!initialView.following)
  const [count, setCount] = useState(0)
  const provider = session.provider === 'codex' ? 'Codex' : 'Claude'
  const items = timeline?.items ?? []
  const rows = conversationRows(items)
  const connection = timeline?.connection ?? 'connecting'
  // The live conversation shows delivery and replies; only failures need an extra line.
  const sendFailure = relay?.state === 'failed' ? relayLine(relay, now) : null

  const remember = useCallback(() => {
    const element = scroll.current
    if (!element) return
    const view = timelineView(session.id)
    view.top = element.scrollTop
    view.following = following.current
    const rect = element.getBoundingClientRect()
    const anchor = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (node) => node.getBoundingClientRect().bottom > rect.top,
    )
    view.anchor = anchor?.dataset.messageId
    view.offset = anchor ? anchor.getBoundingClientRect().top - rect.top : undefined
  }, [session.id])
  function jump() {
    inspectingMessage.current = false
    following.current = true
    unseen.current.clear()
    setReading(false)
    setCount(0)
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
    remember()
  }

  // Showing the composer reduces history's viewport; keep live pinned after layout.
  useLayoutEffect(() => {
    const element = scroll.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [reading])
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    reportComposer?.(session.id, reading)
  }, [reportComposer, session.id, reading])
  useEffect(() => () => reportComposer?.(session.id, null), [reportComposer, session.id])
  useLayoutEffect(() => {
    if (focusRequest?.id !== session.id) return
    const frame = requestAnimationFrame(() => {
      inspectingMessage.current = false
      following.current = true
      unseen.current.clear()
      setReading(false)
      setCount(0)
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
      remember()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, session.id, remember])

  useLayoutEffect(() => {
    const element = scroll.current
    if (!element || !timeline) return
    const view = timelineView(session.id)
    const current = new Map(timeline.items.map((item) => [item.id, itemSignature(item)]))
    if (initialized.current && !following.current) {
      const previousLast = [...previous.current.keys()].at(-1)
      const lastIndex = timeline.items.findIndex((item) => item.id === previousLast)
      for (const [index, item] of timeline.items.entries()) {
        if (
          (previous.current.has(item.id) &&
            previous.current.get(item.id) !== itemSignature(item)) ||
          (!previous.current.has(item.id) && (lastIndex < 0 || index > lastIndex))
        )
          unseen.current.add(item.id)
      }
      setCount(unseen.current.size)
    }
    previous.current = current
    if (following.current) element.scrollTop = element.scrollHeight
    else {
      const anchor = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        (node) => node.dataset.messageId === view.anchor,
      )
      if (anchor && view.offset !== undefined)
        element.scrollTop +=
          anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - view.offset
      else element.scrollTop = view.top
    }
    initialized.current = true
    remember()
  }, [timeline, remember, session.id, artifacts]) // Keep the reading anchor as messages and artifact labels reflow.

  useLayoutEffect(() => {
    const element = scroll.current
    const toggle = () => {
      if (following.current && element) element.scrollTop = element.scrollHeight
    }
    element?.addEventListener('toggle', toggle, true)
    return () => {
      remember()
      element?.removeEventListener('toggle', toggle, true)
    }
  }, [remember])

  return (
    <section
      className={styles.root}
      aria-label={`${provider} conversation`}
      data-connection={connection}
    >
      {(session.plan.length > 0 || session.planText) && (
        <details className={styles.plan}>
          <summary>
            Plan · {session.plan.filter((step) => step.status === 'completed').length}/
            {session.plan.length || 1}
          </summary>
          {session.provider === 'codex' ? (
            <CodexPlan session={session} />
          ) : (
            <ul>
              {session.plan.map((step, index) => (
                <li key={index}>
                  {step.status === 'completed' ? '✓ ' : step.status === 'in_progress' ? '● ' : '○ '}
                  {step.content}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {(error || timeline?.notice) && (
        <p className={styles.notice} role="status">
          {error || timeline?.notice}
        </p>
      )}
      <div className={styles.body}>
        <div
          ref={scroll}
          className={styles.scroll}
          role="region"
          aria-label="Conversation history"
          tabIndex={0}
          onScroll={() => {
            const element = scroll.current!
            following.current =
              !inspectingMessage.current &&
              element.scrollHeight - element.scrollTop - element.clientHeight < 24
            setReading(!following.current)
            if (following.current) {
              unseen.current.clear()
              setCount(0)
            }
            remember()
          }}
        >
          <div ref={content}>
            {timeline?.hasMore && (
              <button
                type="button"
                className={styles.older}
                disabled={timeline.loadingOlder}
                onClick={() => {
                  remember()
                  void older()
                }}
              >
                {timeline.loadingOlder ? 'Loading earlier messages…' : '↑ Load earlier messages'}
              </button>
            )}
            {!items.length && (
              <p className={styles.empty}>
                {connection === 'connecting'
                  ? 'Loading conversation…'
                  : 'No readable messages yet.'}
              </p>
            )}
            {rows.map((row, index) =>
              row.type === 'activity' ? (
                <ActivityGroup
                  key={row.id}
                  items={row.items}
                  threadId={session.id}
                  onOpenArtifact={onOpenArtifact}
                  active={
                    index === rows.length - 1 &&
                    session.state === 'working' &&
                    connection === 'live'
                  }
                />
              ) : (
                <Message
                  key={row.id}
                  item={row.item}
                  threadId={session.id}
                  provider={provider}
                  artifacts={artifacts?.items ?? []}
                  cwd={session.cwd}
                  onOpenArtifact={onOpenArtifact}
                  onInspect={(opening) => {
                    inspectingMessage.current = opening
                    if (opening) {
                      following.current = false
                      setReading(true)
                      remember()
                    }
                  }}
                  streaming={
                    index === rows.length - 1 &&
                    !row.item.complete &&
                    session.state === 'working' &&
                    (connection === 'live' || connection === 'history')
                  }
                />
              ),
            )}
          </div>
        </div>
        {sendFailure && (
          <p className={styles.pending} data-tone={sendFailure.tone} role="alert">
            {sendFailure.text}
          </p>
        )}
        <ThreadComposer session={session} relay={relay} hidden={reading} />
        {reading && (
          <div className={styles.follow}>
            <span>Reading history</span>
            <button type="button" onClick={jump}>
              {count ? `↓ ${count} new · Live` : '↓ Jump to live'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
