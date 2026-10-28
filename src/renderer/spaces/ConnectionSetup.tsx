import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { MemoryInput, MemorySnapshot } from '../../shared/memory'
import type { CommunicationSnapshot } from '../../shared/communication'
import type { Session } from '../../shared/types'
import { connectionWorkflow } from '../../shared/connectionSetup'
import styles from './ConnectionSetup.module.css'

export function ConnectionSetup({
  data,
  sessions,
  project,
  onClose,
  navigationRef,
}: {
  data: MemorySnapshot
  sessions: Session[]
  project: string
  onClose: () => void
  navigationRef: Ref<{ back: () => void }>
}) {
  const [step, setStep] = useState(1)
  const [spaceId, setSpaceId] = useState(data.spaces.length === 1 ? data.spaces[0]!.id : '')
  const [connectionId, setConnectionId] = useState('')
  const [target, setTarget] = useState('')
  const [matched, setMatched] = useState(false)
  const [publish, setPublish] = useState(false)
  const [cards, setCards] = useState(false)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedGrant, setSavedGrant] = useState(false)
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState<MemoryInput | null>(null)
  const [now, setNow] = useState(Date.now)
  const ids = useRef({ workflow: crypto.randomUUID(), participant: crypto.randomUUID() })
  const pending = (data.connections ?? []).filter((c) => c.state === 'pending')
  const connection = data.connections?.find((c) => c.id === connectionId)
  const chat = sessions.find((s) => s.id === target)
  const space = data.spaces.find((s) => s.id === spaceId)
  const expired = !connection || connection.expiresAt <= now
  useEffect(() => {
    if (!connection) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, connection.expiresAt - Date.now()) + 25,
    )
    return () => clearTimeout(timer)
  }, [connection])
  const back = () => {
    if (busy) return
    if (done || attempt || step === 1) onClose()
    else {
      setStep(step - 1)
      setError('')
    }
  }
  useImperativeHandle(navigationRef, () => ({ back }))

  async function approve() {
    if (!space || !chat || !connection || busy || !matched) return
    setBusy(true)
    setError('')
    try {
      if (!savedGrant) {
        let recovered = false
        if (attempt) {
          const latest = await window.threadlight.memoryRequest({ action: 'snapshot' })
          if (!latest.ok) throw new Error(latest.reason)
          const grant = latest.snapshot?.grants.find(
            (g) => g.pluginConnectionId === connectionId && !g.revoked,
          )
          if (grant) {
            if (
              grant.spaceId !== spaceId ||
              grant.assignee !== target ||
              grant.folderId !== null ||
              grant.readOnly !== attempt.readOnly ||
              grant.createFolders ||
              grant.delegate
            )
              throw new Error(
                'Access changed. Review this chat under Agent access before continuing.',
              )
            recovered = true
          }
        }
        const input: MemoryInput = attempt ?? {
          action: 'create_grant',
          operationId: crypto.randomUUID(),
          connectionId,
          assignee: target,
          spaceId,
          title: connection.label.slice(0, 80),
          readOnly: !(publish || cards),
          createFolders: false,
          delegate: false,
        }
        setAttempt(input)
        if (!recovered) {
          const result = await window.threadlight.memoryRequest(input)
          if (!result.ok) throw new Error(result.reason)
        }
        setSavedGrant(true)
      }
      if (cards) {
        const result = await window.threadlight.communicationRequest({
          action: 'get_workflow',
          arguments: { spaceId },
        })
        if (!result.ok) throw new Error(result.reason)
        const previous = (result.value as CommunicationSnapshot).workflows.find(
          (w) => w.spaceId === spaceId,
        )
        if (!previous?.participants.some((p) => p.target === target && p.communicate)) {
          const configured = await window.threadlight.communicationRequest({
            action: 'configure',
            expectedRevision: previous?.revision ?? 0,
            arguments: connectionWorkflow(
              previous,
              spaceId,
              target,
              model.trim(),
              ids.current,
              Date.now(),
            ),
          })
          if (!configured.ok) throw new Error(configured.reason)
        }
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish connecting. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const prompt =
    'Use the Threadlight plugin to check this chat’s approved connection, then ask me a test decision card with “It works” and “Something needs changing” as choices. Allow a typed answer and wait for my answer through threadlight_read_question.'
  return (
    <section className={styles.guide} aria-label="Connect a chat">
      <nav aria-label="Setup location" className={styles.breadcrumb}>
        {project} / Connect a chat
      </nav>
      <ol className={styles.steps} aria-label="Connection setup steps">
        {['Choose space', 'Connect chat', 'Access & test'].map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? 'step' : undefined}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      <div className={styles.content} key={`${step}-${done}`}>
        {done ? (
          <>
            <h3>Ready for {chat?.title}</h3>
            <p role="status">Approved · waiting for the chat to use its connection.</p>
            <p>
              {space?.title} ·{' '}
              {cards
                ? 'Shared notes and decision cards enabled.'
                : publish
                  ? 'Can read and publish shared notes.'
                  : 'Can read shared notes.'}
            </p>
            {cards && (
              <>
                <h4>Try a decision card</h4>
                <p>
                  Copy this request into the linked chat. Its next card should appear on that thread
                  in Threadlight, where you can answer it.
                </p>
                <button
                  onClick={async () => {
                    try {
                      await window.threadlight.copyText(prompt)
                      setCopied(true)
                    } catch {
                      setError('Could not copy. Select and copy the request below.')
                    }
                  }}
                >
                  {copied ? 'Test request copied' : 'Copy test request'}
                </button>
                <details>
                  <summary>Test request</summary>
                  <p className={styles.selectable}>{prompt}</p>
                </details>
              </>
            )}
          </>
        ) : (
          <>
            {step === 1 && (
              <>
                <h3>Choose what this chat will share</h3>
                <p>
                  A shared space holds the notes, files and decisions you choose to share between
                  chats. You control which chats join and what they can do.
                </p>
                <label>
                  Shared space
                  <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                    <option value="">Choose a space…</option>
                    {data.spaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {space?.description ||
                    'Choose an existing space in this project. Project setup creates its first space for you.'}
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <h3>Match the request from your chat</h3>
                <p>
                  In Claude or Codex, ask: “Connect this chat to Threadlight.” Its request will
                  appear here automatically.
                </p>
                {!pending.length && (
                  <p role="status">
                    No requests waiting. If the earlier code expired or Threadlight restarted, ask
                    the chat for a new connection request.
                  </p>
                )}
                <label>
                  Waiting request
                  <select
                    value={connectionId}
                    onChange={(e) => {
                      setConnectionId(e.target.value)
                      setTarget('')
                      setMatched(false)
                      setModel('')
                    }}
                  >
                    <option value="">Choose a request…</option>
                    {pending.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.provider === 'codex' ? 'Codex' : 'Claude'} · {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                {connection && (
                  <>
                    <p>
                      Verification code <strong className={styles.code}>{connection.code}</strong>
                    </p>
                    {expired && (
                      <p role="alert">This request expired. Ask the chat for a new code.</p>
                    )}
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={matched}
                        onChange={(e) => setMatched(e.target.checked)}
                      />
                      This code matches the one in my chat
                    </label>
                    <label>
                      Link to chat
                      <select
                        value={target}
                        onChange={(e) => {
                          setTarget(e.target.value)
                          setModel(sessions.find((s) => s.id === e.target.value)?.model ?? '')
                        }}
                      >
                        <option value="">Choose the chat that requested access…</option>
                        {sessions
                          .filter((s) => (s.provider ?? 'claude') === connection.provider)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p>
                      Only chats in {project} are listed. If yours is missing, check its project
                      selection above.
                    </p>
                  </>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <h3>Review access</h3>
                <p>
                  <strong>{chat?.title}</strong> will have access to <strong>{space?.title}</strong>
                  .
                </p>
                <fieldset disabled={busy || savedGrant || !!attempt}>
                  <p>This chat can read all notes and files in this space.</p>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={publish}
                      onChange={(e) => setPublish(e.target.checked)}
                    />
                    Allow publishing shared notes
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={cards}
                      onChange={(e) => setCards(e.target.checked)}
                    />
                    Enable decision cards and project messages
                  </label>
                  {cards && (
                    <>
                      <p>
                        This also allows publishing in this space. Answers return to the requesting
                        chat. Project messages are saved for your review.
                      </p>
                      <label>
                        Chat model
                        <input
                          value={model}
                          maxLength={100}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder="Model shown in the linked chat"
                        />
                      </label>
                    </>
                  )}
                </fieldset>
                <details>
                  <summary>What else changes?</summary>
                  <p>
                    Existing project workflow settings stay as they are. This setup does not grant
                    folder creation or automatic delegation. You can review or revoke access under
                    Agent access.
                  </p>
                </details>
                {savedGrant && (
                  <p role="status">
                    Chat access is approved. Decision-card setup still needs to finish; retry below.
                  </p>
                )}
                {expired && !savedGrant && (
                  <p role="alert">
                    This request expired. Go back and request a new code from the chat.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className={styles.footer}>
        {done ? (
          <button className={styles.primary} onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            {step === 1 && (
              <button className={styles.primary} disabled={!space} onClick={() => setStep(2)}>
                Continue
              </button>
            )}
            {step === 2 && (
              <button
                className={styles.primary}
                disabled={!matched || !chat || expired || connection?.state !== 'pending'}
                onClick={() => setStep(3)}
              >
                Review access
              </button>
            )}
            {step === 3 && (
              <button
                className={styles.primary}
                disabled={busy || (!savedGrant && expired) || (cards && !model.trim())}
                onClick={() => void approve()}
              >
                {busy
                  ? 'Connecting…'
                  : savedGrant
                    ? 'Finish enabling cards'
                    : attempt
                      ? 'Retry connection'
                      : 'Approve connection'}
              </button>
            )}
            <button disabled={busy} onClick={back}>
              {step === 1 || attempt ? 'Close setup' : 'Back'}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  )
}
