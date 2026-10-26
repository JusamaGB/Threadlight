import styles from './Motion.module.css'

export function VoicePresence({
  label,
  caption,
  microphone,
  provisional = false,
}: {
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
      <p className={styles.caption} data-provisional={provisional || undefined}>
        {caption || '\u00a0'}
      </p>
    </section>
  )
}
