import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { acceleratorFrom, acceleratorLabel } from '../../shared/accelerator'
import { AgentSettings } from './AgentSettings'
import { SESSION_WINDOW_HOURS, type Settings, type SettingsPatch } from '../../shared/settings'
import { PROVIDERS, providerName } from '../../shared/providers'
import type { SttStatus } from '../../shared/stt'
import { en } from '../i18n/en'
import { Tip } from '../panel/Tip'
import { HoverChoice } from './HoverChoice'
import { windowLabel } from '../lib/format'
import styles from './Settings.module.css'

interface SettingsViewProps {
  currentAgentProvider?: 'claude' | 'codex'
  providerLocked?: boolean
  settings: Settings
  stt: SttStatus
  version: string
  /** "Workspace" chosen (or tapped again): open the picker to choose which workspace. */
  onPickWorkspace: () => void
  onOpenMemory: () => void
}

/** Every setting in one compact list, inside the panel's own card. Changes save immediately. */
export function SettingsView({
  settings,
  stt,
  version,
  onPickWorkspace,
  onOpenMemory,
  providerLocked,
  currentAgentProvider,
}: SettingsViewProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({})
  const [savingProviders, setSavingProviders] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)

  const save = async (patch: SettingsPatch) => {
    const key = Object.keys(patch)[0] as keyof Settings
    const result = await window.threadlight.updateSettings(patch)
    setErrors((current) => ({ ...current, [key]: result.ok ? undefined : result.reason }))
    return result.ok
  }

  return (
    <div className={styles.view}>
      <Group label={en.sources.title}>
        <Row label="Threads from" error={errors.enabledProviders}>
          <span className={styles.segmented} role="group" aria-label={en.sources.title}>
            {PROVIDERS.map((provider) => (
              <button
                key={provider}
                role="switch"
                aria-checked={settings.enabledProviders.includes(provider)}
                disabled={providerLocked || savingProviders}
                onClick={async () => {
                  setSavingProviders(true)
                  try {
                    await save({
                      enabledProviders: settings.enabledProviders.includes(provider)
                        ? settings.enabledProviders.filter((p) => p !== provider)
                        : [...settings.enabledProviders, provider],
                    })
                  } finally {
                    setSavingProviders(false)
                  }
                }}
              >
                <span className={styles.providerCheck} aria-hidden="true">
                  {settings.enabledProviders.includes(provider) ? '✓' : ''}
                </span>
                {providerName(provider)}
              </button>
            ))}
          </span>
        </Row>
        {!settings.enabledProviders.length && <p className={styles.footer}>{en.sources.paused}</p>}
      </Group>
      <AgentSettings key={settings.agentProvider} settings={settings} save={save} />

      <Group label={en.settings.voice}>
        <Row label={en.settings.voiceTarget} error={errors.voiceMode}>
          <HoverChoice
            label={en.settings.voiceTarget}
            value={settings.voiceMode}
            disabled={savingVoice}
            options={[
              { value: 'local-stt', label: en.settings.localStt },
              { value: 'gpt-live', label: en.settings.gptLive },
            ]}
            onChange={async (voiceMode) => {
              setSavingVoice(true)
              try {
                await save({ voiceMode })
              } finally {
                setSavingVoice(false)
              }
            }}
          />
        </Row>
        {settings.voiceMode === 'local-stt' && (
          <p className={styles.footer}>{en.settings.localSttHint}</p>
        )}
        {settings.voiceMode === 'gpt-live' &&
          (currentAgentProvider ?? settings.agentProvider) !== 'codex' && (
            <p className={styles.error}>{en.settings.gptLiveNeedsCodex}</p>
          )}
        {settings.voiceMode === 'local-stt' && (
          <Row label={en.settings.localDestination} error={errors.voiceTarget}>
            <HoverChoice
              label={en.settings.localDestination}
              value={settings.voiceTarget}
              options={[
                { value: 'agent', label: en.settings.agentConversation },
                { value: 'thread', label: en.settings.threadMessage },
              ]}
              onChange={(voiceTarget) => save({ voiceTarget })}
            />
          </Row>
        )}
        <Row label={en.settings.talkHotkey} error={errors.talkHotkey}>
          <span className={styles.pair}>
            <HotkeyField
              value={settings.talkHotkey}
              onChange={(talkHotkey) => save({ talkHotkey })}
            />
            {settings.voiceMode === 'local-stt' && (
              <HoverChoice
                label={en.settings.talkMode}
                value={settings.talkMode}
                options={[
                  { value: 'toggle', label: en.settings.toggle },
                  { value: 'hold', label: en.settings.hold },
                ]}
                onChange={(talkMode) => save({ talkMode })}
              />
            )}
          </span>
        </Row>
        {settings.voiceMode === 'local-stt' && settings.voiceTarget === 'thread' && (
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
        )}
        {settings.voiceMode === 'local-stt' && (
          <Row label={en.settings.speechModel} tight>
            <ModelStatus stt={stt} />
          </Row>
        )}
      </Group>

      <Group label={en.settings.panel}>
        <Row label="Hover help" error={errors.hoverHelp}>
          <Segmented
            value={settings.hoverHelp}
            options={[
              { value: 'tour', label: 'Tour', title: 'Show all available help immediately.' },
              { value: 'info', label: 'Info', title: 'Show normal hover information.' },
              { value: 'off', label: 'Off', title: 'Hide hover information and help.' },
            ]}
            onChange={(hoverHelp) => save({ hoverHelp })}
          />
        </Row>
        <Row label={en.settings.openOn}>
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
            options={SESSION_WINDOW_HOURS.map((hours) => ({
              value: hours,
              label: windowLabel(hours),
            }))}
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

      <Group label="Shared Spaces">
        <Row label="Ideas, brainstorms and handoffs">
          <button className={styles.small} onClick={onOpenMemory}>
            Open
          </button>
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

      <p className={`${styles.footer} ${styles.attribution}`}>
        {en.settings.footer(version)}
        <br />
        {en.settings.notMadeBy}
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
  /** Pulls the row up a little, closing the gap above it. */
  tight?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={props.tight ? `${styles.row} ${styles.rowTight}` : styles.row}
      aria-disabled={props.disabled || undefined}
    >
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

export function Stepper(props: {
  value: number
  min: number
  max: number
  format: (n: number) => string
  disabled?: boolean
  compact?: boolean
  label?: string
  /** Explains the number itself when it is hovered. */
  valueTip?: string
  onChange: (n: number) => void
}) {
  const { value, min, max, format, disabled = false, onChange } = props
  return (
    <span
      className={[styles.stepper, disabled && styles.off, props.compact && styles.compact]
        .filter(Boolean)
        .join(' ')}
      role={props.label ? 'group' : undefined}
      aria-label={props.label}
    >
      <button
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={props.label ? `Decrease ${props.label}` : en.settings.less}
      >
        −
      </button>
      {props.valueTip ? (
        <Tip className={styles.value} text={props.valueTip}>
          {format(value)}
        </Tip>
      ) : (
        <span className={styles.value}>{format(value)}</span>
      )}
      <button
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={props.label ? `Increase ${props.label}` : en.settings.more}
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
