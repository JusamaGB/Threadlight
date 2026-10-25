import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { SttStatus } from '../../shared/stt'
import type { RelayStatus, Session } from '../../shared/types'
import type { VoiceState } from '../hooks/useVoice'
import { en } from '../i18n/en'
import { ticks } from '../lib/relay'
import { useDraft } from '../lib/drafts'
import { ProviderBadge } from '../panel/ProviderBadge'
import styles from './Composer.module.css'

interface ComposerProps {
  showProvider?: boolean
  session: Session
  relay: RelayStatus | undefined
  stt: SttStatus
  /** Recording is owned by the panel (shared with the talk hotkey); the composer shows it. */
  voiceState: VoiceState
  level: number
  onMic: () => void
  /** Text just transcribed from the mic, appended to the box each time `n` changes. */
  heard: { text: string; n: number } | null
  voiceError: string | null
  /** Text to start with, e.g. what was said to the talk hotkey. */
  initialText?: string
  /** Send automatically after this many seconds unless cancelled (voice sends only). */
  countdownSeconds?: number
  /** Bumped by the panel to cancel the countdown (the talk hotkey pressed again). */
  cancelToken: number
  onClose: () => void
}

const MAX_ROWS = 4
const RING = 2 * Math.PI * 7 // circumference of the countdown ring (r = 7)

/** Claude's composer, trimmed to talking and typing: To line with ticks, the box, send and mic. */
export function Composer(props: ComposerProps) {
  const { session, relay, stt, voiceState, level, onMic, heard, voiceError } = props
  const { initialText = '', countdownSeconds, cancelToken, onClose } = props
  const [text, setText] = useDraft(`${session.id}:composer:${initialText}`, initialText)
  const [error, setError] = useState<string | null>(null)
  const [askDownload, setAskDownload] = useState(false)
  const [countdownEnds, setCountdownEnds] = useState<number | null>(() =>
    countdownSeconds ? Date.now() + countdownSeconds * 1000 : null,
  )
  const [now, setNow] = useState(() => Date.now())
  const box = useRef<HTMLTextAreaElement>(null)
  const mark = ticks(relay)
  const busy = relay?.state === 'sending' || relay?.state === 'sent'

  // Opening the composer puts the cursor in the box (the panel remounts it per thread).
  // A voice send opens the panel without focus, so this only takes effect once clicked.
  useEffect(() => box.current?.focus(), [])

  // Grow with the text, up to a few lines, then scroll.
  useEffect(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    const line = parseFloat(getComputedStyle(element).lineHeight) || 16
    element.style.height = `${Math.min(element.scrollHeight, line * MAX_ROWS)}px`
  }, [text])

  const send = async (message = text.trim()) => {
    if (!message || busy) return
    if (session.provider === 'codex' && session.live) {
      window.threadlight.copyText(message)
      if (session.appId) window.threadlight.openInClaude(session.appId)
      return
    }
    const result = await window.threadlight.sendMessage(session.id, message)
    if (result.ok) {
      setText('')
      setError(null)
    } else {
      setError(result.reason)
    }
  }

  // The countdown: tick until it ends, then send what is in the box.
  useEffect(() => {
    if (countdownEnds === null) return
    const timer = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= countdownEnds) {
        window.clearInterval(timer)
        setCountdownEnds(null)
        void send()
      }
    }, 100)
    return () => window.clearInterval(timer)
    // send reads the latest text through its closure on each tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownEnds, text])

  const cancelCountdown = () => setCountdownEnds(null)

  // The talk hotkey pressed again during the countdown cancels it.
  const firstToken = useRef(cancelToken)
  useEffect(() => {
    if (cancelToken !== firstToken.current) setCountdownEnds(null)
  }, [cancelToken])

  // Each new transcript from the mic is added to whatever is already typed.
  const lastHeard = useRef(heard?.n ?? 0)
  useEffect(() => {
    if (!heard || heard.n === lastHeard.current) return
    lastHeard.current = heard.n
    setText((current) => (current.trim() ? `${current.trimEnd()} ${heard.text}` : heard.text))
    box.current?.focus()
  }, [heard, setText])

  const toggleMic = () => {
    setError(null)
    if (stt.state === 'missing' || stt.state === 'error') return setAskDownload(true)
    if (stt.state === 'ready') onMic()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      cancelCountdown()
      void send()
    } else if (event.key === 'Escape') {
      event.stopPropagation() // closes the composer, not the whole panel
      onClose()
    }
  }

  const listening = voiceState === 'listening'
  const placeholder = listening
    ? en.voice.listening
    : voiceState === 'transcribing'
      ? en.voice.transcribing
      : en.composer.placeholder
  const shownError = error ?? voiceError
  const remaining = countdownEnds === null ? 0 : Math.max(0, (countdownEnds - now) / 1000)

  return (
    <div className={styles.composer}>
      <div className={styles.head}>
        <span className={styles.to}>{en.composer.to}</span>
        {props.showProvider && <ProviderBadge id={session.id} />}
        <span className={styles.target}>{session.title}</span>
        {countdownEnds !== null ? (
          <button
            className={styles.countdown}
            onClick={cancelCountdown}
            title={en.voice.cancelSend}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="7" className={styles.ringTrack} />
              <circle
                cx="8"
                cy="8"
                r="7"
                className={styles.ring}
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - remaining / (countdownSeconds ?? 1))}
              />
            </svg>
            {en.voice.sendingIn(Math.ceil(remaining))}
          </button>
        ) : (
          mark && (
            <span className={styles.ticks} data-tone={mark.tone}>
              {mark.text}
            </span>
          )
        )}
        <button className={styles.close} onClick={onClose} aria-label={en.composer.close}>
          ×
        </button>
      </div>

      {shownError && <p className={styles.error}>{shownError}</p>}

      {askDownload && stt.state !== 'ready' && (
        <div className={styles.download}>
          {stt.state === 'downloading' ? (
            <>
              <span>{en.voice.downloading}</span>
              <span className={styles.bar}>
                <span style={{ width: `${Math.round(stt.progress * 100)}%` }} />
              </span>
            </>
          ) : stt.state === 'loading' ? (
            <span>{en.voice.loading}</span>
          ) : (
            <>
              <span>{stt.state === 'error' ? stt.message : en.voice.needsModel}</span>
              <button className={styles.primary} onClick={() => window.threadlight.downloadStt()}>
                {stt.state === 'error' ? en.voice.retry : en.voice.download}
              </button>
              <button className={styles.secondary} onClick={() => setAskDownload(false)}>
                {en.voice.notNow}
              </button>
            </>
          )}
        </div>
      )}

      <div className={styles.pill}>
        <textarea
          ref={box}
          className={styles.input}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            cancelCountdown() // typing means you have taken over
            setText(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        {listening && !text && <Wave level={level} />}
        <button
          className={styles.send}
          onClick={() => {
            cancelCountdown()
            void send()
          }}
          disabled={!text.trim() || busy}
          aria-label={
            session.provider === 'codex' && session.live ? 'Copy and open Codex' : en.composer.send
          }
          title={
            session.provider === 'codex' && session.live ? 'Copy and open Codex' : en.composer.send
          }
        >
          ↵
        </button>
        <button
          className={styles.mic}
          data-state={voiceState}
          onClick={toggleMic}
          disabled={voiceState === 'transcribing'}
          aria-label={listening ? en.voice.stop : en.voice.start}
          title={listening ? en.voice.stop : en.voice.start}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
            <rect x="3.5" y="0.75" width="5" height="8" rx="2.5" />
            <path d="M1.25 6.5a4.75 4.75 0 0 0 9.5 0M6 11.25v2" fill="none" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Claude's listening wave: a dotted line, then three bars that follow the voice. */
function Wave({ level }: { level: number }) {
  return (
    <span className={styles.wave} aria-hidden="true">
      <span className={styles.dots} />
      {[0.6, 1, 0.75].map((weight, i) => (
        <span key={i} className={styles.level} style={{ height: `${3 + 11 * level * weight}px` }} />
      ))}
    </span>
  )
}
