import styles from './Motion.module.css'

export function VoicePresence({
  label,
  caption,
  provisional = false,
}: {
  label: string
  caption: string
  provisional?: boolean
}) {
  return (
    <section className={styles.presence} aria-label="Voice activity">
      <div className={styles.status}>
        <span role="status">{label}</span>
      </div>
      {caption && (
        <p className={styles.caption} data-provisional={provisional || undefined}>
          {caption}
        </p>
      )}
    </section>
  )
}
