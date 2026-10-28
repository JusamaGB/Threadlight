import { useId, useRef, useState } from 'react'
import type { CodexQuestionRef } from '../../shared/codexQuestions'
import type { CardQuestion, Session } from '../../shared/types'
import { useDraft } from '../lib/drafts'
import styles from './CodexQuestionCard.module.css'

interface Answer {
  picked: string[]
  text: string
}

/** Current desktop async cards are answered through Codex's owning window. */
export function CodexQuestionCard({
  session,
  questions,
  native,
  onCollapse,
}: {
  session: Session
  questions: CardQuestion[]
  native?: CodexQuestionRef
  onCollapse: () => void
}) {
  const id = useId()
  const key = `${session.id}:questions:${JSON.stringify(native)}:${JSON.stringify(questions)}`
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [sent, setSent] = useState(false)
  const [index, setIndex] = useDraft(`${key}:page`, 0)
  const [answers, setAnswers] = useDraft<Answer[]>(
    `${key}:answers`,
    questions.map((question) => ({
      picked: question.multiSelect
        ? []
        : [
            question.options.find((option) => option.recommended)?.label ??
              question.options[0]?.label,
          ].filter((label): label is string => !!label),
      text: '',
    })),
  )
  const question = questions[index]
  const answer = answers[index]
  if (!question || !answer) return null
  const update = (next: Answer) =>
    setAnswers((previous) => previous.map((value, i) => (i === index ? next : value)))
  const pick = (label: string) => {
    const picked =
      question.multiSelect && !answer.text.trim()
        ? answer.picked.includes(label)
          ? answer.picked.filter((value) => value !== label)
          : [...answer.picked, label]
        : [label]
    update({ text: '', picked })
  }
  const values = answers.map((value) => value.text.trim() || value.picked.join(', '))
  const ready = values.every(Boolean)
  const open = () => session.appId && window.threadlight.openInClaude(session.appId)
  const copyAndOpen = () => {
    if (!ready || !session.appId) return
    window.threadlight.copyText(
      questions.length === 1
        ? values[0]!
        : questions.map((item, i) => `${item.question}\n${values[i]}`).join('\n\n'),
    )
    open()
  }
  const submit = async () => {
    if (!native) return copyAndOpen()
    if (!ready || sending.current || blocked || sent) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await window.threadlight.answerNativeCodexQuestion(session.id, native, values)
      if (result.ok) {
        setSent(true)
        onCollapse()
      } else {
        setError(result.reason)
        setBlocked(!result.retryable)
      }
    } catch {
      setError('Confirmation was lost. Check Codex before sending again.')
      setBlocked(true)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <section className={styles.card} aria-label="Codex question">
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          ?
        </span>
        <span>Question</span>
        {questions.length > 1 && (
          <nav className={styles.pager} aria-label="Questions">
            <button
              aria-label="Previous question"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ‹
            </button>
            <span>
              {index + 1} / {questions.length}
            </span>
            <button
              aria-label="Next question"
              disabled={index === questions.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              ›
            </button>
          </nav>
        )}
        <button className={styles.close} aria-label="Collapse question" onClick={onCollapse}>
          ×
        </button>
      </div>
      <p className={styles.prompt} id={`${id}-prompt`}>
        {question.question}
      </p>
      <div className={styles.options} role="group" aria-labelledby={`${id}-prompt`}>
        {question.options.map((option, i) => {
          const selected = !answer.text.trim() && answer.picked.includes(option.label)
          return (
            <label className={styles.option} data-selected={selected} key={option.label}>
              <input
                type={question.multiSelect ? 'checkbox' : 'radio'}
                name={`${id}-${index}`}
                checked={selected}
                disabled={busy || sent || blocked}
                onChange={() => pick(option.label)}
              />
              <span className={styles.number} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.body}>
                <span className={styles.label}>{option.label}</span>
                {option.description && (
                  <span className={styles.description}>{option.description}</span>
                )}
              </span>
              <span className={styles.arrow} aria-hidden="true">
                {selected ? '✓' : ''}
              </span>
            </label>
          )
        })}
      </div>
      <div className={styles.response}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" />
        </svg>
        <textarea
          aria-label="Answer for this Codex question"
          placeholder="Or write your own response"
          rows={1}
          value={answer.text}
          disabled={busy || sent || blocked}
          onChange={(event) => update({ ...answer, text: event.target.value })}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.note} role={error ? 'alert' : 'status'}>
          {error ||
            (native ? (sent ? 'Answer sent' : 'Sends to Codex') : 'Finish answering in Codex')}
        </span>
        {(!native || error) && (
          <button
            className={styles.open}
            disabled={!session.appId}
            onClick={open}
            title="Open without copying an answer"
          >
            Open ↗
          </button>
        )}
        <button
          className={styles.submit}
          disabled={!ready || !session.appId || busy || sent || blocked}
          onClick={() => void submit()}
        >
          {native ? (busy ? 'Sending…' : sent ? 'Sent' : 'Send answer') : 'Copy & open'}
        </button>
      </div>
    </section>
  )
}
