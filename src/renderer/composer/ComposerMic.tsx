import type { VoiceState } from '../hooks/useVoice'
import { en } from '../i18n/en'
import styles from './Composer.module.css'

/** The microphone control shared by message and answer composers. */
export function ComposerMic({
  state,
  disabled,
  onClick,
}: {
  state: VoiceState
  disabled: boolean
  onClick: () => void
}) {
  const label = state === 'listening' ? en.voice.stop : en.voice.start
  return (
    <button
      type="button"
      className={styles.mic}
      data-state={state}
      disabled={disabled || state === 'transcribing'}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
        <rect x="3.5" y="0.75" width="5" height="8" rx="2.5" />
        <path d="M1.25 6.5a4.75 4.75 0 0 0 9.5 0M6 11.25v2" fill="none" />
      </svg>
    </button>
  )
}
