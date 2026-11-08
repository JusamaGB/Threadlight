import { useEffect, useRef, useState } from 'react'
import {
  emptyPerplexity,
  type PerplexityCommand,
  type PerplexitySnapshot,
} from '../../shared/perplexity'
import { ComposerInput } from '../composer/ComposerInput'
import { Tip } from '../panel/Tip'
import styles from './PerplexitySettings.module.css'

const drafts = new Map<string, string>()
export function PerplexitySettings() {
  const [expanded, setExpanded] = useState(false)
  return (
    <details
      className={styles.section}
      data-perplexity-settings=""
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        Perplexity <span className={styles.muted}>Preview</span>
      </summary>
      {expanded && <PerplexityConnection />}
    </details>
  )
}
export function PerplexityConnection() {
  const [state, setState] = useState<PerplexitySnapshot>(emptyPerplexity)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState(drafts.get('new') ?? '')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const refresh = () => {
      void window.threadlight
        .perplexity({ action: 'status' })
        .then((reply) => {
          if (mounted.current) setState(reply.snapshot)
        })
        .catch(() => {
          if (mounted.current) setError('Perplexity connection unavailable.')
        })
    }
    refresh()
    const unsubscribe = window.threadlight.onPerplexity(refresh)
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])
  const request = async (command: PerplexityCommand) => {
    setPending(true)
    setError('')
    try {
      const reply = await window.threadlight.perplexity(command)
      if (mounted.current) {
        setState(reply.snapshot)
        if (!reply.ok) setError(reply.reason)
      }
      return reply
    } catch {
      if (mounted.current)
        setError('The request could not be confirmed. Check Perplexity before retrying.')
      return null
    } finally {
      if (mounted.current) setPending(false)
    }
  }
  const choose = (id: string) => {
    setSelected(id)
    setDraft(drafts.get(id || 'new') ?? '')
  }
  const send = async () => {
    const text = draft.trim(),
      key = selected || 'new'
    if (!text || pending || state.busy || state.uncertainSend) return
    const reply = await request({
      action: 'send',
      message: text,
      operationId: crypto.randomUUID(),
      ...(selected ? { threadId: selected } : {}),
    })
    if (reply?.ok) {
      drafts.delete(key)
      if (mounted.current) {
        setDraft('')
        if (reply.snapshot.thread) setSelected(reply.snapshot.thread.id)
      }
    }
  }
  const connected = state.computer.state === 'connected'
  const working = state.busy || pending
  const thread = state.thread?.id === selected ? state.thread : null
  return (
    <div className={styles.content}>
      <div className={styles.row}>
        <strong>Desktop chats</strong>
        <button disabled={working} onClick={() => void request({ action: 'discover' })}>
          Refresh chats
        </button>
      </div>
      {state.desktop.state === 'unchecked' && (
        <p className={styles.muted}>Read the chats visible to the Windows app.</p>
      )}
      {state.desktop.state === 'unavailable' && <p role="status">{state.desktop.reason}</p>}
      {state.desktop.state === 'ready' && (
        <>
          <span className={styles.muted}>
            {state.desktop.chats.length} chats · checked{' '}
            {new Date(state.desktop.checkedAt!).toLocaleTimeString()}
          </span>
          {state.desktop.hasMore && (
            <span className={styles.muted}>More chats exist; this is the app’s current page.</span>
          )}
          <div className={styles.list}>
            {state.desktop.chats.map((chat) => (
              <details key={chat.id}>
                <summary>
                  <span>{chat.title || 'Untitled chat'}</span>
                  <small>
                    {chat.status}
                    {chat.archived ? ' · archived' : ''}
                  </small>
                </summary>
                <p className={styles.preview}>
                  <strong>{chat.title || 'Untitled chat'}</strong>
                  {'\n'}
                  {chat.preview || 'No preview available.'}
                </p>
                <button
                  disabled={working}
                  onClick={() => void request({ action: 'open', threadId: chat.id })}
                >
                  Open chat in Perplexity
                </button>
              </details>
            ))}
          </div>
        </>
      )}
      <div className={styles.row}>
        <strong>Computer</strong>
        <span className={styles.muted}>{state.computer.state}</span>
        {!['connected', 'connecting', 'authorizing'].includes(state.computer.state) && (
          <button disabled={working} onClick={() => void request({ action: 'connect' })}>
            Connect Computer
          </button>
        )}
        {state.computer.state !== 'disconnected' && (
          <Tip text="Remove Threadlight’s saved sign-in. This does not stop running tasks or revoke access in your Perplexity account.">
            <button disabled={working} onClick={() => void request({ action: 'disconnect' })}>
              Disconnect
            </button>
          </Tip>
        )}
      </div>
      {state.computer.state === 'authorizing' && (
        <p role="status">Finish signing in in your browser.</p>
      )}
      {state.computer.reason && <p role="status">{state.computer.reason}</p>}
      {connected && (
        <>
          <div className={styles.row}>
            <select
              aria-label="Perplexity Computer task"
              value={selected}
              disabled={working}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">New Computer task</option>
              {state.computerThreads.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            {selected && (
              <button
                disabled={working}
                onClick={() => void request({ action: 'read', threadId: selected })}
              >
                Read task
              </button>
            )}
          </div>
          {thread && (
            <div className={styles.transcript}>
              <span role="status">
                {thread.status}
                {thread.truncated ? ' · recent transcript' : ''}
              </span>
              <p>{thread.text || 'No transcript returned yet.'}</p>
              {thread.needsInput && (
                <p>
                  Continue in Perplexity to answer the pending request, then read the task again.
                </p>
              )}
            </div>
          )}
          {selected && (
            <div className={styles.row}>
              <button
                disabled={pending}
                onClick={() => void request({ action: 'open', threadId: selected })}
              >
                Open Perplexity Computer
              </button>
              {thread &&
                ['working', 'input_required'].includes(thread.status) &&
                state.computer.tools.includes('cancel_task') && (
                  <button
                    disabled={working}
                    onClick={() =>
                      void request({
                        action: 'cancel',
                        threadId: selected,
                        operationId: crypto.randomUUID(),
                      })
                    }
                  >
                    Stop task
                  </button>
                )}
            </div>
          )}
          <ComposerInput
            input={{
              'aria-label': 'Message Perplexity Computer',
              value: draft,
              placeholder: selected ? 'Follow up…' : 'New task…',
              disabled: working || state.uncertainSend,
              onChange: (event) => {
                setDraft(event.target.value)
                drafts.set(selected || 'new', event.target.value)
              },
              maxLength: 16000,
            }}
            sendLabel="Send to Perplexity Computer"
            sendDisabled={working || state.uncertainSend}
            onSend={() => void send()}
          />
          <span className={styles.muted}>Computer uses your Perplexity account credits.</span>
        </>
      )}
      {state.uncertainSend && (
        <div role="alert">
          <p>A previous request may have been delivered. Check Perplexity before sending again.</p>
          <button disabled={working} onClick={() => void request({ action: 'reconcile' })}>
            I checked Perplexity
          </button>
        </div>
      )}
      {error && error !== state.computer.reason && <p role="alert">{error}</p>}
    </div>
  )
}
