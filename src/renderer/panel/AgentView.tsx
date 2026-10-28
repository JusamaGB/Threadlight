import { ConversationTimeline } from '../communication/ConversationTimeline'
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import type { NavigationHandle } from '../../shared/navigationHistory'

import { agentBusy, type AgentConversation, type AgentItem } from '../../shared/agent'
import { AgentRequestCard } from './AgentRequestCard'
import { useAgent } from '../hooks/useAgent'
import { useSettings } from '../hooks/useSettings'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { AgentIdentity } from './AgentIdentity'
import { ageText } from '../lib/format'
import { acceleratorLabel } from '../../shared/accelerator'
import styles from './Panel.module.css'

/** A past conversation open to read. */
interface Reading {
  id: string
  items: AgentItem[]
  cursor: string | null
}

/** The lines of a conversation: what you asked, what it said, and its steps. */
function Lines({
  items,
  select,
  historical = false,
}: {
  items: AgentItem[]
  select?: (ref: string) => void
  historical?: boolean
}) {
  return (
    <>
      {items.map((item, index) =>
        item.source ? (
          <details key={item.id ?? index} className={styles.agentItem}>
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
          <p key={index} className={styles.agentItem} data-kind={item.kind}>
            {item.text}
          </p>
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
}: {
  current: string | null
  onOpen: (id: string) => void
  identity: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [past, setPast] = useState<AgentConversation[] | null>(null)
  const now = useNow()
  useEffect(() => {
    let live = true
    void window.threadlight.agentHistory().then((found) => live && setPast(found))
    return () => {
      live = false
    }
  }, [open, current])
  const shown = (past ?? []).filter((conversation) => conversation.id !== current)
  const hasHistory = !past || shown.length > 0
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
        <div className={styles.agentIdentity} role="group" aria-label="Agent settings">
          {identity}
        </div>
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
  visible = true,
}: { navigationRef?: Ref<NavigationHandle>; visible?: boolean } = {}) {
  const agent = useAgent()
  const settings = useSettings()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  const read = async (id: string) => {
    try {
      const page = await window.threadlight.agentReadPage(id)
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
    'agent-reading',
  )
  useImperativeHandle(navigationRef, () => location, [location])
  const log = useRef<HTMLDivElement>(null)
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

  const following = useRef(true)
  const [unread, setUnread] = useState(false)
  const trackScroll = () => {
    if (!visible) return
    const element = log.current
    if (!element) return
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    if (following.current) setUnread(false)
  }
  const showUpdates = () => {
    following.current = true
    setUnread(false)
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }
  useEffect(() => {
    const element = log.current
    if (!element || !visible) return
    const observer = new MutationObserver(() => {
      if (following.current) element.scrollTo({ top: element.scrollHeight })
      else setUnread(true)
    })
    observer.observe(element, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [reading?.id, visible])

  const carryOn = async () => {
    if (!reading) return
    const result = await window.threadlight.agentResume(reading.id)
    if (result.ok) setReading(null)
    setError(result.ok ? null : result.reason)
  }

  // A past conversation, read-only: Back returns to the current one, Continue makes it current.
  if (reading) {
    return (
      <div className={styles.agent}>
        {unread && (
          <button className={styles.agentEnd} onClick={showUpdates}>
            New updates
          </button>
        )}
        <div className={styles.agentLog} ref={log} onScroll={trackScroll}>
          <ConversationTimeline
            owner={reading.id}
            items={reading.items}
            historical
            lines={(items) => <Lines items={items} historical />}
          />
          {reading.cursor && (
            <button
              className={styles.agentEnd}
              disabled={loadingHistory}
              onClick={async () => {
                setLoadingHistory(true)
                try {
                  const page = await window.threadlight.agentReadPage(reading.id, reading.cursor)
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
        </div>
        <div className={styles.agentInput}>
          <button className={styles.agentEnd} onClick={() => setReading(null)}>
            {en.agent.back}
          </button>
          <span className={styles.agentSpacer} />
          <button
            className={`${styles.agentEnd} ${styles.agentContinue}`}
            onClick={() => void carryOn()}
            disabled={busy || agent.status === 'waiting'}
            title={en.agent.continueHint}
          >
            {en.agent.continue}
          </button>
        </div>
      </div>
    )
  }

  const send = async () => {
    if (sending || busy) return
    setSending(true)
    try {
      const result = await window.threadlight.agentSend(text)
      if (result.ok) setText('')
      setError(result.ok ? null : result.reason)
    } catch {
      setError('Could not send. Check the conversation before retrying.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.agent}>
      {selectionChanged && (
        <div className={styles.agentSelection} role="status">
          <p>
            This conversation keeps its original model. Your next conversation will use{' '}
            {selectedProvider === 'codex' ? 'Codex' : 'Claude'} ·{' '}
            {selectedModel ?? 'Runtime default'}
            {selectedReasoning ? ` · ${selectedReasoning}` : ''}.
          </p>
          <button
            className={styles.agentEnd}
            disabled={busy || sending}
            onClick={() => window.threadlight.agentClose()}
          >
            Use selected model
          </button>
          <span>
            {busy
              ? 'Stop or finish this turn first.'
              : 'Ends this conversation; its history stays in Earlier.'}
          </span>
        </div>
      )}
      {unread && (
        <button className={styles.agentEnd} onClick={showUpdates}>
          New updates
        </button>
      )}
      <div className={styles.agentLog} ref={log} onScroll={trackScroll}>
        <ConversationTimeline
          owner={agent.conversationId}
          live={!!agent.live}
          items={agent.items}
          lines={(items) => (
            <Lines
              items={items}
              select={
                busy || sending
                  ? undefined
                  : (ref) => {
                      void window.threadlight
                        .agentSend(`Read the selected chat using threadRef ${ref}.`)
                        .then((result) => setError(result.ok ? null : result.reason))
                    }
              }
            />
          )}
        />
        {agentBusy(agent) && (
          <p className={styles.agentProgress}>
            <span className={styles.spinner} />
            {agent.progress ?? en.agent.working}
          </p>
        )}
        {!agent.requests.length && agent.approval && (
          <div className={styles.qCard}>
            <div className={styles.qHead}>
              <p className={`${styles.qText} ${styles.qHeadText}`}>
                {en.agent.allow(agent.approval.title)}
              </p>
            </div>
            <pre className={styles.agentDetail}>{agent.approval.detail}</pre>
            <div className={styles.qButtons}>
              <button
                className={styles.qSkip}
                onClick={() => window.threadlight.agentDecide(agent.approval!.id, false)}
              >
                {en.agent.deny}
              </button>
              <button
                className={styles.qNext}
                onClick={() => window.threadlight.agentDecide(agent.approval!.id, true)}
              >
                {en.agent.allowButton}
              </button>
            </div>
          </div>
        )}
        {!agent.conversationId && agent.requests[0] && (
          <AgentRequestCard
            key={agent.requests[0].id}
            request={agent.requests[0]}
            count={agent.requests.length}
          />
        )}
        {agent.status === 'interrupted' && (
          <p className={styles.agentEmpty}>Turn stopped. You can continue this conversation.</p>
        )}
        {(agent.error || error) && (
          <p className={styles.qError} role="alert">
            {agent.error ?? error}
          </p>
        )}
        {agent.ended && <p className={styles.agentEmpty}>{en.agent.ended}</p>}
      </div>
      <div className={styles.agentInput}>
        <input
          className={styles.qOther}
          value={text}
          placeholder={
            agent.status === 'idle' && agent.items.length === 0
              ? en.agent.placeholder
              : en.agent.followUp
          }
          disabled={busy || sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send()
          }}
        />
        {settings && (
          <kbd className={styles.agentHotkey} title="Microphone shortcut">
            {acceleratorLabel(settings.talkHotkey)}
          </kbd>
        )}
        {busy && (
          <button
            className={styles.agentEnd}
            disabled={agent.status === 'stopping'}
            onClick={async () => {
              const result = await window.threadlight.agentInterrupt()
              setError(result.ok ? null : result.reason)
            }}
          >
            {agent.status === 'stopping' ? 'Stopping…' : 'Stop'}
          </button>
        )}
        {(agent.status !== 'idle' || agent.items.length > 0) && (
          <button
            className={styles.agentEnd}
            onClick={() => window.threadlight.agentClose()}
            title={en.agent.endHint}
          >
            {en.agent.end}
          </button>
        )}
      </div>
      <Earlier
        current={agent.ended ? null : agent.conversationId}
        onOpen={(id) => void read(id)}
        identity={
          <AgentIdentity
            provider={provider}
            model={model}
            reasoning={reasoning}
            hasConversation={hasConversation}
            settings={settings}
            onError={setError}
          />
        }
      />
    </div>
  )
}
