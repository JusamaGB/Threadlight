import { acceleratorLabel } from '../../shared/accelerator'
import styles from './Composer.module.css'

/** The same compact shortcut label in Agent and Brainstorm composer rows. */
export function ComposerShortcut({
  shortcut,
  label = 'Microphone shortcut',
  onClick,
  active = false,
}: {
  shortcut: string
  label?: string
  onClick?: () => void
  active?: boolean
}) {
  const text = acceleratorLabel(shortcut)
  return onClick ? (
    <button
      type="button"
      className={styles.shortcut}
      aria-label={label}
      aria-pressed={active}
      title={`${label} (${text})`}
      onClick={onClick}
    >
      <kbd>{text}</kbd>
    </button>
  ) : (
    <kbd className={styles.shortcut} title={label}>
      {text}
    </kbd>
  )
}
