import type { RefObject } from 'react'
import type { MotionSnapshot } from '../../shared/motion'
import { ElectricMotion } from './ElectricMotion'
import styles from './Motion.module.css'

export function VoicePresence({
  source,
  label,
  caption,
  microphone,
  provisional = false,
}: {
  source: RefObject<MotionSnapshot>
  label: string
  caption: string
  microphone: boolean
  provisional?: boolean
}) {
  return (
    <section className={styles.presence} aria-label="Voice activity">
      <div className={styles.status}>
        <span role="status">{label}</span>
        <span>{microphone ? 'Microphone on' : 'Microphone off'}</span>
      </div>
      <div className={styles.stage}>
        <ElectricMotion source={source} label={label} />
      </div>
      <p className={styles.caption} data-provisional={provisional || undefined}>
        {caption || '\u00a0'}
      </p>
    </section>
  )
}
