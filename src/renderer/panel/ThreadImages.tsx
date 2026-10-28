import { useEffect, useRef, useState } from 'react'
import type { TimelineItem, TimelineImageReply } from '../../shared/threadTimeline'
import styles from './ThreadConversation.module.css'
import { ContextMenu } from './ContextMenu'

function ImagePreview({
  threadId,
  item,
  onOpenArtifact,
}: {
  threadId: string
  item: TimelineItem
  onOpenArtifact?: (id: string) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const inspect = async () => {
    if (inspecting || !onOpenArtifact) return
    setInspecting(true)
    setInspectError(null)
    try {
      const reply = await window.threadlight.threadImage({
        threadId,
        itemId: item.id,
        action: 'inspect',
      })
      if (!mounted.current) return
      if (reply.ok && reply.artifactId) onOpenArtifact(reply.artifactId)
      else setInspectError(reply.ok ? 'Could not open this image in Artifacts.' : reply.reason)
    } catch {
      if (mounted.current) setInspectError('Could not open this image in Artifacts.')
    } finally {
      if (mounted.current) setInspecting(false)
    }
  }
  const [result, setResult] = useState<TimelineImageReply | null>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    let current = true
    window.threadlight.threadImage({ threadId, itemId: item.id }).then(
      (reply) => {
        if (current) setResult(reply)
      },
      () => {
        if (current) setResult({ ok: false, reason: 'Image preview unavailable.' })
      },
    )
    return () => {
      current = false
    }
  }, [threadId, item.id])
  const name = item.detail?.split(/[\\/]/).at(-1) || 'Viewed image'
  return (
    <figure className={styles.imagePreview}>
      {result?.ok && !broken ? (
        <img
          src={result.dataUrl}
          alt={name}
          onError={() => setBroken(true)}
          onContextMenu={(event) => {
            if (!onOpenArtifact) return
            event.preventDefault()
            event.stopPropagation()
            setMenu({ x: event.clientX, y: event.clientY })
          }}
        />
      ) : (
        <p role="status">
          {broken
            ? 'Image preview unavailable.'
            : result && !result.ok
              ? result.reason
              : 'Loading image…'}
        </p>
      )}
      <figcaption title={name}>{name}</figcaption>
      {inspecting && <span role="status">Opening image…</span>}
      {inspectError && <span role="alert">{inspectError}</span>}
      {menu && (
        <ContextMenu
          label="Image actions"
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Inspect image',
              disabled: inspecting,
              onSelect: () => {
                void inspect()
              },
            },
          ]}
        />
      )}
    </figure>
  )
}

export function ThreadImages({
  threadId,
  items,
  onOpenArtifact,
}: {
  threadId: string
  items: TimelineItem[]
  onOpenArtifact?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, items.length - 1)
  const item = items[index]!
  return (
    <details
      className={styles.tool}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
      }}
    >
      <summary>{items.length === 1 ? 'Viewed an image' : `Viewed ${items.length} images`}</summary>
      {open && (
        <div className={styles.imageGallery} role="group" aria-label="Viewed images">
          <ImagePreview
            key={item.id + ':' + item.detail}
            threadId={threadId}
            item={item}
            onOpenArtifact={onOpenArtifact}
          />
          {items.length > 1 && (
            <nav className={styles.imageNavigation} aria-label="Image navigation">
              <button
                type="button"
                aria-label="Previous image"
                disabled={index === 0}
                onClick={() => setSelected(index - 1)}
              >
                ‹
              </button>
              <span aria-live="polite">
                {index + 1} / {items.length}
              </span>
              <button
                type="button"
                aria-label="Next image"
                disabled={index === items.length - 1}
                onClick={() => setSelected(index + 1)}
              >
                ›
              </button>
            </nav>
          )}
        </div>
      )}
    </details>
  )
}
