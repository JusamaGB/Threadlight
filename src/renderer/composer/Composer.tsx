import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { SttStatus } from '../../shared/stt'
import type { RelayStatus, Session } from '../../shared/types'
import { providerName, sessionProvider } from '../../shared/providers'
import type { VoiceState } from '../hooks/useVoice'
import { en } from '../i18n/en'
import { ticks } from '../lib/relay'
import { useComposerDraft } from '../lib/composerDraft'
import { MESSAGE_LIMIT } from '../../shared/messaging'
import { useComposerAttachments } from '../lib/composerAttachments'
import styles from './Composer.module.css'
import { VoiceWave } from './VoiceWave'
import { QueuedMessages } from './QueuedMessages'

interface ComposerProps {
  embedded?: boolean
  hidden?: boolean
  focusToken?: number
  micDisabled?: boolean
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
  const {
    session,
    relay,
    stt,
    voiceState,
    level,
    onMic,
    heard,
    voiceError,
    embedded = false,
    hidden = false,
    focusToken = 0,
    micDisabled = false,
  } = props
  const { initialText = '', countdownSeconds, cancelToken, onClose } = props
  const attachments = useComposerAttachments(session.id)
  const canAttach = sessionProvider(session.id) === 'codex'
  const [dragging, setDragging] = useState(false)
  const [queueRevision, setQueueRevision] = useState(0)
  const draft = useComposerDraft(session.id, initialText)
  const { text, setText } = draft
  const sendLocked = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askDownload, setAskDownload] = useState(false)
  const [countdownEnds, setCountdownEnds] = useState<number | null>(() =>
    !embedded && countdownSeconds ? Date.now() + countdownSeconds * 1000 : null,
  )
  const [now, setNow] = useState(() => Date.now())
  const countdownInvalidated = useRef(false)
  const voicePhase = useRef(voiceState)
  useLayoutEffect(() => {
    voicePhase.current = voiceState
    if (voiceState !== 'idle') countdownInvalidated.current = true
  }, [voiceState])
  const box = useRef<HTMLTextAreaElement>(null)
  const mark = ticks(relay)
  const busy =
    submitting ||
    relay?.state === 'sending' ||
    (session.provider !== 'codex' && relay?.state === 'sent')

  // Opening the composer puts the cursor in the box (the panel remounts it per thread).
  // A voice send opens the panel without focus, so this only takes effect once clicked.
  const focusedToken = useRef(0)
  useEffect(() => {
    if (draft.loading || hidden) return
    if (!embedded || focusToken > focusedToken.current) box.current?.focus()
    focusedToken.current = focusToken
  }, [draft.loading, embedded, hidden, focusToken])

  // Grow with the text, up to a few lines, then scroll.
  useEffect(() => {
    const element = box.current
    if (!element || element.hidden || hidden) return
    element.style.height = 'auto'
    const line = parseFloat(getComputedStyle(element).lineHeight) || 16
    element.style.height = `${Math.min(element.scrollHeight, line * MAX_ROWS)}px`
  }, [text, voiceState, hidden])

  const send = async (message = text.trim()) => {
    if (
      (!message && !attachments.items.length) ||
      busy ||
      sendLocked.current ||
      draft.loading ||
      attachments.loading ||
      attachments.busy ||
      voiceState !== 'idle' ||
      hidden
    )
      return
    const attachmentIds = attachments.items.map((item) => item.id)
    sendLocked.current = true
    setSubmitting(true)
    try {
      await draft.flush()
      if (voicePhase.current !== 'idle') return
      const result = await window.threadlight.sendMessage(
        session.id,
        message,
        attachmentIds.length ? attachmentIds : undefined,
        canAttach ? 'queue' : undefined,
      )
      if (result.ok) {
        setQueueRevision((n) => n + 1)
        attachments.accepted(attachmentIds)
        setText((current) => (current.trim() === message ? '' : current))
        setError(null)
      } else {
        setError(result.reason)
      }
    } catch {
      setError(
        'Sending could not be confirmed. Your text is retained; check the chat before retrying.',
      )
    } finally {
      sendLocked.current = false
      setSubmitting(false)
    }
  }

  // The countdown: tick until it ends, then send what is in the box.
  useEffect(() => {
    if (countdownEnds === null || draft.loading) return
    const timer = window.setInterval(() => {
      if (countdownInvalidated.current) {
        window.clearInterval(timer)
        setCountdownEnds(null)
        return
      }
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
  }, [
    countdownEnds,
    text,
    draft.loading,
    draft.error,
    attachments.loading,
    attachments.busy,
    attachments.items,
    voiceState,
  ])

  useEffect(() => {
    if (draft.error || draft.reviewRequired) countdownInvalidated.current = true
  }, [draft.error, draft.reviewRequired])

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
    if (!hidden) box.current?.focus()
  }, [heard, setText, hidden])

  const toggleMic = () => {
    setError(null)
    cancelCountdown()
    if (stt.state === 'missing' || stt.state === 'error') return setAskDownload(true)
    if (stt.state === 'ready') onMic()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
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
  const shownError = error ?? draft.error ?? attachments.error ?? voiceError
  const remaining = countdownEnds === null ? 0 : Math.max(0, (countdownEnds - now) / 1000)

  return (
    <div
      className={styles.composer}
      hidden={hidden}
      data-embedded={embedded || undefined}
      data-drop={dragging || undefined}
      onDragOver={(event) => {
        if (!canAttach || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = busy || attachments.busy ? 'none' : 'copy'
        setDragging(!busy && !attachments.busy)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!canAttach) return
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        if (busy || attachments.busy || attachments.loading) return
        cancelCountdown()
        void attachments.add(Array.from(event.dataTransfer.files))
      }}
      onPaste={(event) => {
        if (!canAttach || !event.clipboardData.files.length) return
        event.preventDefault()
        event.stopPropagation()
        if (busy || attachments.busy || attachments.loading) return
        cancelCountdown()
        void attachments.add(Array.from(event.clipboardData.files))
      }}
      data-provider={sessionProvider(session.id)}
      role="group"
      aria-label={`${providerName(sessionProvider(session.id))} message composer`}
    >
      {(!embedded || (countdownEnds !== null && !draft.error && !draft.reviewRequired)) && (
        <div className={styles.head}>
          {!embedded && (
            <>
              <span className={styles.to}>{en.composer.to}</span>
              <span className={styles.target}>{session.title}</span>
            </>
          )}
          {countdownEnds !== null && !draft.error && !draft.reviewRequired ? (
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
            !embedded &&
            mark && (
              <span className={styles.ticks} data-tone={mark.tone}>
                {mark.text}
              </span>
            )
          )}
          {!embedded && (
            <button className={styles.close} onClick={onClose} aria-label={en.composer.close}>
              ×
            </button>
          )}
        </div>
      )}

      {shownError && <p className={styles.error}>{shownError}</p>}
      {canAttach && (
        <>
          <QueuedMessages
            key={session.id}
            sessionId={session.id}
            hidden={hidden}
            revision={queueRevision}
          />
        </>
      )}

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

      {canAttach && attachments.items.length > 0 && (
        <ul className={styles.attachments} aria-label="Attached files">
          {attachments.items.map((item) => (
            <li key={item.id}>
              <span title={item.name}>
                {item.kind === 'image' ? '▧' : '▤'} {item.name}
              </span>
              <button
                type="button"
                disabled={busy || attachments.busy}
                aria-label={'Remove ' + item.name}
                onClick={() => {
                  cancelCountdown()
                  void attachments.remove(item.id)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachments.busy && (
        <p className={styles.attachmentStatus} role="status">
          Preparing files…
        </p>
      )}
      <div className={styles.pill}>
        {canAttach && (
          <button
            type="button"
            className={styles.attach}
            aria-label="Attach files"
            title="Attach files, paste or drop"
            disabled={busy || attachments.busy || attachments.loading}
            onClick={() => {
              cancelCountdown()
              void attachments.pick()
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M6 1v10M1 6h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        <div className={styles.entry}>
          <textarea
            ref={box}
            className={styles.input}
            hidden={listening && !text.trim()}
            rows={1}
            disabled={draft.loading}
            maxLength={MESSAGE_LIMIT}
            value={text}
            placeholder={placeholder}
            onChange={(event) => {
              cancelCountdown() // typing means you have taken over
              setText(event.target.value)
            }}
            onKeyDown={onKeyDown}
          />
          {listening && <VoiceWave level={level} />}
        </div>
        {voiceState === 'idle' && (text.trim().length > 0 || attachments.items.length > 0) && (
          <button
            className={styles.send}
            onClick={() => {
              cancelCountdown()
              void send()
            }}
            disabled={
              busy || draft.loading || !!draft.error || attachments.loading || attachments.busy
            }
            aria-label={
              canAttach && session.state === 'working' ? 'Queue message' : en.composer.send
            }
            title={
              canAttach && session.state === 'working'
                ? 'Queue after current response'
                : en.composer.send
            }
          >
            ↵
          </button>
        )}
        <button
          className={styles.mic}
          data-state={voiceState}
          onClick={toggleMic}
          disabled={draft.loading || micDisabled || voiceState === 'transcribing'}
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
