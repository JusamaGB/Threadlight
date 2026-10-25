import styles from './Dot.module.css'

interface DotProps {
  /** True while any session is working: the dot turns red and pulses. */
  working: boolean
}

export function Dot({ working }: DotProps) {
  return (
    <div className={styles.frame}>
      <div
        className={working ? `${styles.dot} ${styles.working}` : styles.dot}
        role="status"
        aria-label={working ? 'A Claude session is working' : 'No Claude session is working'}
      />
    </div>
  )
}
