import { useEffect, useRef, useState } from 'react'
import type { QueuedMessage, QueueCommand } from '../../shared/codexQueue'
import { MESSAGE_LIMIT } from '../../shared/messaging'
import styles from './Composer.module.css'

export function QueuedMessages({
  sessionId,
  hidden,
  revision,
}: {
  sessionId: string
  hidden: boolean
  revision: number
}) {
  const [items, setItems] = useState<QueuedMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const updating = useRef(false)
  useEffect(
    () => () => {
      generation.current++
    },
    [sessionId],
  )
  useEffect(() => {
    if (hidden || !window.threadlight.codexQueue) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      const started = generation.current
      try {
        const result = await window.threadlight.codexQueue(sessionId, { action: 'list' })
        if (stopped || started !== generation.current) return
        if (result.ok) {
          setItems(result.items)
          setReadError(null)
        } else setReadError(result.reason)
      } catch {
        if (!stopped && started === generation.current)
          setReadError('Could not refresh the Codex queue.')
      }
      if (!stopped) timer = setTimeout(() => void read(), 3000)
    }
    if (!busy) void read()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [sessionId, hidden, revision, busy, refresh])
  async function update(command: QueueCommand) {
    if (updating.current) return
    updating.current = true
    const started = ++generation.current
    setBusy(true)
    try {
      const result = await window.threadlight.codexQueue(sessionId, command)
      if (started !== generation.current) return
      if (result.ok) {
        setItems(result.items)
        setEditing(null)
        setError(null)
        setReadError(null)
      } else setError(result.reason)
    } catch {
      if (started === generation.current)
        setError('Queue update could not be confirmed. Refresh before retrying.')
    } finally {
      updating.current = false
      if (started === generation.current) setBusy(false)
    }
  }
  if (!items.length && !error && !readError) return null
  return (
    <section className={styles.queue} aria-label="Queued messages">
      <div className={styles.queueHeading}>
        Queued · {items.length}
        <button type="button" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
          Refresh
        </button>
      </div>
      {(error || readError) && <p role="status">{error || readError}</p>}
      {items.map((item) => (
        <article className={styles.queuedMessage} key={item.id}>
          {editing === item.id ? (
            <>
              <textarea
                aria-label="Edit queued message"
                value={text}
                maxLength={MESSAGE_LIMIT}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void update({ action: 'edit', id: item.id, text })}
              >
                Save
              </button>
              <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <p>{item.text || 'Image message'}</p>
              {item.images > 0 && (
                <small>
                  {item.images} image{item.images === 1 ? '' : 's'}
                </small>
              )}
              <div>
                <button
                  className={styles.queueSteer}
                  type="button"
                  disabled={busy}
                  title="Send this queued message into the current work"
                  onClick={() => void update({ action: 'steer', id: item.id })}
                >
                  Steer
                </button>
                <button
                  type="button"
                  disabled={busy || !item.editable}
                  onClick={() => {
                    setText(item.text)
                    setEditing(item.id)
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void update({ action: 'remove', id: item.id })}
                >
                  Remove
                </button>
              </div>
            </>
          )}
        </article>
      ))}
    </section>
  )
}
