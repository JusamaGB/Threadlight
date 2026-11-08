import { SILENT_AUDIO } from '../../shared/motion'
import { ElectricMotion } from '../motion/ElectricMotion'
import { en } from '../i18n/en'
import styles from './Composer.module.css'

export function MutedMicWave() {
  return (
    <svg
      className={styles.mutedWave}
      viewBox="0 0 44 18"
      role="img"
      aria-label="Live microphone muted"
    >
      <path d="M2 9h6l3-4 4 9 4-12 5 14 4-11 3 7 3-3h8" />
    </svg>
  )
}

/** Compact instance of the same material used by the voice stage and thinking indicator. */
export function VoiceWave({ level }: { level: number }) {
  return (
    <span className={styles.wave}>
      <ElectricMotion
        label={en.voice.listening}
        snapshot={{ mode: 'listening', input: { ...SILENT_AUDIO, level }, output: SILENT_AUDIO }}
      />
    </span>
  )
}
