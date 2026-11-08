import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SpokenReply } from '../../shared/spokenReply'
import { ReplyCode } from '../panel/ReplyCode'
import styles from './SpokenReply.module.css'

export function usePillReply() {
  const [shown, setShown] = useState<SpokenReply | null>(null)
  const [available, setAvailable] = useState(false)
  const dismissed = useRef(new Set<string>())
  const dismissedTurn = useRef<{ userItemId?: string } | null>(null)
  useEffect(() => {
    let current = true,
      updated = false
    const receive = (reply: SpokenReply | null) => {
      if (!reply) {
        setAvailable(false)
        return
      }
      const keys = [reply.id, ...(reply.captionIds ?? [])]
      if (keys.some((key) => dismissed.current.has(key))) {
        for (const key of keys) dismissed.current.add(key)
        setAvailable(false)
        return
      }
      // A partial caption in the dismissed turn can still acquire the same source link.
      if (
        reply.awaitingLink &&
        dismissedTurn.current &&
        reply.userItemId === dismissedTurn.current.userItemId
      )
        return
      dismissedTurn.current = null
      setShown(reply)
      setAvailable(true)
    }
    const off = window.threadlight.onSpokenReply((reply) => {
      updated = true
      receive(reply)
    })
    void window.threadlight.getSpokenReply().then((reply) => {
      if (current && !updated) receive(reply)
    })
    return () => {
      current = false
      off()
    }
  }, [])
  const dismiss = () => {
    if (!shown) return
    dismissedTurn.current = { userItemId: shown.userItemId }
    for (const key of [shown.id, ...(shown.captionIds ?? [])]) dismissed.current.add(key)
    setAvailable(false)
  }
  return { shown, available, dismiss }
}

export function SpokenReplyBody({
  reply,
  expanded,
  dismiss,
  measure,
}: {
  reply: SpokenReply
  expanded: boolean
  dismiss: () => void
  measure: (width: number, height: number) => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    measure(content.current!.offsetWidth, Math.min(content.current!.offsetHeight, 232))
  }, [reply, measure])
  useLayoutEffect(() => {
    const el = content.current!
    const resize = () => measure(el.offsetWidth, Math.min(el.offsetHeight, 232))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])
  useLayoutEffect(() => {
    box.current?.scrollTo(0, 0)
  }, [reply.id])
  return (
    <div className={styles.body} inert={!expanded} aria-hidden={!expanded}>
      <section className={styles.box} aria-label="Latest spoken Agent reply" ref={box} tabIndex={0}>
        <div className={styles.content} ref={content}>
          <p key={reply.id}>{reply.text}</p>
          {reply.blocks.map((block) => (
            <ReplyCode
              key={reply.id + ':' + block.start}
              language={block.language}
              code={block.value + (block.value ? '\n' : '')}
              file={block.file}
            />
          ))}
        </div>
      </section>
      <button
        type="button"
        className={styles.close}
        aria-label="Close spoken reply"
        title="Close this reply"
        onClick={dismiss}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  )
}
