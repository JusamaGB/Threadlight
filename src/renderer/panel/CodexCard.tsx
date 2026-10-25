import { useState } from 'react'
import type { Attention, Session } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { useDraft } from '../lib/drafts'
import styles from './Panel.module.css'

export function CodexCard({ session, attention }: { session: Session; attention: Attention }) {
  const now = useNow(1000)
  // Codex raises no session offers; one would only ever be opened in its app.
  const holdId = 'holdId' in attention ? attention.holdId : undefined
  const until = attention.kind === 'question' ? null : attention.answerableUntil
  const held = !!holdId && !!until && until > now
  // The hold nonce expires on a provider switch; the user's draft must not.
  const identity =
    attention.kind === 'next-step'
      ? attention.ask
      : attention.kind === 'question'
        ? JSON.stringify(attention.questions)
        : attention.kind === 'offer'
          ? attention.title
          : attention.action
  const [text, setText] = useDraft(`${session.id}:${attention.kind}:${identity}:answer`, '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const open = () => session.appId && window.threadlight.openInClaude(session.appId)
  const send = async (value: string) => {
    if (!held || !holdId || sending || done) return
    setSending(true)
    const result = await window.threadlight.answerCodex(session.id, holdId, value)
    setSending(false)
    if (result.ok) {
      setDone(true)
      setText('')
    } else setError(result.reason)
  }
  const question =
    attention.kind === 'next-step'
      ? attention.ask
      : attention.kind === 'question'
        ? attention.questions.map((q) => q.question).join('\n')
        : 'Allow this action?'
  return (
    <div className={styles.qCard}>
      <div className={styles.qHead}>
        <p className={styles.qText}>{question}</p>
      </div>
      {attention.kind === 'approval' && attention.action && (
        <p className={styles.qRecap}>{attention.action}</p>
      )}
      {attention.kind === 'question' &&
        attention.questions.map((question, index) => (
          <div key={index}>
            {question.options.map((option) => (
              <p className={styles.qRecap} key={option.label}>
                {option.label}
                {option.description ? ` — ${option.description}` : ''}
              </p>
            ))}
          </div>
        ))}
      {attention.kind !== 'approval' && (
        <textarea
          className={styles.qOther}
          aria-label="Answer for this Codex chat"
          value={text}
          disabled={sending || done}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className={styles.qButtons}>
        {held && !done && attention.kind === 'approval' ? (
          <>
            <button className={styles.qNext} disabled={sending} onClick={() => void send('allow')}>
              Allow once
            </button>
            <button className={styles.qSkip} disabled={sending} onClick={() => void send('deny')}>
              Deny
            </button>
          </>
        ) : held && !done ? (
          <button
            className={styles.qNext}
            disabled={sending || !text.trim()}
            onClick={() => void send(text)}
          >
            Send answer
          </button>
        ) : null}
        <button
          className={styles.qSkip}
          onClick={() => {
            if (text.trim()) window.threadlight.copyText(text)
            open()
          }}
        >
          {text.trim() ? 'Copy and open Codex' : 'Open in Codex'}
        </button>
        {held && !done && (
          <p className={styles.qNote}>
            Held here for {Math.max(0, Math.ceil((until! - now) / 1000))}s. Opening Codex lets it
            continue there.
          </p>
        )}
        {done && <p className={styles.qNote}>Answer sent</p>}
        {error && <p className={styles.qError}>{error}</p>}
      </div>
    </div>
  )
}
