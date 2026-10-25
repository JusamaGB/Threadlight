import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { acceleratorFrom, acceleratorLabel } from '../../shared/accelerator'
import type { AgentApp } from '../../shared/agent'
import type { Settings, SettingsPatch } from '../../shared/settings'
import type { SttStatus } from '../../shared/stt'
import { en } from '../i18n/en'
import { windowLabel } from '../lib/format'
import styles from './Settings.module.css'

interface SettingsViewProps {
  providerLocked?: boolean
  settings: Settings
  stt: SttStatus
  version: string
  /** "Workspace" chosen (or tapped again): open the picker to choose which workspace. */
  onPickWorkspace: () => void
}

const HOUR_CHOICES = [6, 12, 24, 72, 168]
/** How long an agent conversation stays open after its last reply; 0 means until ended. */
const LIFETIME_CHOICES = [10, 60, 240, 0]

/**
 * One switch per app the agent could use: the connected apps Claude Code sees, checked once
 * when Settings opens (it takes a few seconds). Off means the agent cannot use it at all.
 */
function AgentApps({ off, onChange }: { off: string[]; onChange: (off: string[]) => void }) {
  const [apps, setApps] = useState<AgentApp[] | null>(null)
  useEffect(() => {
    let live = true
    void window.threadlight.agentApps().then((found) => live && setApps(found))
    return () => {
      live = false
    }
  }, [])
  if (!apps) return <p className={styles.footer}>{en.settings.appsChecking}</p>
  if (apps.length === 0) return <p className={styles.footer}>{en.settings.appsNone}</p>
  return (
    <>
      {apps.map((app) => (
        <Row
          key={app.name}
          label={app.name.replace(/^claude\.ai /, '')}
          hint={app.status === 'connected' ? undefined : app.status}
        >
          <Toggle
            on={!off.includes(app.name)}
            label={app.name}
            onChange={(on) =>
              onChange(on ? off.filter((name) => name !== app.name) : [...off, app.name])
            }
          />
        </Row>
      ))}
    </>
  )
}

/** Every setting in one compact list, inside the panel's own card. Changes save immediately. */
export function SettingsView({
  settings,
  stt,
  version,
  onPickWorkspace,
  providerLocked,
}: SettingsViewProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({})

  const save = async (patch: SettingsPatch) => {
    const key = Object.keys(patch)[0] as keyof Settings
    const result = await window.threadlight.updateSettings(patch)
    setErrors((current) => ({ ...current, [key]: result.ok ? undefined : result.reason }))
    return result.ok
  }

  return (
    <div className={styles.view}>
      <Group label="Application">
        <Row label="Threads from" error={errors.provider}>
          <Segmented
            disabled={providerLocked}
            value={settings.provider}
            options={[
              { value: 'claude', label: 'Claude' },
              { value: 'codex', label: 'Codex' },
            ]}
            onChange={(provider) => save({ provider })}
          />
        </Row>
        {settings.provider === 'codex' && (
          <p className={styles.footer}>
            Live chats open in Codex. Install and trust the Threadlight Codex plugin to answer held
            cards here.
          </p>
        )}
      </Group>
      <Group label={en.settings.voice}>
        <Row label={en.settings.talkHotkey} error={errors.talkHotkey}>
          <span className={styles.pair}>
            <HotkeyField
              value={settings.talkHotkey}
              onChange={(talkHotkey) => save({ talkHotkey })}
            />
            <Segmented
              value={settings.talkMode}
              options={[
                { value: 'toggle', label: en.settings.toggle, title: en.settings.toggleHint },
                { value: 'hold', label: en.settings.hold, title: en.settings.holdHint },
              ]}
              separator="/"
              onChange={(talkMode) => save({ talkMode })}
            />
          </span>
        </Row>
        <Row label={en.settings.countdown}>
          <span className={styles.pair}>
            {/* Hold switches the countdown off: the seconds grey out until it is let go. */}
            <button
              className={settings.voiceHold ? `${styles.small} ${styles.on}` : styles.small}
              aria-pressed={settings.voiceHold}
              title={en.settings.holdSendHint}
              onClick={() => save({ voiceHold: !settings.voiceHold })}
            >
              {en.settings.holdSend}
            </button>
            <Stepper
              value={settings.voiceCountdownSeconds}
              min={1}
              max={10}
              format={(n) => `${n} s`}
              disabled={settings.voiceHold}
              onChange={(voiceCountdownSeconds) => save({ voiceCountdownSeconds })}
            />
          </span>
        </Row>
        <Row label={en.settings.speechModel}>
          <ModelStatus stt={stt} />
        </Row>
        <Row
          label={en.settings.openMic}
          disabled={settings.talkMode !== 'toggle'}
          hint={
            settings.talkMode !== 'toggle'
              ? en.settings.openMicNeedsToggle
              : stt.state === 'ready'
                ? en.settings.openMicHint
                : en.settings.openMicNeedsModel
          }
        >
          <Toggle
            on={settings.openMic}
            label={en.settings.openMic}
            onChange={(openMic) => save({ openMic })}
          />
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
        <Row label={en.settings.listMode}>
          <Segmented
            value={settings.listMode}
            options={[
              { value: 'recent', label: en.settings.listRecent },
              { value: 'workspace', label: en.settings.listWorkspace },
              { value: 'all', label: en.settings.listAll },
            ]}
            onChange={async (listMode) => {
              // Workspace needs a workspace: go straight to choosing one.
              if ((await save({ listMode })) && listMode === 'workspace') onPickWorkspace()
            }}
            onReselect={(listMode) => listMode === 'workspace' && onPickWorkspace()}
          />
        </Row>
        <Row label={en.settings.listWindow}>
          <Segmented
            value={settings.listWindowHours}
            options={HOUR_CHOICES.map((hours) => ({ value: hours, label: windowLabel(hours) }))}
            onChange={(listWindowHours) => save({ listWindowHours })}
          />
        </Row>
        {/* Only the Recent list has a length to choose; greyed out for Workspace and All. */}
        <Row label={en.settings.maxSessions} disabled={settings.listMode !== 'recent'}>
          <Stepper
            value={settings.maxSessions}
            min={3}
            max={25}
            format={String}
            disabled={settings.listMode !== 'recent'}
            onChange={(maxSessions) => save({ maxSessions })}
          />
        </Row>
      </Group>

      {settings.provider === 'claude' && (
        <Group label={en.settings.agent}>
          <Row label={en.settings.agentLifetime} hint={en.settings.agentLifetimeHint}>
            <Segmented
              value={settings.agentLifetimeMinutes}
              options={LIFETIME_CHOICES.map((minutes) => ({
                value: minutes,
                label: en.settings.lifetime(minutes),
              }))}
              onChange={(agentLifetimeMinutes) => save({ agentLifetimeMinutes })}
            />
          </Row>
          <Row label={en.settings.agentWorker} hint={en.settings.agentWorkerHint}>
            <Segmented
              value={settings.agentWorker}
              options={[
                { value: 'opus', label: 'Opus' },
                { value: 'sonnet', label: 'Sonnet' },
              ]}
              onChange={(agentWorker) => save({ agentWorker })}
            />
          </Row>
          <AgentApps
            off={settings.agentAppsOff}
            onChange={(agentAppsOff) => save({ agentAppsOff })}
          />
        </Group>
      )}

      <Group label={en.settings.app}>
        <Row label={en.settings.launchAtSignIn} error={errors.launchAtSignIn}>
          <Toggle
            on={settings.launchAtSignIn}
            label={en.settings.launchAtSignIn}
            onChange={(launchAtSignIn) => save({ launchAtSignIn })}
          />
        </Row>
      </Group>

      <p className={styles.footer}>
        {settings.provider === 'codex'
          ? `Threadlight ${version} · Unofficial, not made by OpenAI`
          : en.settings.footer(version)}
      </p>
    </div>
  )
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
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className={styles.row} aria-disabled={props.disabled || undefined}>
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
  disabled?: boolean
  onChange: (n: number) => void
}) {
  const { value, min, max, format, disabled = false, onChange } = props
  return (
    <span className={disabled ? `${styles.stepper} ${styles.off}` : styles.stepper}>
      <button
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={en.settings.less}
      >
        −
      </button>
      <span className={styles.value}>{format(value)}</span>
      <button
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={en.settings.more}
      >
        +
      </button>
    </span>
  )
}

function Segmented<T extends string | number>(props: {
  disabled?: boolean
  value: T
  options: { value: T; label: string; title?: string }[]
  /** Drawn between the options, e.g. "Toggle / Push to talk". */
  separator?: string
  onChange: (value: T) => void
  /** Tapping the option that is already chosen. */
  onReselect?: (value: T) => void
}) {
  return (
    <span
      className={props.separator ? `${styles.segmented} ${styles.separated}` : styles.segmented}
      role="radiogroup"
    >
      {props.options.map((option, index) => (
        <Fragment key={String(option.value)}>
          {index > 0 && props.separator && (
            <span className={styles.separator} aria-hidden="true">
              {props.separator}
            </span>
          )}
          <button
            role="radio"
            disabled={props.disabled}
            title={option.title}
            aria-checked={option.value === props.value}
            onClick={() =>
              option.value === props.value
                ? props.onReselect?.(option.value)
                : props.onChange(option.value)
            }
          >
            {option.label}
          </button>
        </Fragment>
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
