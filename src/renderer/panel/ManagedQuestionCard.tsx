import { useRef, useState } from 'react'
import type { Attention } from '../../shared/types'
import { useDraft } from '../lib/drafts'
import styles from './CodexQuestionCard.module.css'

export function ManagedQuestionCard({
  attention,
  onCollapse,
}: {
  attention: Extract<Attention, { kind: 'question' }>
  onCollapse: () => void
}) {
  const request = attention.managed!
  const question = attention.questions[0]!
  const key = `managed:${request.id}:${request.generation}`
  const [answer, setAnswer] = useDraft(`${key}:answer`, '')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const operation = useRef<{ payload: string; id: string } | null>(null)
  const [expired, setExpired] = useState(false)
  async function send(cancel = false) {
    if (inFlight.current || done) return
    if (!attention.answerableUntil || Date.now() >= attention.answerableUntil) {
      setExpired(true)
      return
    }
    const value = answer.trim()
    if (!cancel && !value) return
    const payload = JSON.stringify({ cancel, value: cancel ? '' : value })
    if (operation.current?.payload !== payload)
      operation.current = { payload, id: crypto.randomUUID() }
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const result = await window.threadlight.communicationRequest({
        action: cancel ? 'cancel_question' : 'answer_request',
        arguments: {
          id: request.id,
          generation: request.generation,
          operationId: operation.current.id,
          ...(!cancel ? { answer: value } : {}),
        },
      })
      if (result.ok) setDone(true)
      else setError(result.reason)
    } catch {
      setError('Could not confirm the answer. Retry to check the same submission.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <section className={styles.card} aria-label="Threadlight question">
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          ?
        </span>
        <span>Question</span>
        <button className={styles.close} aria-label="Collapse question" onClick={onCollapse}>
          ×
        </button>
      </div>
      <p className={styles.prompt}>{question.question}</p>
      <div className={styles.options} role="group" aria-label="Answer choices">
        {question.options.map((option, i) => (
          <label
            className={styles.option}
            data-selected={answer === option.label}
            key={option.label}
          >
            <input
              type="radio"
              name={key}
              checked={answer === option.label}
              disabled={busy || done || expired}
              onChange={() => setAnswer(option.label)}
            />
            <span className={styles.number} aria-hidden="true">
              {i + 1}
            </span>
            <span className={styles.body}>
              <span className={styles.label}>{option.label}</span>
            </span>
            <span className={styles.arrow} aria-hidden="true">
              {answer === option.label ? '→' : ''}
            </span>
          </label>
        ))}
      </div>
      {(request.allowOther || !question.options.length) && (
        <div className={styles.response}>
          <textarea
            aria-label="Your answer"
            placeholder="Or write your own response"
            maxLength={16000}
            rows={1}
            value={answer}
            disabled={busy || done || expired}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key === 'Enter') {
                event.preventDefault()
                void send()
              }
            }}
          />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={styles.footer}>
        <span className={styles.note}>
          {expired ? 'This question expired' : done ? 'Saved' : 'Answer here'}
        </span>
        <button
          className={styles.open}
          disabled={busy || done || expired}
          onClick={() => void send(true)}
        >
          Dismiss
        </button>
        <button
          className={styles.submit}
          disabled={busy || done || expired || !answer.trim()}
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : 'Send answer'}
        </button>
      </div>
    </section>
  )
}
