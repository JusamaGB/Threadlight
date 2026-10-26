import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CommunicationSnapshot,
  Destination,
  Workflow,
  Participant,
  NativeCommunicationRequest,
  NativeCommunicationResponse,
  CommunicationMessage,
} from '../../shared/communication'
import type { Session } from '../../shared/types'
import styles from './CommunicationView.module.css'

export function CommunicationView({
  spaceId,
  sessions = [],
  owner,
  compact = false,
}: {
  spaceId?: string
  sessions?: Session[]
  owner?: string | null
  compact?: boolean
}) {
  const [data, setData] = useState<CommunicationSnapshot | null>(null)
  const [older, setOlder] = useState<CommunicationMessage[]>([])
  const [before, setBefore] = useState<number>()
  const [historyStarted, setHistoryStarted] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState('')
  const [replyTo, setReplyTo] = useState<string>()
  const [busy, setBusy] = useState(false)
  const operation = useRef(crypto.randomUUID())
  const [destinations, setDestinations] = useState<Destination[]>([])
  const refresh = useCallback(async () => {
    if (!window.threadlight.communicationRequest) return
    const result = await window.threadlight.communicationRequest(
      spaceId ? { action: 'get_workflow', arguments: { spaceId } } : { action: 'snapshot' },
    )
    if (result.ok) setData(result.value as CommunicationSnapshot)
    else setError(result.reason)
  }, [spaceId])
  useEffect(() => {
    void Promise.resolve().then(refresh)
    return window.threadlight.onCommunication?.(() => {
      void refresh()
    })
  }, [refresh])
  async function call(action: string, args: unknown, expectedRevision?: number) {
    setBusy(true)
    setError('')
    try {
      const result = await window.threadlight.communicationRequest({
        action,
        arguments: args,
        expectedRevision,
      })
      if (!result.ok) {
        setError(result.reason)
        return false
      }
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Communication unavailable.')
      return false
    } finally {
      setBusy(false)
    }
  }
  const workflow = data?.workflows.find((w) => w.spaceId === spaceId)
  const messages =
    [...older, ...(data?.messages ?? [])].filter((m) =>
      spaceId
        ? m.spaceId === spaceId
        : !owner
          ? !m.spaceId
          : m.sender === owner ||
            m.deliveries.some((d) => d.target === owner) ||
            (!!m.replyTo &&
              data?.messages.some((source) => source.id === m.replyTo && source.sender === owner)),
    ) ?? []
  const questions =
    data?.questions.filter(
      (q) => (!spaceId ? q.audience === 'human' : q.spaceId === spaceId) && q.state === 'pending',
    ) ?? []
  if (compact && !messages.length && !questions.length && !data?.nativeRequests?.length) return null
  return (
    <section className={styles.root} aria-label="Thread communication">
      <details open={!compact}>
        <summary>
          {spaceId ? 'Project communication and workflow' : 'Background messages'}
          {messages.length ? ` · ${messages.length}` : ''}
        </summary>
        {spaceId && (
          <p>
            Project DMs and replies are saved here for human review and are visible to authorized
            project members. Notes do not wake chats.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {spaceId && (
          <WorkflowEditor
            key={workflow?.revision ?? 0}
            workflow={workflow}
            spaceId={spaceId}
            sessions={sessions}
            busy={busy}
            save={(w, revision) => call('configure', w, revision)}
          />
        )}
        {!compact && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (
                await call('send_message', {
                  operationId: operation.current,
                  targets: [target],
                  replyTo,
                  body: draft,
                  spaceId,
                  kind: 'request',
                })
              ) {
                setDraft('')
                setReplyTo(undefined)
                operation.current = crypto.randomUUID()
              }
            }}
          >
            <label>
              Recipient
              <select
                aria-label="DM recipient"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value)
                  operation.current = crypto.randomUUID()
                }}
              >
                <option value="">Choose a chat</option>
                {(workflow?.participants ?? []).map((p) => (
                  <option key={p.id} value={p.target}>
                    {p.role} · {sessions.find((s) => s.id === p.target)?.title ?? p.target}
                  </option>
                ))}
                {!workflow &&
                  destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.provider} · {d.title}
                    </option>
                  ))}
              </select>
            </label>
            {!workflow && (
              <button
                type="button"
                onClick={async () => {
                  const r = await window.threadlight.communicationRequest({
                    action: 'get_destination',
                    arguments: { query: '' },
                  })
                  if (r.ok) setDestinations(r.value as Destination[])
                  else setError(r.reason)
                }}
              >
                Find chats
              </button>
            )}
            <label>
              Message
              <textarea
                value={draft}
                maxLength={16000}
                onChange={(e) => {
                  setDraft(e.target.value)
                  operation.current = crypto.randomUUID()
                }}
              />
            </label>
            <button disabled={busy || !target || !draft.trim()}>Send to chat</button>
          </form>
        )}
        {data?.nativeRequests?.map((request) => (
          <NativeRequest
            key={request.id}
            request={request}
            busy={busy}
            focus={() => call('focus_request', request.id)}
            answer={(response) =>
              call('respond_native_request', {
                operationId: crypto.randomUUID(),
                id: request.id,
                generation: request.generation,
                response,
              })
            }
          />
        ))}
        {questions.map((q) => (
          <Question
            key={q.id}
            title={`${q.body}${q.reason ? ` — ${q.reason}` : ''}`}
            choices={q.choices}
            busy={busy}
            answer={(answer) =>
              call('answer_request', {
                id: q.id,
                generation: q.generation,
                operationId: crypto.randomUUID(),
                answer,
              })
            }
          />
        ))}
        {data?.assignments
          .filter((a) => a.spaceId === spaceId)
          .map((a) => (
            <article key={a.id}>
              <strong>{a.title}</strong>
              <p>
                {a.state} · {a.reason}
              </p>
              {a.result && <p className={styles.body}>{a.result}</p>}
              {['planned', 'blocked'].includes(a.state) && !a.messageId && (
                <button disabled={busy} onClick={() => void call('authorize_assignment', a.id)}>
                  Authorize assignment
                </button>
              )}
              {a.state === 'submitted' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void call('accept_assignment', {
                      id: a.id,
                      operationId: crypto.randomUUID(),
                      reason: 'Accepted by the user after reviewing the result.',
                    })
                  }
                >
                  Accept result
                </button>
              )}
            </article>
          ))}
        {(historyStarted ? before : data?.historyBefore) && (
          <button
            disabled={busy}
            onClick={async () => {
              const result = await window.threadlight.communicationRequest({
                action: 'read_messages',
                arguments: { spaceId, before: historyStarted ? before : data?.historyBefore },
              })
              if (!result.ok) return setError(result.reason)
              const page = result.value as { messages: CommunicationMessage[]; nextBefore?: number }
              setOlder((previous) =>
                [...page.messages.slice().reverse(), ...previous].filter(
                  (m, i, rows) => rows.findIndex((x) => x.id === m.id) === i,
                ),
              )
              setBefore(page.nextBefore)
              setHistoryStarted(true)
            }}
          >
            Load older messages
          </button>
        )}
        <ol className={styles.timeline} aria-label="Saved direct messages">
          {messages.map((m) => (
            <li key={m.id}>
              <small>
                {new Date(m.at).toLocaleString()} · {m.kind}
              </small>
              <p>
                <strong>
                  {sessions.find((s) => s.id === m.senderTarget)?.title ??
                    m.senderTarget ??
                    m.sender}
                </strong>{' '}
                →{' '}
                {m.deliveries
                  .map((d) => sessions.find((s) => s.id === d.target)?.title ?? d.target)
                  .join(', ')}
              </p>
              <p className={styles.body}>{m.body}</p>
              {m.deliveries.map((d) => (
                <p key={d.attemptId}>
                  {d.phase === 'inbox' ? 'Saved in inbox · native wakeup not confirmed' : d.phase}
                  {d.reason ? ` · ${d.reason}` : ''}
                </p>
              ))}
              {m.deliveries.every((d) => ['queued', 'held', 'inbox'].includes(d.phase)) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void call('cancel_message', { id: m.id, operationId: crypto.randomUUID() })
                  }
                >
                  Cancel unsent message
                </button>
              )}
              {m.deliveries.every((d) => ['held', 'inbox'].includes(d.phase)) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void call('resume_message', { id: m.id, operationId: crypto.randomUUID() })
                  }
                >
                  Revalidate and resume
                </button>
              )}
              {m.deliveries
                .filter((d) => d.phase === 'unknown')
                .map((d) => (
                  <Reconcile
                    key={d.attemptId}
                    busy={busy}
                    submit={(outcome, evidence) =>
                      call('reconcile_delivery', {
                        id: m.id,
                        attemptId: d.attemptId,
                        outcome,
                        evidence,
                      })
                    }
                  />
                ))}
              {!compact && m.senderTarget && (
                <button
                  onClick={() => {
                    setTarget(m.senderTarget!)
                    setReplyTo(m.id)
                    setDraft('')
                    operation.current = crypto.randomUUID()
                  }}
                >
                  Reply to sender
                </button>
              )}
              {m.senderTarget && (
                <button
                  onClick={() =>
                    window.threadlight.openInClaude(
                      sessions.find((s) => s.id === m.senderTarget)?.appId ?? m.senderTarget!,
                    )
                  }
                >
                  Open source chat
                </button>
              )}
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}

function Question({
  title,
  choices,
  busy,
  answer,
}: {
  title: string
  choices: string[]
  busy: boolean
  answer: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void answer(text)
      }}
    >
      <strong>{title}</strong>
      {choices.length ? (
        <select aria-label="Question answer" value={text} onChange={(e) => setText(e.target.value)}>
          <option value="">Choose an answer</option>
          {choices.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      ) : (
        <input
          aria-label="Question answer"
          value={text}
          maxLength={8000}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <button disabled={busy || !text.trim()}>Answer</button>
    </form>
  )
}

function WorkflowEditor({
  workflow,
  spaceId,
  sessions,
  busy,
  save,
}: {
  workflow?: Workflow
  spaceId: string
  sessions: Session[]
  busy: boolean
  save: (w: Workflow, revision: number) => Promise<boolean>
}) {
  const [available, setAvailable] = useState<Destination[]>([])
  const [discoveryError, setDiscoveryError] = useState('')
  const choices = available.length
    ? available
    : sessions.map((s) => ({
        id: s.id,
        provider: s.provider ?? 'claude',
        title: s.title,
        model: s.model,
      }))
  const [participants, setParticipants] = useState<Participant[]>(workflow?.participants ?? [])
  const [mode, setMode] = useState<Workflow['mode']>(workflow?.mode ?? 'manual')
  const [paused, setPaused] = useState(workflow?.paused ?? true)
  const [budget, setBudget] = useState(workflow?.maxDispatches ?? 20)
  const [coordinator, setCoordinator] = useState(workflow?.coordinator ?? '')
  const [concurrent, setConcurrent] = useState(workflow?.maxConcurrent ?? 2)
  const [recover, setRecover] = useState(workflow?.recover ?? false)
  const [reviewer, setReviewer] = useState(workflow?.reviewer ?? '')

  const edit = (id: string, patch: Partial<Participant>) =>
    setParticipants((rows) => rows.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  return (
    <details>
      <summary>Workflow configuration</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(
            {
              id: workflow?.id ?? crypto.randomUUID(),
              spaceId,
              revision: (workflow?.revision ?? 0) + 1,
              participants,
              mode,
              paused,
              maxConcurrent: concurrent,
              maxDispatches: budget,
              expiresAt: Date.now() + 4 * 3600000,
              recover,
              coordinator: coordinator || undefined,
              acceptBy: reviewer ? 'reviewer' : 'human',
              reviewer: reviewer || undefined,
            },
            workflow?.revision ?? 0,
          )
        }}
      >
        <p>
          Choose existing chats and the exact models for their roles. Communication permission
          covers this project's DMs; native permission cards still require your decision.
        </p>
        <button
          type="button"
          onClick={async () => {
            const r = await window.threadlight.communicationRequest({
              action: 'get_destination',
              arguments: {},
            })
            if (r.ok) setAvailable(r.value as Destination[])
            else setDiscoveryError(r.reason)
          }}
        >
          Find all chats for roles
        </button>
        {discoveryError && <p role="alert">{discoveryError}</p>}
        <p>
          Existing folder subscriptions keep their own rules. Pause them before enabling automatic
          coordination for this project.
        </p>
        {participants.map((p) => (
          <fieldset key={p.id}>
            <label>
              Role
              <input
                value={p.role}
                maxLength={80}
                onChange={(e) => edit(p.id, { role: e.target.value })}
              />
            </label>
            <label>
              Chat
              <select
                aria-label="Chat"
                value={p.target}
                onChange={(e) => {
                  const s = choices.find((s) => s.id === e.target.value)
                  edit(p.id, { target: e.target.value, model: s?.model ?? '' })
                }}
              >
                <option value="">Choose a chat</option>
                {choices.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.provider ?? 'claude'} · {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <input value={p.model} onChange={(e) => edit(p.id, { model: e.target.value })} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={p.communicate}
                onChange={(e) => edit(p.id, { communicate: e.target.checked })}
              />
              Allow project DMs
            </label>
            <label>
              <input
                type="checkbox"
                checked={p.requestWork}
                onChange={(e) => edit(p.id, { requestWork: e.target.checked })}
              />
              Allow requests for work
            </label>
            <button
              type="button"
              onClick={() => setParticipants((rows) => rows.filter((r) => r.id !== p.id))}
            >
              Remove role
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={participants.length >= 12}
          onClick={() =>
            setParticipants((rows) => [
              ...rows,
              {
                id: crypto.randomUUID(),
                role: '',
                target: '',
                model: '',
                communicate: false,
                requestWork: false,
              },
            ])
          }
        >
          Add role
        </button>
        <label>
          Progression
          <select value={mode} onChange={(e) => setMode(e.target.value as Workflow['mode'])}>
            <option value="manual">Manual</option>
            <option value="assisted">Assisted</option>
            <option value="automatic">Automatic within configured scope</option>
          </select>
        </label>
        <label>
          Event coordinator
          <select value={coordinator} onChange={(e) => setCoordinator(e.target.value)}>
            <option value="">No automatic model follow-up</option>
            {participants
              .filter((p) => p.communicate)
              .map((p) => (
                <option key={p.id} value={p.target}>
                  {p.role}
                </option>
              ))}
          </select>
        </label>
        <label>
          Result acceptance
          <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">Human review</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Concurrent background turns
          <input
            type="number"
            min={1}
            max={4}
            value={concurrent}
            onChange={(e) => setConcurrent(Number(e.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={recover} onChange={(e) => setRecover(e.target.checked)} />
          Resume definitely unsent work after restart when this configuration is still valid
        </label>
        <label>
          Maximum deliveries
          <input
            type="number"
            min={1}
            max={100}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Pause new dispatches
        </label>
        <p>Saving authorizes these communication and acceptance rules for four hours.</p>
        <button
          disabled={
            busy ||
            !participants.length ||
            participants.some((p) => !p.target || !p.role || !p.model)
          }
        >
          Save workflow
        </button>
      </form>
    </details>
  )
}

function NativeRequest({
  request,
  busy,
  focus,
  answer,
}: {
  request: NativeCommunicationRequest
  busy: boolean
  focus: () => Promise<boolean>
  answer: (response: NativeCommunicationResponse) => Promise<boolean>
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const questions = request.questions ?? []
  return (
    <article aria-label="Live request">
      <strong>{request.title}</strong>
      {request.detail && <p className={styles.body}>{request.detail}</p>}
      <p>
        {request.target} · Available until {new Date(request.expiresAt).toLocaleTimeString()}
      </p>
      <button disabled={busy} onClick={async () => setFocused(await focus())}>
        {focused ? 'Selected for your next Agent answer' : 'Answer through Agent'}
      </button>
      {request.kind === 'approval' ? (
        <>
          <button disabled={busy} onClick={() => void answer({ action: 'allow' })}>
            Allow once
          </button>
          <button disabled={busy} onClick={() => void answer({ action: 'deny' })}>
            Deny
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void answer({ action: 'answer', ...(questions.length ? { answers } : { text }) })
          }}
        >
          {questions.length ? (
            questions.map((q) => (
              <label key={q.question}>
                {q.question}
                <input
                  value={answers[q.question] ?? ''}
                  maxLength={4000}
                  onChange={(e) =>
                    setAnswers((previous) => ({ ...previous, [q.question]: e.target.value }))
                  }
                />
              </label>
            ))
          ) : (
            <input
              aria-label="Native answer"
              value={text}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <button
            disabled={
              busy ||
              (questions.length
                ? questions.some((q) => !answers[q.question]?.trim())
                : !text.trim())
            }
          >
            Send answer
          </button>
        </form>
      )}
    </article>
  )
}

function Reconcile({
  busy,
  submit,
}: {
  busy: boolean
  submit: (outcome: 'completed' | 'rejected', evidence: string) => Promise<boolean>
}) {
  const [evidence, setEvidence] = useState('')
  return (
    <details>
      <summary>Review uncertain delivery</summary>
      <label>
        Evidence from the native chat
        <input value={evidence} maxLength={2000} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <button
        disabled={busy || !evidence.trim()}
        onClick={() => void submit('completed', evidence)}
      >
        Confirm completed
      </button>
      <button disabled={busy || !evidence.trim()} onClick={() => void submit('rejected', evidence)}>
        Confirm not delivered
      </button>
    </details>
  )
}
