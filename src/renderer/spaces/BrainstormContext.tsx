import { useEffect, useState } from 'react'
import type { SpaceSource } from '../../shared/spaceContext'

function Source({
  discussionId,
  sourceRef,
  revision,
}: {
  discussionId: string
  sourceRef: string
  revision?: string
}) {
  const [body, setBody] = useState(''),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false)
  const [next, setNext] = useState<number | null>(null)
  const load = async (offset = 0) => {
    setError('')
    setOpen(true)
    try {
      const reply = await window.threadlight.spacesRequest({
        action: 'source',
        id: discussionId,
        sourceRef,
        revision,
        offset,
      })
      if (!reply.ok) {
        setError(reply.reason)
        return
      }
      const result = reply.context as {
        outcome?: string
        source?: SpaceSource
        reason?: string
        nextOffset?: number
        hasMore?: boolean
        items?: { text: string }[]
        cursor?: string
      }
      if (!['ok', 'partial'].includes(result.outcome ?? '')) {
        setError(result.reason ?? 'Source unavailable or outside this discussion’s current scope.')
        return
      }
      const text =
        result.source?.body ??
        result.items?.map((i) => i.text).join('\n\n') ??
        JSON.stringify(result, null, 2)
      setBody((previous) => (offset ? `${previous}${text}` : text))
      setNext(result.hasMore && result.nextOffset ? result.nextOffset : null)
      if (result.cursor)
        setError(
          'This is one page of the discussion. Open its saved discussion to continue reading.',
        )
    } catch {
      setError('Could not read this source.')
    }
  }
  return (
    <span>
      <button type="button" onClick={() => (open ? setOpen(false) : void load())}>
        {sourceRef}
        {revision ? ` · revision ${revision}` : ''}
      </button>
      {open && (
        <span style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <span>{body}</span>
          {error && <span role="status">{error}</span>}
          {next !== null && (
            <button type="button" onClick={() => void load(next)}>
              Read more
            </button>
          )}
        </span>
      )}
    </span>
  )
}

export function SourceLinks({ discussionId, text }: { discussionId: string; text: string }) {
  const parts = text.split(
    /((?:note|discussion|item|task|message|communication-message|communication-question|communication-assignment|communication-workflow|thread):[a-f0-9-]{36}(?:@\d+)?)/gi,
  )
  return (
    <>
      {parts.map((part, index) =>
        /^(?:note|discussion|item|task|message|communication-[a-z]+|thread):[a-f0-9-]{36}(?:@\d+)?$/i.test(
          part,
        ) ? (
          <Source
            key={index}
            discussionId={discussionId}
            sourceRef={part.split('@')[0]!}
            revision={part.split('@')[1]}
          />
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

export function BrainstormContext({ discussionId }: { discussionId: string }) {
  const [sources, setSources] = useState<Omit<SpaceSource, 'body'>[]>([]),
    [status, setStatus] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    void window.threadlight
      .spacesRequest({ action: 'context', id: discussionId })
      .then((reply) => {
        if (!current) return
        if (!reply.ok) {
          setStatus(reply.reason)
          return
        }
        const context = reply.context as {
          sources?: Omit<SpaceSource, 'body'>[]
          total?: number
          hasMore?: boolean
          observedAt?: number
          issues?: string[]
        }
        setSources(context.sources ?? [])
        setStatus(
          `${context.total ?? 0} sources${context.hasMore ? ' · first page shown; Agent can retrieve further pages' : ''} · checked ${context.observedAt ? new Date(context.observedAt).toLocaleTimeString() : 'now'}. ${(context.issues ?? []).join(' ')}`,
        )
      })
      .catch(() => {
        if (current) setStatus('Space context unavailable.')
      })
    return () => {
      current = false
    }
  }, [discussionId, refresh])
  return (
    <details>
      <summary>Space context · read, track and propose</summary>
      <p>{status}</p>
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>
        Refresh context
      </button>
      {sources.map((source) => (
        <div key={source.sourceRef}>
          <strong>{source.title}</strong> <small>{source.kind}</small>
          <div>
            <Source
              discussionId={discussionId}
              sourceRef={source.sourceRef}
              revision={source.revision}
            />
          </div>
        </div>
      ))}
    </details>
  )
}
