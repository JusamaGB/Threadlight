import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ThreadComposerContext } from '../panel/ThreadComposer'
import { en } from '../i18n/en'
import { ComposerInput } from './ComposerInput'
import { ComposerMic } from './ComposerMic'
import { VoiceWave } from './VoiceWave'
import styles from './Composer.module.css'

/** Caller-owned drafts and delivery, using the app-wide composer and panel microphone. */
export function AnswerComposer({
  id,
  label,
  value,
  disabled,
  sendDisabled = disabled,
  sendLabel = 'Submit typed answer',
  maxLength,
  placeholder = 'Or write your own response',
  className,
  onChange,
  onSend,
  onActivityChange,
}: {
  id: string
  label: string
  value: string
  disabled: boolean
  sendDisabled?: boolean
  sendLabel?: string
  maxLength?: number
  placeholder?: string
  className?: string
  onChange: (text: string) => void
  onSend: () => void
  onActivityChange: (active: boolean) => void
}) {
  const voice = useContext(ThreadComposerContext)?.dictation
  const state = voice?.active === id ? voice.state : 'idle'
  const busy = state !== 'idle'
  const [askDownload, setAskDownload] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const latest = useRef({ id, value, disabled, onChange })
  useLayoutEffect(() => {
    latest.current = { id, value, disabled, onChange }
  }, [id, value, disabled, onChange])
  const cancel = voice?.cancel
  useLayoutEffect(() => () => cancel?.(id), [cancel, id])
  useEffect(() => {
    if (disabled) cancel?.(id)
  }, [cancel, disabled, id])
  useEffect(() => {
    onActivityChange(busy)
    return () => onActivityChange(false)
  }, [busy, onActivityChange])
  const stt = voice?.stt
  return (
    <div className={className ?? styles.answerComposer} data-shared-composer="">
      {askDownload && stt && stt.state !== 'ready' && (
        <div className={styles.download}>
          {stt.state === 'downloading' ? (
            <span>{en.voice.downloading}</span>
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
      {voice?.active === id && voice.error && (
        <p className={styles.error} role="alert">
          {voice.error}
        </p>
      )}
      <ComposerInput
        embedded
        inputRef={box}
        input={{
          'aria-label': label,
          value,
          disabled,
          maxLength,
          placeholder:
            state === 'listening'
              ? en.voice.listening
              : state === 'transcribing'
                ? en.voice.transcribing
                : placeholder,
          onChange: (event) => onChange(event.target.value),
        }}
        entryContent={state === 'listening' && <VoiceWave level={voice?.level ?? 0} />}
        sendDisabled={sendDisabled || busy}
        sendLabel={sendLabel}
        onSend={onSend}
        trailing={
          <ComposerMic
            state={state}
            disabled={
              disabled ||
              !voice ||
              voice.disabled ||
              (voice.state !== 'idle' && voice.active !== id)
            }
            onClick={() => {
              if (!voice) return
              if (stt?.state !== 'ready') return setAskDownload(true)
              voice.toggle(id, (text) => {
                const current = latest.current
                if (current.id !== id || current.disabled) return
                current.onChange(
                  (current.value.trim() ? `${current.value.trimEnd()} ${text}` : text).slice(
                    0,
                    maxLength,
                  ),
                )
                box.current?.focus()
              })
            }}
          />
        }
      />
    </div>
  )
}
