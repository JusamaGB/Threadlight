import { useEffect, useRef, useState, type ReactNode } from 'react'

import { acceleratorFrom, acceleratorLabel } from '../../shared/accelerator'
import type { Settings, SettingsPatch } from '../../shared/settings'
import type { SttStatus } from '../../shared/stt'
import { en } from '../i18n/en'
import styles from './Settings.module.css'

interface SettingsViewProps {
  settings: Settings
  stt: SttStatus
  version: string
}

const HOUR_CHOICES = [6, 12, 24, 72, 168]

/** Every setting in one compact list, inside the panel's own card. Changes save immediately. */
export function SettingsView({ settings, stt, version }: SettingsViewProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({})

  const save = async (patch: SettingsPatch) => {
    const key = Object.keys(patch)[0] as keyof Settings
    const result = await window.threadlight.updateSettings(patch)
    setErrors((current) => ({ ...current, [key]: result.ok ? undefined : result.reason }))
    return result.ok
  }

  return (
    <div className={styles.view}>
      <Group label={en.settings.voice}>
        <Row
          label={en.settings.talkHotkey}
          hint={en.settings.talkHotkeyHint}
          error={errors.talkHotkey}
        >
          <HotkeyField
            value={settings.talkHotkey}
            onChange={(talkHotkey) => save({ talkHotkey })}
          />
        </Row>
        <Row label={en.settings.countdown} hint={en.settings.countdownHint}>
          <Stepper
            value={settings.voiceCountdownSeconds}
            min={1}
            max={10}
            format={(n) => `${n} s`}
            onChange={(voiceCountdownSeconds) => save({ voiceCountdownSeconds })}
          />
        </Row>
        <Row label={en.settings.speechModel}>
          <ModelStatus stt={stt} />
        </Row>
      </Group>

      <Group label={en.settings.panel}>
        <Row label={en.settings.openOn} hint={en.settings.openOnHint}>
          <Segmented
            value={settings.openOn}
            options={[
              { value: 'hover', label: en.settings.hover },
              { value: 'click', label: en.settings.click },
            ]}
            onChange={(openOn) => save({ openOn })}
          />
        </Row>
        <Row label={en.settings.dotPosition}>
          <button className={styles.small} onClick={() => window.threadlight.resetDotPosition()}>
            {en.settings.reset}
          </button>
        </Row>
      </Group>

      <Group label={en.settings.sessions}>
        <Row label={en.settings.listWindow}>
          <Segmented
            value={settings.listWindowHours}
            options={HOUR_CHOICES.map((hours) => ({ value: hours, label: hoursLabel(hours) }))}
            onChange={(listWindowHours) => save({ listWindowHours })}
          />
        </Row>
        <Row label={en.settings.maxSessions}>
          <Stepper
            value={settings.maxSessions}
            min={3}
            max={25}
            format={String}
            onChange={(maxSessions) => save({ maxSessions })}
          />
        </Row>
      </Group>

      <Group label={en.settings.app}>
        <Row label={en.settings.launchAtSignIn} error={errors.launchAtSignIn}>
          <Toggle
            on={settings.launchAtSignIn}
            label={en.settings.launchAtSignIn}
            onChange={(launchAtSignIn) => save({ launchAtSignIn })}
          />
        </Row>
      </Group>

      <p className={styles.footer}>{en.settings.footer(version)}</p>
    </div>
  )
}

function hoursLabel(hours: number): string {
  return hours % 24 === 0 && hours > 24 ? `${hours / 24}d` : `${hours}h`
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupLabel}>{label}</h3>
      {children}
    </section>
  )
}

function Row(props: {
  label: string
  hint?: string
  error?: string | undefined
  children: ReactNode
}) {
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span className={styles.label}>{props.label}</span>
        {props.error ? (
          <span className={styles.error}>{props.error}</span>
        ) : (
          props.hint && <span className={styles.hint}>{props.hint}</span>
        )}
      </div>
      <div className={styles.control}>{props.children}</div>
    </div>
  )
}

/** Click, press the keys you want, done. Esc cancels. */
function HotkeyField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => Promise<boolean>
}) {
  const [capturing, setCapturing] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // The latest callback, without restarting the capture (and re-pausing the hotkey) every render.
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!capturing) return
    // The current hotkey is paused so its own keys reach this field.
    window.threadlight.setHotkeyCapture(true)
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') return finish()
      const result = acceleratorFrom(event)
      if (!result) return // only modifiers so far
      if ('problem' in result) return setHint(en.settings.hotkeyProblems[result.problem])
      // Resume the old hotkey first, so saving checks the new one against other apps.
      window.threadlight.setHotkeyCapture(false)
      setCapturing(false)
      setHint(null)
      void change.current(result.accelerator)
    }
    const finish = () => {
      window.threadlight.setHotkeyCapture(false)
      setCapturing(false)
      setHint(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.threadlight.setHotkeyCapture(false)
    }
  }, [capturing])

  return (
    <button
      className={capturing ? `${styles.key} ${styles.capturing}` : styles.key}
      onClick={() => setCapturing(!capturing)}
      title={capturing ? en.settings.pressKeys : en.settings.changeHotkey}
    >
      {capturing ? (hint ?? en.settings.pressKeys) : acceleratorLabel(value)}
    </button>
  )
}

function Stepper(props: {
  value: number
  min: number
  max: number
  format: (n: number) => string
  onChange: (n: number) => void
}) {
  const { value, min, max, format, onChange } = props
  return (
    <span className={styles.stepper}>
      <button
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={en.settings.less}
      >
        −
      </button>
      <span className={styles.value}>{format(value)}</span>
      <button
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={en.settings.more}
      >
        +
      </button>
    </span>
  )
}

function Segmented<T extends string | number>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <span className={styles.segmented} role="radiogroup">
      {props.options.map((option) => (
        <button
          key={String(option.value)}
          role="radio"
          aria-checked={option.value === props.value}
          onClick={() => option.value !== props.value && props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean
  label: string
  onChange: (on: boolean) => void
}) {
  return (
    <button
      className={styles.toggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

function ModelStatus({ stt }: { stt: SttStatus }) {
  switch (stt.state) {
    case 'ready':
      return <span className={styles.status}>{en.settings.modelReady}</span>
    case 'loading':
      return <span className={styles.status}>{en.settings.modelLoading}</span>
    case 'downloading':
      return (
        <span className={styles.status}>
          {en.settings.modelDownloading(Math.round(stt.progress * 100))}
        </span>
      )
    default:
      return (
        <button className={styles.small} onClick={() => window.threadlight.downloadStt()}>
          {stt.state === 'error' ? en.voice.retry : en.settings.download}
        </button>
      )
  }
}
