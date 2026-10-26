import { useState } from 'react'
import type { AgentRequest, AgentResponse, AgentResult } from '../../shared/agent'
import styles from './Panel.module.css'

export function AgentRequestCard({
  request,
  count,
  onRespond,
}: {
  request: AgentRequest
  count: number
  onRespond?: (id: string, response: AgentResponse) => Promise<AgentResult>
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const respond = async (response: AgentResponse) => {
    if (sending) return
    setSending(true)
    try {
      const result = await (onRespond ?? window.threadlight.agentRespond)(request.id, response)
      if (!result.ok) setError(result.reason)
    } catch {
      setError('Could not submit this response. Check the current request before retrying.')
    } finally {
      setSending(false)
    }
  }
  const form = request.questions !== undefined
  return (
    <div className={styles.qCard}>
      <p className={styles.qText}>
        {request.title}
        {count > 1 ? ` · ${count} pending` : ''}
      </p>
      {request.detail && <pre className={styles.agentDetail}>{request.detail}</pre>}
      {request.questions?.map((q) => (
        <fieldset key={q.id} className={styles.agentQuestion}>
          <legend>{q.text}</legend>
          {q.options.map((option) => (
            <label key={option} className={styles.agentOption}>
              <input
                type="radio"
                name={`${request.id}:${q.id}`}
                checked={answers[q.id] === option}
                onChange={() => setAnswers((a) => ({ ...a, [q.id]: option }))}
              />
              {option}
            </label>
          ))}
          {q.other && (
            <input
              type={q.secret ? 'password' : 'text'}
              className={styles.qOther}
              aria-label={q.text}
              placeholder="Your answer…"
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          )}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className={styles.qError}>
          {error}
        </p>
      )}
      <div className={styles.qButtons}>
        {request.kind !== 'questions' && (
          <button
            className={styles.qSkip}
            disabled={sending}
            onClick={() => void respond({ action: 'deny' })}
          >
            Deny
          </button>
        )}
        {request.canAllow && (
          <button
            className={styles.qNext}
            disabled={sending}
            onClick={() => void respond(form ? { action: 'answer', answers } : { action: 'allow' })}
          >
            {sending
              ? 'Submitting…'
              : form
                ? 'Submit'
                : request.kind === 'permissions'
                  ? 'Allow for this turn'
                  : 'Allow once'}
          </button>
        )}
      </div>
    </div>
  )
}
