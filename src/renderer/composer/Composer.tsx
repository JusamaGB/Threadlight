import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { RelayStatus, Session } from '../../shared/types'
import { en } from '../i18n/en'
import { ticks } from '../lib/relay'
import styles from './Composer.module.css'

interface ComposerProps {
  session: Session
  relay: RelayStatus | undefined
  onClose: () => void
}

const MAX_ROWS = 4

/** Claude's composer, trimmed to typing: a To line with delivery ticks, the box, and send. */
export function Composer({ session, relay, onClose }: ComposerProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const mark = ticks(relay)
  const busy = relay?.state === 'sending' || relay?.state === 'sent'

  // Opening the composer puts the cursor in the box. (The panel remounts it per thread.)
  useEffect(() => box.current?.focus(), [])

  // Grow with the text, up to a few lines, then scroll.
  useEffect(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    const line = parseFloat(getComputedStyle(element).lineHeight) || 16
    element.style.height = `${Math.min(element.scrollHeight, line * MAX_ROWS)}px`
  }, [text])

  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    const result = await window.threadlight.sendMessage(session.id, message)
    if (result.ok) {
      setText('')
      setError(null)
    } else {
      setError(result.reason)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    } else if (event.key === 'Escape') {
      event.stopPropagation() // closes the composer, not the whole panel
      onClose()
    }
  }

  return (
    <div className={styles.composer}>
      <div className={styles.head}>
        <span className={styles.to}>{en.composer.to}</span>
        <span className={styles.target}>{session.title}</span>
        {mark && (
          <span className={styles.ticks} data-tone={mark.tone}>
            {mark.text}
          </span>
        )}
        <button className={styles.close} onClick={onClose} aria-label={en.composer.close}>
          ×
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.pill}>
        <textarea
          ref={box}
          className={styles.input}
          rows={1}
          value={text}
          placeholder={en.composer.placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className={styles.send}
          onClick={() => void send()}
          disabled={!text.trim() || busy}
          aria-label={en.composer.send}
          title={en.composer.send}
        >
          ↵
        </button>
      </div>
    </div>
  )
}
