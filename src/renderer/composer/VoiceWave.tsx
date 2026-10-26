import { SILENT_AUDIO } from '../../shared/motion'
import { ElectricMotion } from '../motion/ElectricMotion'
import { en } from '../i18n/en'
import styles from './Composer.module.css'

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
