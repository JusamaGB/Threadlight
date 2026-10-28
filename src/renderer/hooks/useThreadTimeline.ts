import { useEffect, useRef, useState } from 'react'
import type { ThreadTimeline } from '../../shared/threadTimeline'

// UI state only, bounded to the recently inspected cards. The provider owns the transcript.
export const timelineViews = new Map<
  string,
  { timeline?: ThreadTimeline; top: number; following: boolean; anchor?: string; offset?: number }
>()
export function timelineView(id: string) {
  let view = timelineViews.get(id)
  if (!view) {
    if (timelineViews.size >= 24) timelineViews.delete(timelineViews.keys().next().value!)
    view = { top: 0, following: true }
    timelineViews.set(id, view)
  }
  return view
}

export function useThreadTimeline(id: string, enabled = true) {
  const [timeline, setTimeline] = useState<ThreadTimeline | undefined>(
    () => timelineViews.get(id)?.timeline,
  )
  const [error, setError] = useState('')
  const subscription = useRef('')
  useEffect(() => {
    if (!enabled) return
    const token = crypto.randomUUID()
    subscription.current = token
    let alive = true
    const accept = (next: ThreadTimeline) => {
      if (!alive || next.threadId !== id) return
      const cache = timelineView(id)
      if (cache.timeline && next.revision < cache.timeline.revision) return
      cache.timeline = next
      setError('')
      setTimeline(next)
    }
    const off = window.threadlight.onThreadTimeline(accept)
    void window.threadlight
      .threadTimeline({ threadId: id, subscriptionId: token, action: 'open' })
      .then((reply) => {
        if (!alive) return
        if (reply.ok) accept(reply.timeline)
        else setError(reply.reason)
      })
      .catch(() => {
        if (alive) setError('Conversation unavailable. Previous messages are retained.')
      })
    return () => {
      alive = false
      off()
      void window.threadlight
        .threadTimeline({ threadId: id, subscriptionId: token, action: 'close' })
        .catch(() => {})
    }
  }, [id, enabled])
  async function older() {
    setError('')
    try {
      const reply = await window.threadlight.threadTimeline({
        threadId: id,
        subscriptionId: subscription.current,
        action: 'older',
      })
      if (!reply.ok) setError(reply.reason)
    } catch {
      setError('Earlier messages could not be loaded. Try again.')
    }
  }
  return { timeline, error, older }
}

export type ThreadTimelineState = ReturnType<typeof useThreadTimeline>
