import { useEffect, useRef, useState } from 'react'

import { agentBusy, type AgentConversation, type AgentItem } from '../../shared/agent'
import { AgentRequestCard } from './AgentRequestCard'
import { useAgent } from '../hooks/useAgent'
import { useSettings } from '../hooks/useSettings'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { ageText } from '../lib/format'
import styles from './Panel.module.css'

/** A past conversation open to read. */
interface Reading {
  id: string
  items: AgentItem[]
  cursor: string | null
}

/** The lines of a conversation: what you asked, what it said, and its steps. */
function Lines({ items }: { items: AgentItem[] }) {
  return (
    <>
      {items.map((item, index) => (
        <p key={index} className={styles.agentItem} data-kind={item.kind}>
          {item.text}
        </p>
      ))}
    </>
  )
}

/**
 * Past conversations under a collapsed "Earlier" row, newest first; the current one is left
 * out. Listed again each time it is opened, so a conversation just ended shows up.
 */
function Earlier({ current, onOpen }: { current: string | null; onOpen: (id: string) => void }) {
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
  if (past && shown.length === 0) return null
  return (
    <div className={styles.agentEarlier}>
      <button
        className={styles.agentEarlierHead}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.agentChevron} data-open={open || undefined}>
          ›
        </span>
        {en.agent.earlier(shown.length)}
      </button>
      {open && (
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
export function AgentView() {
  const agent = useAgent()
  const settings = useSettings()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
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

  // Keep the newest line in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [agent.revision, reading])

  const read = async (id: string) => {
    const page = await window.threadlight.agentReadPage(id)
    setError(page.error ?? null)
    setReading({ id, items: page.items, cursor: page.cursor })
  }

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
        <div className={styles.agentLog} ref={log}>
          <Lines items={reading.items} />
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
      <p className={styles.agentIdentity}>
        {provider === 'codex' ? 'Codex' : 'Claude'} ·{' '}
        {model ?? (hasConversation ? 'Model not recorded' : 'Runtime default')}
        {reasoning ? ` · ${reasoning}` : ''}
      </p>
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
      <div className={styles.agentLog} ref={log}>
        {agent.items.length === 0 && <p className={styles.agentEmpty}>{en.agent.empty}</p>}
        <Lines items={agent.items} />
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
        {agent.requests[0] && (
          <AgentRequestCard
            key={agent.requests[0].id}
            request={agent.requests[0]}
            count={agent.requests.length}
          />
        )}
        {agent.status === 'interrupted' && (
          <p className={styles.agentEmpty}>Turn stopped. You can continue this conversation.</p>
        )}
        {(agent.error || error) && <p className={styles.qError}>{agent.error ?? error}</p>}
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
      <Earlier current={agent.ended ? null : agent.conversationId} onOpen={(id) => void read(id)} />
    </div>
  )
}
