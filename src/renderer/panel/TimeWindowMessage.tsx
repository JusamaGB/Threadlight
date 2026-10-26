import { useState } from 'react'
import { SESSION_WINDOW_HOURS } from '../../shared/settings'
import { en } from '../i18n/en'
import { windowLabel } from '../lib/format'
import { ContextMenu } from './ContextMenu'
import styles from './Panel.module.css'

/** The empty list edits the same activity-window setting as Settings. */
export function TimeWindowMessage({ hours }: { hours: number }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (listWindowHours: number) => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.threadlight.updateSettings({ listWindowHours })
      if (!result.ok) setError(result.reason)
    } catch {
      setError('Could not save the time frame.')
    } finally {
      setSaving(false)
    }
  }
  const at = anchor?.getBoundingClientRect()
  return (
    <>
      {en.nothingInWindow('')}
      <button
        className={styles.timeWindowChoice}
        disabled={saving}
        aria-label={`Time frame: ${windowLabel(hours)}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        title="Change time frame"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {windowLabel(hours)}
      </button>
      {error && (
        <span className={styles.timeWindowError} role="alert">
          {error}
        </span>
      )}
      {anchor && at && (
        <ContextMenu
          label="Time frame"
          anchor={anchor}
          x={at.left}
          y={at.bottom}
          onClose={() => setAnchor(null)}
          items={SESSION_WINDOW_HOURS.map((value) => ({
            label: windowLabel(value),
            disabled: value === hours,
            onSelect: () => void save(value),
          }))}
        />
      )}
    </>
  )
}
