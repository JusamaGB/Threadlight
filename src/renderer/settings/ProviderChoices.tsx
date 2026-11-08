import { Tip } from '../panel/Tip'
import styles from './Settings.module.css'

/** Shared compact multi-select: All is a shortcut, individual choices stay independent. */
export function ProviderChoices<T extends string>({
  label,
  options,
  selected,
  disabled,
  showAll = true,
  onChange,
}: {
  label: string
  options: { value: T; label: string; help?: string }[]
  selected: T[]
  disabled?: boolean
  showAll?: boolean
  onChange: (values: T[]) => void
}) {
  const all = options.every((option) => selected.includes(option.value))
  return (
    <div role="group" aria-label={label}>
      <div className={styles.providerHeading}>
        <h3 className={styles.groupLabel}>{label}</h3>
        {showAll && (
          <button
            className={styles.textChoice}
            aria-label={`All ${label.toLowerCase()}`}
            aria-pressed={all}
            disabled={disabled}
            onClick={() => onChange(all ? [] : options.map((option) => option.value))}
          >
            All
          </button>
        )}
      </div>
      <div className={`${styles.segmented} ${styles.providerChoices}`}>
        {options.map((option) => (
          <Tip
            as="button"
            key={option.value}
            text={option.help ?? ''}
            role="switch"
            aria-checked={selected.includes(option.value)}
            disabled={disabled}
            onClick={() =>
              onChange(
                selected.includes(option.value)
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value],
              )
            }
          >
            <span className={styles.providerCheck} aria-hidden="true">
              {selected.includes(option.value) ? '✓' : ''}
            </span>
            {option.label}
          </Tip>
        ))}
      </div>
    </div>
  )
}
