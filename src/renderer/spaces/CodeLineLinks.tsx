import { useState } from 'react'

function LineLink({ discussionId, label }: { discussionId: string; label: string }) {
  const [excerpt, setExcerpt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const open = async () => {
    if (excerpt !== null) {
      setExcerpt(null)
      return
    }
    setLoading(true)
    const [first, last = first] = label.match(/\d+/g)!.map(Number)
    try {
      const result = await window.threadlight.spacesRequest({
        action: 'source_lines',
        id: discussionId,
        first: first!,
        last: last!,
      })
      if (!result.ok) setExcerpt(result.reason)
      else if (result.sourceLines)
        setExcerpt(result.sourceLines.lines.map((line, i) => `${first! + i}  ${line}`).join('\n'))
    } catch {
      setExcerpt('This shared snapshot is unavailable.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <span>
      <button
        type="button"
        disabled={loading}
        aria-expanded={excerpt !== null}
        onClick={() => void open()}
      >
        {label}
      </button>
      {excerpt !== null && (
        <code style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {excerpt}
        </code>
      )}
    </span>
  )
}

/** Citations resolve only against this discussion's immutable source. */
export function CodeLineLinks({ discussionId, text }: { discussionId: string; text: string }) {
  return (
    <>
      {text
        .split(/(\bL\d+(?:[-–]L?\d+)?\b)/g)
        .map((part, index) =>
          index % 2 ? (
            <LineLink key={`${index}:${part}`} discussionId={discussionId} label={part} />
          ) : (
            part
          ),
        )}
    </>
  )
}
