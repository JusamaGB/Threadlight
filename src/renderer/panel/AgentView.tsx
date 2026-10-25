import { useEffect, useRef, useState } from 'react'

import { useAgent } from '../hooks/useAgent'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

/**
 * The agent: one conversation Threadlight hosts itself. It shows what you asked, what it said
 * and each step it took, live; a call that changes something waits on an Allow / Deny card; and
 * anything typed once it is done continues the same conversation.
 */
export function AgentView() {
  const agent = useAgent()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const busy = agent.status === 'starting' || agent.status === 'working'

  // Keep the newest line in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [agent.items.length, agent.approval, agent.progress])

  const send = async () => {
    const result = await window.threadlight.agentSend(text)
    if (result.ok) setText('')
    setError(result.ok ? null : result.reason)
  }

  return (
    <div className={styles.agent}>
      <div className={styles.agentLog} ref={log}>
        {agent.items.length === 0 && <p className={styles.agentEmpty}>{en.agent.empty}</p>}
        {agent.items.map((item, index) => (
          <p key={index} className={styles.agentItem} data-kind={item.kind}>
            {item.text}
          </p>
        ))}
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
      </div>
      <div className={styles.agentInput}>
        <input
          className={styles.qOther}
          value={text}
          placeholder={agent.status === 'idle' ? en.agent.placeholder : en.agent.followUp}
          disabled={busy || agent.status === 'waiting'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send()
          }}
        />
        {agent.status !== 'idle' && (
          <button
            className={styles.agentEnd}
            onClick={() => window.threadlight.agentClose()}
            title={en.agent.endHint}
          >
            {en.agent.end}
          </button>
        )}
      </div>
      {agent.costUsd > 0 && <p className={styles.qNote}>{en.agent.cost(agent.costUsd)}</p>}
    </div>
  )
}
