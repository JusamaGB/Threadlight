import { useEffect, useRef, useState } from 'react'

import type { AgentConversation, AgentItem } from '../../shared/agent'
import { useAgent } from '../hooks/useAgent'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { ageText } from '../lib/format'
import styles from './Panel.module.css'

/** A past conversation open to read. */
interface Reading {
  id: string
  items: AgentItem[]
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
              <span className={styles.agentPastTitle}>{conversation.title}</span>
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
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const busy = agent.status === 'starting' || agent.status === 'working'

  // Keep the newest line in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [agent.items.length, agent.approval, agent.progress, reading])

  const read = async (id: string) => {
    setReading({ id, items: await window.threadlight.agentReadPast(id) })
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
    const result = await window.threadlight.agentSend(text)
    if (result.ok) setText('')
    setError(result.ok ? null : result.reason)
  }

  return (
    <div className={styles.agent}>
      <div className={styles.agentLog} ref={log}>
        {agent.items.length === 0 && <p className={styles.agentEmpty}>{en.agent.empty}</p>}
        <Lines items={agent.items} />
        {busy && (
          <p className={styles.agentProgress}>
            <span className={styles.spinner} />
            {agent.progress ?? en.agent.working}
          </p>
        )}
        {agent.approval && (
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
          disabled={busy || agent.status === 'waiting'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send()
          }}
        />
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
      <Earlier current={agent.sessionId} onOpen={(id) => void read(id)} />
    </div>
  )
}
