import { useEffect, useRef } from 'react'
import type { AgentState } from '../../shared/agent'
import type { AgentClient } from '../lib/agentClient'

// Keep the reading deadline independent of navigation and unrelated Agent updates.
export function useBrowserCaptions(
  agent: AgentState,
  active: boolean,
  threadId: string | null,
  source: AgentClient | null,
) {
  const prior = useRef(new Set<string>())
  const scope = useRef({ id: agent.conversationId, source })
  const last = useRef<{ id: string; text: string; complete: boolean; until: number } | null>(null)
  const sent = useRef('')
  useEffect(() => {
    const changed = scope.current.id !== agent.conversationId || scope.current.source !== source
    scope.current = { id: agent.conversationId, source }
    if (!active || changed) {
      prior.current = new Set(
        agent.items.flatMap((item) =>
          item.id?.startsWith('live:') && (!active || item.liveComplete !== false) ? [item.id] : [],
        ),
      )
      last.current = null
    }
    const item =
      active &&
      agent.items.findLast(
        (item) =>
          item.id?.startsWith('live:') &&
          !prior.current.has(item.id) &&
          (item.kind === 'agent' || item.kind === 'you'),
      )
    if (item && item.kind === 'agent' && item.id && item.text.trim()) {
      const text = item.text.trim().slice(-1500)
      const complete = item.liveComplete !== false
      if (
        last.current?.id !== item.id ||
        last.current.text !== text ||
        last.current.complete !== complete
      )
        last.current = {
          id: item.id,
          text,
          complete,
          until: Date.now() + (complete ? 5500 : 12000),
        }
    } else last.current = null
    const publish = (text: string) => {
      if (!text && !sent.current) return
      const payload = { action: 'caption' as const, threadId: text ? threadId : null, text }
      const key = JSON.stringify(payload)
      if (key === sent.current) return
      sent.current = key
      void window.threadlight.browserRequest(payload).catch(() => {})
    }
    const remaining = (last.current?.until ?? 0) - Date.now()
    publish(threadId && last.current && remaining > 0 ? last.current.text : '')
    if (threadId && remaining > 0) {
      const timer = window.setTimeout(() => publish(''), remaining)
      return () => clearTimeout(timer)
    }
  }, [active, agent.conversationId, agent.items, source, threadId])
}
