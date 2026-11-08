import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import type { MemoryInput, MemorySnapshot } from '../../shared/memory'
import type { Session } from '../../shared/types'
import styles from './ConnectionSetup.module.css'

export function ConnectionSetup({
  data,
  spaceId,
  connectionId,
  sessions,
  onClose,
  navigationRef,
}: {
  data: MemorySnapshot
  spaceId: string
  connectionId: string
  sessions: Session[]
  onClose: () => void
  navigationRef: Ref<{ back: () => void }>
}) {
  const [chosenTarget, setTarget] = useState('')
  const [search, setSearch] = useState('')
  const [matched, setMatched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState<MemoryInput | null>(null)
  const [now, setNow] = useState(Date.now)
  const connection = data.connections?.find((c) => c.id === connectionId)
  const requestedTarget = connection?.chatId
    ? `${connection.provider === 'codex' ? 'codex:' : ''}${connection.chatId}`
    : ''
  const providerSessions = sessions.filter(
    (s) =>
      (s.provider ?? 'claude') === connection?.provider &&
      (!requestedTarget || s.id === requestedTarget),
  )
  const suggestedChat = providerSessions.find((s) => s.id === requestedTarget)
  const target = chosenTarget || suggestedChat?.id || ''
  const chat = providerSessions.find((s) => s.id === target)
  const candidates = providerSessions.filter((s) =>
    `${s.title} ${s.cwd} ${s.id}`.toLowerCase().includes(search.toLowerCase()),
  )
  const space = data.spaces.find((s) => s.id === spaceId)
  const wrongProject = !connection?.spaceId || connection.spaceId !== spaceId
  const expired = !connection || (!!connection.expiresAt && connection.expiresAt <= now)
  useEffect(() => {
    if (!connection?.expiresAt) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, connection.expiresAt - Date.now()) + 25,
    )
    return () => clearTimeout(timer)
  }, [connection])
  useImperativeHandle(navigationRef, () => ({
    back: () => {
      if (!busy) onClose()
    },
  }))

  async function approve() {
    if (!space || !chat || !connection || busy || !matched || wrongProject) return
    setBusy(true)
    setError('')
    try {
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
            grant.readOnly ||
            grant.createFolders ||
            grant.delegate ||
            (grant.expiresAt != null && grant.expiresAt <= Date.now())
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
        readOnly: false,
        createFolders: false,
        delegate: false,
      }
      setAttempt(input)
      if (!recovered) {
        const result = await window.threadlight.memoryRequest(input)
        if (!result.ok) throw new Error(result.reason)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish connecting. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.guide} aria-label="Review chat request">
      <div className={styles.content}>
        <h3>{chat?.title ?? connection?.label ?? 'Request unavailable'}</h3>
        {wrongProject && (
          <p role="alert">
            This request does not target this project. Ask the chat to discover projects and request
            fresh access.
          </p>
        )}
        {space && !wrongProject && <p>Requested project: {space.title}</p>}
        {!space && <p role="alert">This space is unavailable. Reopen the project.</p>}
        {!connection && (
          <p role="status">
            This request is no longer available. Ask the chat for a new connection request.
          </p>
        )}
        {connection && (
          <>
            <p>
              Verification code <strong className={styles.code}>{connection.code}</strong>
            </p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={matched}
                disabled={busy || !!attempt}
                onChange={(e) => setMatched(e.target.checked)}
              />
              Confirm
            </label>
            {(!suggestedChat || chosenTarget) && (
              <fieldset disabled={busy || !!attempt}>
                <p>
                  {connection.chatId
                    ? 'The requesting chat is not currently available. Open that exact chat in its provider, then return here.'
                    : 'This request did not identify its chat. Choose it once below; chats from other folders are included.'}
                </p>
                <label>
                  Find chat
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by title or folder"
                  />
                </label>
                <label>
                  Link to chat
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Choose the chat that requested access…</option>
                    {candidates.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} · {s.cwd} · {s.id}
                      </option>
                    ))}
                  </select>
                </label>
                {!candidates.length && (
                  <p role="status">
                    No matching chats available. Clear the search, or open the chat in Claude or
                    Codex with its provider enabled in Threadlight, then return here.
                  </p>
                )}
              </fieldset>
            )}
            <p>This chat can read all notes and files in this space and publish shared notes.</p>
            {expired && !attempt && (
              <p role="alert">This request expired. Ask the chat for a new code.</p>
            )}
          </>
        )}
      </div>
      <div className={styles.footer}>
        <button
          className={styles.primary}
          disabled={
            busy ||
            !space ||
            wrongProject ||
            !matched ||
            !chat ||
            (!attempt && (expired || connection?.state !== 'pending'))
          }
          onClick={() => void approve()}
        >
          {busy ? 'Connecting…' : attempt ? 'Retry connection' : 'Approve connection'}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  )
}
