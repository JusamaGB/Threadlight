import { useEffect, useRef, useState } from 'react'

/** Only coordinates a rectangle; artifact JavaScript never enters this renderer. */
export function InteractiveArtifact({
  threadId,
  id,
  onEscape,
  onNavigate,
  fallback,
}: {
  threadId: string
  id: string
  onEscape: () => void
  onNavigate: (direction: -1 | 1) => void
  fallback: React.ReactNode
}) {
  const stage = useRef<HTMLDivElement>(null)
  const escape = useRef(onEscape)
  const navigate = useRef(onNavigate)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    escape.current = onEscape
    navigate.current = onNavigate
  }, [onEscape, onNavigate])
  useEffect(() => {
    const element = stage.current
    if (!element || !window.threadlight.artifactPreview) return
    const token = crypto.randomUUID()
    let stopped = false
    let previous = ''
    let frame = 0
    const update = () => {
      if (stopped) return
      const rect = element.getBoundingClientRect()
      // Clip to scrolling ancestors so the native view cannot cover the toolbar.
      let left = Math.max(0, rect.left),
        top = Math.max(0, rect.top)
      let right = Math.min(innerWidth, rect.right),
        bottom = Math.min(innerHeight, rect.bottom)
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
          const clip = parent.getBoundingClientRect()
          left = Math.max(left, clip.left)
          top = Math.max(top, clip.top)
          right = Math.min(right, clip.right)
          bottom = Math.min(bottom, clip.bottom)
        }
      }
      const bounds = {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      }
      const key = JSON.stringify(bounds)
      if (previous !== key) {
        previous = key
        void window.threadlight.artifactPreview({ action: 'bounds', token, bounds }).catch(() => {})
      }
      frame = requestAnimationFrame(update)
    }
    const unsubscribe = window.threadlight.onArtifactPreviewEvent((event) => {
      if (event.token !== token || stopped) return
      if (event.type === 'escape') escape.current()
      else if (event.type === 'previous' || event.type === 'next')
        navigate.current(event.type === 'previous' ? -1 : 1)
      else setFailure(event.reason ?? 'The interactive preview stopped.')
    })
    void window.threadlight
      .artifactPreview({ action: 'open', token, threadId, id })
      .then((reply) => {
        if (!stopped && !reply.ok) setFailure(reply.reason ?? 'Interactive preview unavailable.')
      })
      .catch(() => {
        if (!stopped) setFailure('Interactive preview unavailable.')
      })
    update()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      unsubscribe()
      void window.threadlight.artifactPreview({ action: 'close', token }).catch(() => {})
    }
  }, [threadId, id])
  if (failure)
    return (
      <>
        <p role="alert">{failure}</p>
        {fallback}
      </>
    )
  // Browser-only environments keep the existing static preview.
  if (!window.threadlight.artifactPreview) return <>{fallback}</>
  return (
    <div
      ref={stage}
      style={{ width: '100%', height: '100%' }}
      aria-label="Interactive artifact preview"
    />
  )
}
