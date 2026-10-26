import styles from './Motion.module.css'

export function VoicePresence({
  label,
  caption,
  inactiveMicrophone = false,
  provisional = false,
}: {
  label: string
  caption: string
  inactiveMicrophone?: boolean
  provisional?: boolean
}) {
  return (
    <section className={styles.presence} aria-label="Voice activity">
      <div className={styles.status}>
        <span role="status">
          {label}
          {inactiveMicrophone ? ' - No active Mic' : ''}
        </span>
      </div>
      {caption && (
        <p className={styles.caption} data-provisional={provisional || undefined}>
          {caption}
        </p>
      )}
    </section>
  )
}
