import { createPortal } from 'react-dom'
import { IDLE_MOTION } from '../../shared/motion'
import { ElectricMotion } from '../motion/ElectricMotion'
import { LiveInputContext, withLiveInputPreview } from '../lib/liveInputPreview'
import { timing } from '../../shared/liveTiming'
import { ComposerInput } from '../composer/ComposerInput'
import { ConversationTimeline } from '../communication/ConversationTimeline'
import {
  useEffect,
  useContext,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import type { NavigationHandle } from '../../shared/navigationHistory'

import { agentBusy, type AgentConversation, type AgentItem } from '../../shared/agent'
import { AgentRequestCard } from './AgentRequestCard'
import { useAgent } from '../hooks/useAgent'
import { useSettings } from '../hooks/useSettings'
import { acceleratorLabel } from '../../shared/accelerator'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { useTranscriptScroll } from './useTranscriptScroll'
import { AgentReadingGrip, savedReadingHeight } from './AgentReadingGrip'
import { AgentSettings } from '../settings/AgentSettings'
import { AgentIdentity } from './AgentIdentity'
import { ageText } from '../lib/format'
import { CallIcon } from './CallIcon'
import styles from './Panel.module.css'
import type { AgentClient } from '../lib/agentClient'
import { agentDisplayText, voiceInput } from '../../shared/agentTranscript'
import { AgentMessageContent } from './AgentMessageContent'
import threadStyles from './AgentThread.module.css'

export interface AgentNavigation extends NavigationHandle {
  showCurrent(): void
}

function ConversationIcon({ action }: { action: 'compose' | 'new' | 'close' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {action === 'compose' && <path d="m3 10 7.5-7.5 3 3L6 13l-4 1zM9 4l3 3" />}
      {action === 'new' && (
        <path d="M8 3H3a1 1 0 0 0-1 1v9l3-2h7a1 1 0 0 0 1-1V8M12 1v5m-2.5-2.5h5" />
      )}
      {action === 'close' && <path d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.6 9h6.8l.6-9M7 7v4m2-4v4" />}
    </svg>
  )
}

/** A past conversation open to read. */
interface Reading {
  id: string
  items: AgentItem[]
  cursor: string | null
}

function RequestText({ item, format }: { item: AgentItem; format?: (text: string) => ReactNode }) {
  const spoken = item.kind === 'you' ? voiceInput(item.text) : null
  if (spoken !== null || item.audioDetails?.length)
    return (
      <>
        <p className={threadStyles.plain}>
          {format ? format(spoken ?? item.text) : (spoken ?? item.text)}
        </p>
        <details className={threadStyles.audio}>
          <summary>Audio received</summary>
          {(item.audioDetails ?? [agentDisplayText(item.text)]).map((record, index) => (
            <pre key={index}>{record}</pre>
          ))}
        </details>
      </>
    )
  const text = agentDisplayText(item.text)
  return <p className={threadStyles.plain}>{format ? format(text) : text}</p>
}

/** The lines of a conversation: what you asked, what it said, and its steps. */
const paintedAnswers = new Set<string>()
function SpokenAnswer({ item, format }: { item: AgentItem; format?: (text: string) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasText = !!item.text.trim()
  useEffect(() => {
    const el = ref.current,
      session = item.timingSession
    if (!session || !el || !hasText || !item.id) return
    const key = session + '/' + item.id
    if (paintedAnswers.has(key)) return
    let frame = 0
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || document.hidden) return
      observer.disconnect()
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (el.isConnected && !document.hidden && !paintedAnswers.has(key)) {
            if (paintedAnswers.size >= 512)
              paintedAnswers.delete(paintedAnswers.values().next().value!)
            paintedAnswers.add(key)
            window.threadlight?.reportLiveTiming?.(timing(session, 'answer-frame'))
          }
        })
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [item.id, item.timingSession, hasText])
  if (!item.timingSession && !item.spokenDetails?.length)
    return <AgentMessageContent text={item.text} format={format} />
  return (
    <div ref={ref}>
      <AgentMessageContent text={item.text} format={format} />
      {!!item.spokenDetails?.length && (
        <details className={threadStyles.audio}>
          <summary>Spoken reply</summary>
          {item.spokenDetails.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </details>
      )}
    </div>
  )
}

function Lines({
  items,
  itemKey,
  select,
  historical = false,
  format,
}: {
  items: AgentItem[]
  itemKey?: string
  select?: (ref: string) => void
  historical?: boolean
  format?: (text: string) => ReactNode
}) {
  return (
    <>
      {items.map((item, index) =>
        item.source ? (
          <details
            key={item.id ?? index}
            data-message-id={item.id ?? itemKey}
            className={styles.agentItem}
          >
            <summary>
              Source ·{' '}
              {'thread' in item.source.result ? item.source.result.thread.title : 'Chat search'}
              {historical || item.sourceHistorical ? ' · historical' : ''}
            </summary>
            <p>
              {'thread' in item.source.result
                ? item.source.result.checkedAt
                  ? `Checked ${new Date(item.source.result.checkedAt).toLocaleString()}`
                  : 'Refresh unavailable'
                : `Search at ${new Date(item.source.at).toLocaleString()}`}{' '}
              · {item.source.result.outcome}
            </p>
            {'candidates' in item.source.result &&
              item.source.result.candidates.map((candidate) => (
                <button
                  key={candidate.threadRef}
                  disabled={!select || historical || item.sourceHistorical}
                  className={styles.agentEnd}
                  onClick={() => select?.(candidate.threadRef)}
                >
                  {candidate.title} · {candidate.provider} · {candidate.workspace ?? 'No workspace'}
                </button>
              ))}
            {'thread' in item.source.result && (
              <>
                <p>
                  {item.source.result.thread.provider} ·{' '}
                  {item.source.result.thread.workspace ?? 'No workspace'}
                  {item.source.result.thread.archived === true ? ' · archived' : ''}
                </p>
                <p>
                  {item.source.result.status.state} · {item.source.result.status.basis}
                </p>
                {[
                  item.source.result.currentRequest,
                  item.source.result.latestProgress,
                  item.source.result.latestCompletedReply,
                  item.source.result.plan,
                  item.source.result.attention,
                  ...(item.source.result.backgroundTasks ?? []),
                ]
                  .filter(Boolean)
                  .map((entry, i) => (
                    <p key={i}>
                      {entry!.role}: {entry!.text}
                      {entry!.truncated ? '…' : ''}
                    </p>
                  ))}
              </>
            )}
            {item.source.result.coverage.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {item.source.result.sources.map((source, i) => (
              <p key={i}>
                {source.source}: {source.health}
                {source.checkedAt ? ` · ${new Date(source.checkedAt).toLocaleString()}` : ''}
                {source.sourceUpdatedAt
                  ? ` · source updated ${new Date(source.sourceUpdatedAt).toLocaleString()}`
                  : ''}
                {source.reason ? ` · ${source.reason}` : ''}
              </p>
            ))}
          </details>
        ) : (
          <div
            key={item.id ?? index}
            data-message-id={item.id ?? itemKey}
            className={`${styles.agentItem} ${threadStyles.message}`}
            data-kind={item.kind}
          >
            {item.screenPreview && (
              <img
                className={threadStyles.screenPreview}
                src={`data:image/jpeg;base64,${item.screenPreview}`}
                alt="Selected screen region"
              />
            )}
            {item.kind === 'agent' ? (
              <SpokenAnswer item={item} format={format} />
            ) : (
              <RequestText item={item} format={format} />
            )}
          </div>
        ),
      )}
    </>
  )
}

/**
 * Past conversations under a collapsed "Earlier" row, newest first; the current one is left
 * out. Listed again each time it is opened, so a conversation just ended shows up.
 */
function Earlier({
  current,
  onOpen,
  identity,
  client,
}: {
  current: string | null
  onOpen: (id: string) => void
  identity?: ReactNode
  client: AgentClient
}) {
  const [open, setOpen] = useState(false)
  const [past, setPast] = useState<AgentConversation[] | null>(null)
  const now = useNow()
  useEffect(() => {
    let live = true
    void client.agentHistory().then((found) => live && setPast(found))
    return () => {
      live = false
    }
  }, [open, current, client])
  const shown = (past ?? []).filter((conversation) => conversation.id !== current)
  const hasHistory = !past || shown.length > 0
  if (!hasHistory && !identity) return null
  return (
    <div className={styles.agentEarlier}>
      <div className={styles.agentFooter}>
        {hasHistory && (
          <button
            className={styles.agentEarlierHead}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {en.agent.earlier(shown.length)}
          </button>
        )}
        {identity && (
          <div className={styles.agentIdentity} role="group" aria-label="Agent settings">
            {identity}
          </div>
        )}
      </div>
      {open && hasHistory && (
        <div className={styles.agentPast}>
          {shown.map((conversation) => (
            <button
              key={conversation.id}
              className={styles.agentPastRow}
              title={conversation.title}
              onClick={() => onOpen(conversation.id)}
            >
              <span className={styles.agentPastTitle}>
                {conversation.provider === 'codex' ? 'Codex' : 'Claude'} · {conversation.title}
              </span>
              <span className={styles.age}>{ageText(conversation.at, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The agent: one conversation Threadlight hosts itself. It shows what you asked, what it said
 * and each step it took, live; a call that changes something waits on an Allow / Deny card; and
 * anything typed once it is done continues the same conversation.
 */
export function AgentView({
  navigationRef,
  settingsOpen = false,
  onCloseSettings,
  visible = true,
  client = window.threadlight,
  shortcut,
  onVoiceToggle,
  voiceActive = false,
  formatText,
  discussionStatus,
  readingResize,
  callPreparing = false,
  callReplySlot,
  historyKey = 'agent-reading',
  recentEntry,
  onRecentOpened,
}: {
  settingsOpen?: boolean
  onCloseSettings?: () => void
  navigationRef?: Ref<AgentNavigation>
  visible?: boolean
  client?: AgentClient
  shortcut?: string
  onVoiceToggle?: () => void
  voiceActive?: boolean
  formatText?: (text: string, historyId?: string) => ReactNode
  discussionStatus?: (historyId?: string) => ReactNode
  readingResize?: { opensDown: boolean }
  callPreparing?: boolean
  callReplySlot?: HTMLElement | null
  historyKey?: string
  recentEntry?: { id: string } | null
  onRecentOpened?: () => void
} = {}) {
  const agent = useAgent(client)
  const inputPreview = useContext(LiveInputContext)
  const settings = useSettings()
  const [text, updateText] = useState(() => client.readDraft?.() ?? '')
  const setText = (value: string) => {
    client.writeDraft?.(value)
    updateText(value)
  }
  useEffect(() => {
    if (!client.readDraft) return
    // Synchronize a project draft transferred when the backend binds the first message.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateText(client.readDraft())
  }, [client, agent.revision])
  const [finishing, setFinishing] = useState(false)
  const finishingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  useEffect(() => {
    if (!recentEntry) return
    let current = true
    const open = async () => {
      const state = await client.getAgent()
      if (!current) return
      if (state.conversationId === recentEntry.id && !state.ended) {
        setReading(null)
        return
      }
      if ((!state.conversationId || state.ended) && !agentBusy(state) && !state.live) {
        const result = await client.agentResume(recentEntry.id)
        if (!current) return
        if (result.ok) {
          setReading(null)
          return
        }
        setError(result.reason)
      }
      const page = await client.agentReadPage(recentEntry.id)
      if (current) {
        setReading({ id: recentEntry.id, items: page.items, cursor: page.cursor })
        if (page.error) setError(page.error)
      }
    }
    void open()
      .catch(() => {
        if (current) setError('Could not open the recent Agent conversation.')
      })
      .finally(() => {
        if (current) onRecentOpened?.()
      })
    return () => {
      current = false
    }
  }, [client, recentEntry, onRecentOpened])
  const input = useRef<HTMLTextAreaElement>(null)
  const [composing, setComposing] = useState(false)
  const reply = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (composing && visible && !reading) input.current?.focus({ preventScroll: true })
  }, [composing, visible, reading])
  useLayoutEffect(() => {
    const element = input.current
    const id = client.historyCurrentId?.() ?? null
    if (!element) return
    const selection = client.readDraftSelection?.(id)
    if (selection) element.setSelectionRange(selection.start, selection.end)
    return () =>
      client.writeDraftSelection?.(id, {
        start: element.selectionStart ?? 0,
        end: element.selectionEnd ?? 0,
      })
  }, [client, reading?.id, composing])
  const read = async (id: string) => {
    try {
      const page = await client.agentReadPage(id)
      setError(page.error ?? null)
      setReading({ id, items: page.items, cursor: page.cursor })
    } catch {
      setError('Could not load this earlier conversation.')
      setReading({ id, items: [], cursor: null })
    }
  }
  const pastPages = useRef(new Map<string, Reading>())
  useEffect(() => {
    if (reading) pastPages.current.set(reading.id, reading)
  }, [reading])
  const location = useNavigationHistory(
    { id: reading?.id ?? null },
    (page) => {
      if (!page.id) setReading(null)
      else {
        const saved = pastPages.current.get(page.id)
        if (saved) setReading(saved)
        else void read(page.id)
      }
    },
    true,
    historyKey,
  )
  useImperativeHandle(navigationRef, () => ({ ...location, showCurrent: () => setReading(null) }), [
    location,
  ])
  const { log, trackScroll, unread, pending, jumpToLatest, jumpToDecision, holdPosition } =
    useTranscriptScroll(
      visible,
      reading ? 'history:' + reading.id : 'current:' + agent.conversationId,
    )
  const busy = agentBusy(agent) || !!agent.live
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const hasConversation =
    !agent.ended && (!!agent.sessionId || !!agent.conversationId || agent.status !== 'idle')
  const selectedProvider = settings?.agentProvider ?? agent.provider
  const selectedModel = settings
    ? settings.agentProvider === 'codex'
      ? settings.agentCodexModel
      : `Haiku / ${settings.agentWorker}`
    : agent.model
  const selectedReasoning = settings
    ? settings.agentProvider === 'codex'
      ? settings.agentCodexReasoning
      : null
    : agent.reasoning
  const selectionChanged =
    hasConversation &&
    settings &&
    (agent.provider !== selectedProvider ||
      (selectedProvider === 'codex'
        ? (!!settings.agentCodexModel && agent.model !== settings.agentCodexModel) ||
          (!!settings.agentCodexReasoning && agent.reasoning !== settings.agentCodexReasoning)
        : agent.model?.split('/').at(-1)?.trim().toLowerCase() !== settings.agentWorker))
  const provider = hasConversation ? agent.provider : selectedProvider
  const model = hasConversation ? agent.model : selectedModel
  const reasoning = hasConversation ? agent.reasoning : selectedReasoning

  const [readingHeight, setReadingHeight] = useState(savedReadingHeight)
  const resizeScroll = useRef<{ top: number; atBottom: boolean } | null>(null)
  const resizeReader = (height: number) => {
    const reader = log.current
    if (!reader || height === readingHeight) return
    const atBottom = reader.scrollHeight - reader.clientHeight - reader.scrollTop <= 2
    trackScroll()
    resizeScroll.current = { top: reader.scrollTop, atBottom }
    setReadingHeight(height)
  }
  useLayoutEffect(() => {
    const anchor = resizeScroll.current
    if (anchor && log.current)
      log.current.scrollTo({ top: anchor.atBottom ? log.current.scrollHeight : anchor.top })
    resizeScroll.current = null
  }, [readingHeight, log])
  const readerActions = (
    <>
      {pending && !reading && (
        <button className={styles.agentEnd} onClick={jumpToDecision}>
          Needs input
        </button>
      )}
      {unread && (
        <button
          className={styles.agentEnd}
          onClick={jumpToLatest}
          title="Jump to the latest message"
        >
          New updates ↓
        </button>
      )}
    </>
  )
  async function finishChat(choice: 'archive' | 'fresh') {
    const id = agent.conversationId
    if (!id || finishingRef.current || busy || sending || agent.requests.length || agent.approval)
      return
    finishingRef.current = true
    setFinishing(true)
    try {
      const result = await client.finishCallChat(id, choice)
      setError(result.ok ? null : result.reason)
      if (result.ok) {
        setComposing(false)
        reply.current?.focus({ preventScroll: true })
      }
    } catch {
      setError('Could not finish the chat. Check Earlier before retrying.')
    } finally {
      finishingRef.current = false
      setFinishing(false)
    }
  }
  const carryOn = async () => {
    if (!reading) return
    const result = await client.agentResume(reading.id)
    if (result.ok) setReading(null)
    setError(result.ok ? null : result.reason)
  }

  const identity = (
    <AgentIdentity
      appearance={onCloseSettings ? 'agent-settings' : 'footer'}
      provider={provider}
      model={model}
      reasoning={reasoning}
      hasConversation={hasConversation}
      settings={settings}
      onError={setError}
    />
  )
  const selectionNotice = selectionChanged && (
    <div className={styles.agentSelection} role="status">
      <p>
        This conversation keeps its original model. Your next conversation will use{' '}
        {selectedProvider === 'codex' ? 'Codex' : 'Claude'} · {selectedModel ?? 'Runtime default'}
        {selectedReasoning ? ` · ${selectedReasoning}` : ''}.
      </p>
      <button
        className={styles.agentEnd}
        disabled={busy || sending}
        onClick={() => client.agentClose()}
      >
        Use selected model
      </button>
      <span>
        {busy
          ? 'Stop or finish this turn first.'
          : 'Ends this conversation; its history stays in Earlier.'}
      </span>
    </div>
  )
  const present = (chat: ReactNode) =>
    onCloseSettings ? (
      <>
        <div hidden={settingsOpen} style={settingsOpen ? undefined : { display: 'contents' }}>
          {chat}
        </div>
        {settingsOpen && (
          <section className={styles.agent} aria-label="Agent preferences">
            {settings && (
              <AgentSettings
                settings={settings}
                identity={identity}
                save={async (patch) => (await window.threadlight.updateSettings(patch)).ok}
              />
            )}
            {selectionNotice}
            {error && <p role="alert">{error}</p>}
            <Earlier
              client={client}
              current={agent.ended ? null : (client.historyCurrentId?.() ?? agent.conversationId)}
              onOpen={(id) => {
                void read(id)
                onCloseSettings()
              }}
            />
          </section>
        )}
      </>
    ) : (
      chat
    )
  // A past conversation, read-only: Back returns to the current one, Continue makes it current.
  if (reading) {
    return present(
      <div
        className={styles.agent}
        data-agent-conversation=""
        data-resizable={!!readingResize || undefined}
      >
        {discussionStatus?.(reading.id)}
        <div
          className={styles.agentLog}
          ref={log}
          onScroll={trackScroll}
          style={
            readingResize && readingHeight !== undefined
              ? { height: readingHeight, maxHeight: 'none' }
              : undefined
          }
        >
          {reading.cursor && (
            <button
              className={styles.agentEnd}
              disabled={loadingHistory}
              onClick={async () => {
                holdPosition()
                setLoadingHistory(true)
                try {
                  const page = await client.agentReadPage(reading.id, reading.cursor)
                  setError(page.error ?? null)
                  if (!page.error)
                    setReading((old) =>
                      old?.id === reading.id
                        ? { ...old, items: [...page.items, ...old.items], cursor: page.cursor }
                        : old,
                    )
                } finally {
                  setLoadingHistory(false)
                }
              }}
            >
              Load earlier messages
            </button>
          )}
          {error && <p className={styles.qError}>{error}</p>}
          <ConversationTimeline
            owner={reading.id}
            items={reading.items}
            historical
            lines={(items, itemKey) => (
              <Lines
                items={items}
                itemKey={itemKey}
                historical
                format={formatText && ((text) => formatText(text, reading.id))}
              />
            )}
          />
        </div>
        <div className={styles.agentInput}>
          {readerActions}
          <button className={styles.agentEnd} onClick={() => setReading(null)}>
            {en.agent.back}
          </button>
          <span className={styles.agentSpacer} />
          {readingResize && (
            <AgentReadingGrip log={log} upward={!readingResize.opensDown} resize={resizeReader} />
          )}
          <button
            className={`${styles.agentEnd} ${styles.agentContinue}`}
            onClick={() => void carryOn()}
            disabled={busy || agent.status === 'waiting'}
            title={en.agent.continueHint}
          >
            {en.agent.continue}
          </button>
        </div>
      </div>,
    )
  }

  const send = async () => {
    if (sending || busy) return
    setSending(true)
    try {
      const submission = client.historyCurrentId?.()
      const result = await client.agentSend(text)
      if (result.ok && (!client.historyCurrentId || client.historyCurrentId() === submission)) {
        const hadFocus = input.current
          ?.closest('[data-composer-input]')
          ?.contains(document.activeElement)
        setText('')
        setComposing(false)
        if (hadFocus) reply.current?.focus({ preventScroll: true })
      }
      setError(result.ok ? null : result.reason)
    } catch {
      setError('Could not send. Check the conversation before retrying.')
    } finally {
      setSending(false)
    }
  }

  const voiceButton = (shortcut || settings) && !voiceActive && (
    <button
      type="button"
      className={styles.startCall}
      aria-label="Start Agent voice"
      title={`Start Agent voice (${acceleratorLabel(shortcut ?? settings!.talkHotkey)})`}
      onClick={onVoiceToggle}
    >
      <CallIcon action="start" />
    </button>
  )
  const stopButton = busy && !voiceActive && !agent.live && (
    <button
      className={styles.agentEnd}
      aria-label={agent.status === 'stopping' ? 'Stopping…' : 'Stop'}
      title="Stop Agent work"
      disabled={agent.status === 'stopping'}
      onClick={async () => {
        const result = await client.agentInterrupt()
        setError(result.ok ? null : result.reason)
      }}
    >
      {readingResize ? (
        <CallIcon action="stop" />
      ) : agent.status === 'stopping' ? (
        'Stopping…'
      ) : (
        'Stop'
      )}
    </button>
  )
  const replyButton = (
    <button
      ref={reply}
      type="button"
      title={composing ? 'Hide reply box' : 'Write a reply'}
      aria-label="Reply to Agent"
      aria-expanded={composing}
      aria-controls={composing ? 'foreground-agent-composer' : undefined}
      onClick={() => {
        setComposing((open) => !open)
        if (composing) reply.current?.focus({ preventScroll: true })
      }}
    >
      <ConversationIcon action="compose" />
    </button>
  )
  return present(
    <div
      className={styles.agent}
      data-agent-conversation=""
      data-resizable={!!readingResize || undefined}
    >
      {discussionStatus?.()}
      {readingResize && callReplySlot && createPortal(replyButton, callReplySlot)}
      {readingResize && !callReplySlot && (
        <div className={styles.agentTop} role="group" aria-label="Agent conversation controls">
          {replyButton}
          {!callPreparing && voiceButton}
          {stopButton}
          {!voiceActive &&
            !agent.live &&
            !callPreparing &&
            !agent.ended &&
            agent.conversationId && (
              <>
                <button
                  disabled={
                    finishing || busy || sending || !!agent.approval || !!agent.requests.length
                  }
                  onClick={() => void finishChat('fresh')}
                  aria-label="Start fresh"
                  title="Start a new conversation and keep this one in Earlier"
                >
                  <ConversationIcon action="new" />
                </button>
                <button
                  className={styles.secondaryAction}
                  disabled={
                    finishing || busy || sending || !!agent.approval || !!agent.requests.length
                  }
                  onClick={() => void finishChat('archive')}
                  aria-label="Close conversation"
                  title="Close this conversation and keep it in Earlier"
                >
                  <ConversationIcon action="close" />
                </button>
              </>
            )}
        </div>
      )}
      {!settingsOpen && selectionNotice}
      <div
        className={styles.agentLog}
        ref={log}
        onScroll={trackScroll}
        style={
          readingResize && readingHeight !== undefined
            ? { height: readingHeight, maxHeight: 'none' }
            : undefined
        }
      >
        <ConversationTimeline
          owner={agent.conversationId}
          live={!!agent.live}
          target={
            agent.sessionId
              ? `${agent.provider === 'codex' ? 'codex:' : ''}${agent.sessionId}`
              : undefined
          }
          items={
            voiceActive && agent.live && inputPreview?.owner === agent.conversationId
              ? withLiveInputPreview(agent.items, inputPreview)
              : agent.items
          }
          lines={(items, itemKey) => (
            <Lines
              items={items}
              itemKey={itemKey}
              format={formatText}
              select={
                busy || sending
                  ? undefined
                  : (ref) => {
                      void client
                        .agentSend(`Read the selected chat using threadRef ${ref}.`)
                        .then((result) => setError(result.ok ? null : result.reason))
                    }
              }
            />
          )}
          tail={
            <>
              {!agent.requests.length && agent.approval && (
                <div className={styles.qCard} data-agent-approval="">
                  <div className={styles.qHead}>
                    <p className={`${styles.qText} ${styles.qHeadText}`}>
                      {en.agent.allow(agent.approval.title)}
                    </p>
                  </div>
                  <pre className={styles.agentDetail}>{agent.approval.detail}</pre>
                  <div className={styles.qButtons}>
                    <button
                      className={styles.qSkip}
                      onClick={() => client.agentDecide(agent.approval!.id, false)}
                    >
                      {en.agent.deny}
                    </button>
                    <button
                      className={styles.qNext}
                      onClick={() => client.agentDecide(agent.approval!.id, true)}
                    >
                      {en.agent.allowButton}
                    </button>
                  </div>
                </div>
              )}
              {!agent.conversationId && agent.requests[0] && (
                <AgentRequestCard
                  onRespond={client.agentRespond}
                  key={agent.requests[0].id}
                  request={agent.requests[0]}
                  count={agent.requests.length}
                />
              )}
              {agent.status === 'interrupted' && (
                <p className={styles.agentEmpty}>
                  Turn stopped. You can continue this conversation.
                </p>
              )}
              {(agent.error || error) && (
                <p className={styles.qError} role="alert">
                  {agent.error ?? error}
                </p>
              )}
              {agent.ended && <p className={styles.agentEmpty}>{en.agent.ended}</p>}
            </>
          }
        />
      </div>
      {agent.live && agent.pendingReadout && (
        <div className={threadStyles.currentWork}>
          <span>Opening playback unconfirmed.</span>
          <button
            type="button"
            onClick={() => {
              const pending = agent.pendingReadout!
              void window.threadlight
                .readLiveRemainder(pending.session, pending.token)
                .then((result) => setError(result.ok ? null : result.reason))
                .catch(() => setError('Could not request the remaining speech.'))
            }}
          >
            Read remaining
          </button>
        </div>
      )}
      {agent.chatActivity && !agent.chatActivity.working && (
        <div className={threadStyles.currentWork} role="status">
          {agent.chatActivity.message}
        </div>
      )}
      {(agent.status === 'working' ||
        agent.chatActivity?.working ||
        (agent.live && agent.pendingSpeechTurn && !agent.pendingReadout)) &&
        !agent.requests.length &&
        !agent.approval && (
          <div className={threadStyles.currentWork} role="status" aria-label="Current Agent work">
            <span className={threadStyles.workingMark}>
              <ElectricMotion
                label="Agent working"
                snapshot={{ ...IDLE_MOTION, mode: 'thinking' }}
              />
            </span>
            <span>
              {agent.chatActivity?.working
                ? agent.chatActivity.message
                : agent.status === 'working'
                  ? (agent.progress ?? en.agent.working)
                  : 'Waiting for voice playback…'}
            </span>
          </div>
        )}
      {(!readingResize || composing) && (
        <div
          className={styles.agentInput}
          id={readingResize ? 'foreground-agent-composer' : undefined}
        >
          <ComposerInput
            inputRef={input}
            input={{
              'aria-label': 'Message to Agent',
              value: text,
              placeholder: !agent.items.length ? en.agent.placeholder : 'Message…',
              disabled: sending || finishing,
              onChange: (e) => setText(e.target.value),
              onKeyDown: (e) => {
                if (!readingResize || e.key !== 'Escape') return
                e.stopPropagation()
                if (!text) {
                  setComposing(false)
                  reply.current?.focus({ preventScroll: true })
                }
              },
            }}
            sendDisabled={busy || sending}
            onSend={() => void send()}
          />
          {!readingResize && (
            <>
              {readerActions}
              {voiceButton}
              {stopButton}
              {!voiceActive &&
                !agent.live &&
                (agent.status !== 'idle' || agent.items.length > 0) && (
                  <button
                    className={styles.agentEnd}
                    disabled={busy || !!agent.requests.length}
                    onClick={() => client.agentClose()}
                    title={en.agent.endHint}
                  >
                    {en.agent.end}
                  </button>
                )}
            </>
          )}
        </div>
      )}
      {readingResize && ((pending && !reading) || unread) && (
        <div className={styles.readerUpdates}>{readerActions}</div>
      )}
      {onCloseSettings ? (
        readingResize && (
          <AgentReadingGrip log={log} upward={!readingResize.opensDown} resize={resizeReader} />
        )
      ) : (
        <Earlier
          client={client}
          current={agent.ended ? null : (client.historyCurrentId?.() ?? agent.conversationId)}
          onOpen={(id) => void read(id)}
          identity={identity}
        />
      )}
    </div>,
  )
}
