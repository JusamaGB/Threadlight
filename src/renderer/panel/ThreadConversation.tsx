import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import { EarlierMessages } from './EarlierMessages'
import { ContextMenu } from './ContextMenu'

const itemSignature = (item: TimelineItem) => JSON.stringify([item.text, item.fileChanges])

function composerFocused(history: HTMLElement) {
  const active = document.activeElement
  return (
    active instanceof HTMLTextAreaElement &&
    !!history.parentElement?.contains(active) &&
    !history.contains(active)
  )
}

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
        <>
          <ThreadMessageText
            text={item.text}
            artifacts={artifacts}
            cwd={cwd}
            onOpenArtifact={onOpenArtifact}
          />
          {streaming && item.role === 'assistant' && (
            <span className={styles.caret} aria-label="Message in progress" />
          )}
        </>
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
  pendingCard,
}: {
  pendingCard?: ReactNode
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
  const [initialView] = useState(() => ({
    ...timelineView(session.id),
    ...(pendingCard ? { following: true } : {}),
  }))
  const scroll = useRef<HTMLDivElement>(null)
  const pendingContent = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(initialView.following)
  const liveSize = useRef({ viewport: 0, content: 0 })
  const inspectingMessage = useRef(false)
  const previous = useRef(
    new Map(initialView.timeline?.items.map((item) => [item.id, itemSignature(item)]) ?? []),
  )
  const unseen = useRef(new Set<string>())
  const initialized = useRef(false)
  const [reading, setReading] = useState(!initialView.following)
  const [count, setCount] = useState(0)
  const [copyMenu, setCopyMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const provider = session.provider === 'codex' ? 'Codex' : 'Claude'
  const items = timeline?.items ?? []
  const rows = conversationRows(items)
  const connection = timeline?.connection ?? 'connecting'
  // The live conversation shows delivery and replies; only failures need an extra line.
  const sendFailure = relay?.state === 'failed' ? relayLine(relay, now) : null

  const selectedText = (history: HTMLElement) => {
    const selection = window.getSelection()
    if (
      !selection ||
      selection.isCollapsed ||
      !history.contains(selection.anchorNode) ||
      !history.contains(selection.focusNode)
    )
      return ''
    return selection.toString()
  }
  const closeCopyMenu = () => {
    setCopyMenu(null)
    scroll.current?.focus({ preventScroll: true })
  }

  const pinLive = useCallback((element: HTMLDivElement) => {
    element.scrollTop = element.scrollHeight
    liveSize.current = { viewport: element.clientHeight, content: element.scrollHeight }
  }, [])

  const hasPendingCard = !!pendingCard
  useLayoutEffect(() => {
    const element = scroll.current,
      card = pendingContent.current
    if (!element || !card) return
    const fit = () => {
      element.style.setProperty(
        '--pending-card-height',
        `${Math.ceil(card.getBoundingClientRect().height)}px`,
      )
      if (following.current) pinLive(element)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(card)
    return () => {
      observer.disconnect()
      element.style.removeProperty('--pending-card-height')
    }
  }, [hasPendingCard, pinLive])

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
    if (scroll.current) pinLive(scroll.current)
    remember()
  }

  // Showing the composer reduces history's viewport; keep live pinned after layout.
  useLayoutEffect(() => {
    const element = scroll.current
    if (element && following.current) pinLive(element)
  }, [reading, pinLive])
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (following.current) pinLive(element)
    })
    observer.observe(element)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [pinLive])

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
      if (scroll.current) pinLive(scroll.current)
      remember()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, session.id, remember, pinLive])

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
    if (following.current) pinLive(element)
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
  }, [timeline, remember, session.id, artifacts, pinLive]) // Keep the reading anchor as messages and artifact labels reflow.

  useLayoutEffect(() => {
    const element = scroll.current
    const toggle = () => {
      if (following.current && element) pinLive(element)
    }
    element?.addEventListener('toggle', toggle, true)
    return () => {
      remember()
      element?.removeEventListener('toggle', toggle, true)
    }
  }, [remember, pinLive])

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
      <div className={styles.body} data-fit-card={hasPendingCard || undefined}>
        <div
          ref={scroll}
          className={styles.scroll}
          role="region"
          aria-label="Conversation history"
          tabIndex={0}
          onContextMenu={(event) => {
            const text = selectedText(event.currentTarget)
            if (!text) return
            event.preventDefault()
            event.stopPropagation()
            setCopyMenu({ x: event.clientX, y: event.clientY, text })
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
            const text = selectedText(event.currentTarget)
            if (!text) return
            event.preventDefault()
            event.stopPropagation()
            const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
            setCopyMenu({ x: rect.left, y: rect.bottom, text })
          }}
          onWheel={(event) => {
            const element = event.currentTarget
            if (
              composerFocused(element) &&
              ((event.deltaY < 0 && element.scrollTop > 0) ||
                (event.deltaY > 0 &&
                  element.scrollTop + element.clientHeight < element.scrollHeight))
            )
              element.focus({ preventScroll: true })
          }}
          onScroll={() => {
            const element = scroll.current!
            const resized =
              element.clientHeight !== liveSize.current.viewport ||
              element.scrollHeight !== liveSize.current.content
            if (!following.current && resized) {
              // Hiding the composer expands history and may clamp it to the
              // bottom. That must not immediately reopen the composer.
              liveSize.current = { viewport: element.clientHeight, content: element.scrollHeight }
              remember()
              return
            }
            // A growing composer shrinks history before ResizeObserver runs.
            // That layout scroll (or caret reveal while typing) must not hide
            // the composer. Wheel input explicitly moves focus back to history.
            if (
              following.current &&
              !inspectingMessage.current &&
              (composerFocused(element) || resized)
            ) {
              pinLive(element)
              remember()
              return
            }
            following.current =
              !inspectingMessage.current &&
              element.scrollHeight - element.scrollTop - element.clientHeight <
                (hasPendingCard ? 2 : 24)
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
              <EarlierMessages
                loading={timeline.loadingOlder}
                onLoad={() => {
                  remember()
                  void older()
                }}
              />
            )}
            {!items.length && !pendingCard && (
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
            {pendingCard && (
              <div className={styles.attentionEnd} data-pending-card="">
                <div ref={pendingContent}>{pendingCard}</div>
              </div>
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
      {copyMenu && (
        <ContextMenu
          label="Text actions"
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={closeCopyMenu}
          items={[{ label: 'Copy', onSelect: () => window.threadlight.copyText(copyMenu.text) }]}
        />
      )}
    </section>
  )
}
