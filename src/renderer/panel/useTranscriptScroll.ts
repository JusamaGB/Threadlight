import { useLayoutEffect, useRef, useState } from 'react'

const decisionSelector =
  '[data-card-state="pending"]:not([data-question-card]), [data-agent-request]:not([data-question-form], [data-question-card] *), [data-agent-approval]'
type Anchor = { position: Range | Element; top: number }

/** Prefer a character on the visible line: a code block can be taller than the entire reader. */
function readingAnchor(reader: HTMLElement): Anchor | null {
  const box = reader.getBoundingClientRect()
  for (const y of [box.top + 4, box.top + 14]) {
    for (const x of [box.left + 12, box.left + box.width / 2]) {
      const caret = document.caretRangeFromPoint(x, y)
      if (!caret || !reader.contains(caret.startContainer)) continue
      const rect = caret.getBoundingClientRect()
      if (rect.height && rect.bottom >= box.top && rect.top < box.bottom)
        return { position: caret, top: rect.top - box.top }
    }
  }
  const el = Array.from(reader.querySelectorAll('[data-message-id],[data-card-id],summary')).find(
    (el) =>
      el.getBoundingClientRect().bottom > box.top && el.getBoundingClientRect().top < box.bottom,
  )
  return el ? { position: el, top: el.getBoundingClientRect().top - box.top } : null
}

export function useTranscriptScroll(visible: boolean, view: string) {
  const log = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [unread, setUnread] = useState(false),
    [pending, setPending] = useState(false)
  const anchor = useRef<Anchor | null>(null)
  const previous = useRef('')
  function holdPosition() {
    const reader = log.current
    if (!reader) return
    following.current = false
    anchor.current = readingAnchor(reader)
  }
  function trackScroll() {
    const reader = log.current
    if (!visible || !reader?.clientHeight) return
    reader.toggleAttribute('data-scrolled', reader.scrollTop > 0)
    following.current = reader.scrollHeight - reader.scrollTop - reader.clientHeight <= 2
    if (following.current) {
      anchor.current = null
      setUnread(false)
    } else anchor.current = readingAnchor(reader)
  }
  function jumpToLatest() {
    following.current = true
    anchor.current = null
    setUnread(false)
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }
  function jumpToDecision() {
    const reader = log.current,
      card = reader?.querySelector<HTMLElement>(decisionSelector)
    if (reader && card)
      reader.scrollTop += card.getBoundingClientRect().top - reader.getBoundingClientRect().top
  }
  useLayoutEffect(() => {
    const reader = log.current
    if (!visible || !reader) return
    reader.toggleAttribute('data-scrolled', reader.scrollTop > 0)
    if (previous.current !== view) {
      previous.current = view
      following.current = true
      anchor.current = null
    }
    function settle(changed: boolean) {
      if (!reader?.clientHeight) return
      setPending(!!reader.querySelector(decisionSelector))
      if (following.current) {
        reader.scrollTop = reader.scrollHeight
        setUnread(false)
        return
      }
      const held = anchor.current
      if (held) {
        const node = held.position instanceof Range ? held.position.startContainer : held.position
        if (reader.contains(node)) {
          const rect = held.position.getBoundingClientRect()
          if (rect.height)
            reader.scrollTop += rect.top - reader.getBoundingClientRect().top - held.top
        }
      }
      if (changed) setUnread(true)
    }
    const initial = requestAnimationFrame(() => settle(false))
    const observer = new MutationObserver(() => settle(true))
    observer.observe(reader, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-card-state'],
    })
    return () => {
      cancelAnimationFrame(initial)
      observer.disconnect()
    }
  }, [view, visible])
  return { log, unread, pending, trackScroll, jumpToLatest, jumpToDecision, holdPosition }
}
