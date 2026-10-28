import styles from './Motion.module.css'

export function VoicePresence({
  label,
  caption,
  compact = false,
  provisional = false,
}: {
  label: string
  caption: string
  compact?: boolean
  provisional?: boolean
}) {
  return (
    <section
      className={styles.presence}
      aria-label="Voice activity"
      data-compact={compact || undefined}
    >
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
