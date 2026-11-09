import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { acceleratorFrom, acceleratorLabel } from '../../shared/accelerator'
import { Hotkeys } from './Hotkeys'
import { AgentSettings } from './AgentSettings'
import { KimiSettings } from './KimiSettings'
import { KimiWorkspace } from '../kimi/KimiWorkspace'
import { KIMI_PREVIEW_ENABLED } from '../../shared/releaseFeatures'
import { PerplexitySettings } from './PerplexitySettings'
import { AccountChatSettings } from './AccountChatSettings'
import {
  SESSION_WINDOW_HOURS,
  type Settings,
  type SettingsPatch,
  type ShownProvider,
} from '../../shared/settings'
import { ProviderChoices } from './ProviderChoices'
import type { SttStatus } from '../../shared/stt'
import { en } from '../i18n/en'
import { Tip } from '../panel/Tip'
import { HoverChoice } from './HoverChoice'
import { windowLabel } from '../lib/format'
import styles from './Settings.module.css'

interface SettingsViewProps {
  hotkeyProblem?: string | null
  currentAgentProvider?: 'claude' | 'codex'
  providerLocked?: boolean
  settings: Settings
  stt: SttStatus
  version: string
  /** "Workspace" chosen (or tapped again): open the picker to choose which workspace. */
  onPickWorkspace: () => void
}

/** Every setting in one compact list, inside the panel's own card. Changes save immediately. */
export function SettingsView(props: SettingsViewProps) {
  const [showKimi, setShowKimi] = useState(false)
  const kimiSelected = KIMI_PREVIEW_ENABLED && props.settings.shownProviders.includes('kimi')
  if (showKimi && !kimiSelected) setShowKimi(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!showKimi) returnFocus.current?.focus()
  }, [showKimi])
  return (
    <>
      {KIMI_PREVIEW_ENABLED && (
        <KimiWorkspace
          setup={props.settings.kimiSetup}
          visible={showKimi}
          onSettings={() => setShowKimi(false)}
        />
      )}
      <div style={showKimi ? { display: 'none' } : undefined}>
        <SettingsFields
          {...props}
          onOpenKimi={() => {
            returnFocus.current = document.activeElement as HTMLElement
            setShowKimi(true)
          }}
        />
      </div>
    </>
  )
}

function SettingsFields({
  settings,
  stt,
  version,
  onPickWorkspace,
  providerLocked,
  currentAgentProvider,
  hotkeyProblem,
  onOpenKimi,
}: SettingsViewProps & { onOpenKimi: () => void }) {
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({})
  const [savingProviders, setSavingProviders] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)
  const [savingRegions, setSavingRegions] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const save = async (patch: SettingsPatch) => {
    const key = Object.keys(patch)[0] as keyof Settings
    const result = await window.threadlight.updateSettings(patch)
    setErrors((current) => ({ ...current, [key]: result.ok ? undefined : result.reason }))
    return result.ok
  }

  return (
    <div className={styles.view}>
      <section className={styles.group}>
        <ProviderChoices
          label="Providers shown"
          options={[
            { value: 'claude', label: 'Claude', help: 'Claude Code threads.' },
            {
              value: 'codex',
              label: 'OpenAI',
              help: 'Codex work threads. Choose ChatGPT chats separately below.',
            },
            {
              value: 'perplexity',
              label: 'Perplexity',
              help: 'Perplexity Computer preview and connection settings.',
            },
            ...(KIMI_PREVIEW_ENABLED
              ? [
                  {
                    value: 'kimi' as const,
                    label: 'Kimi',
                    help: 'Kimi setup and workspace preview. Execution is not enabled yet.',
                  },
                ]
              : []),
          ]}
          selected={settings.shownProviders}
          disabled={providerLocked || savingProviders}
          onChange={(shownProviders: ShownProvider[]) =>
            void (async () => {
              setSavingProviders(true)
              try {
                await save({ shownProviders })
              } catch {
                setErrors((current) => ({
                  ...current,
                  shownProviders: 'Could not save providers.',
                }))
              } finally {
                setSavingProviders(false)
              }
            })()
          }
        />
        {errors.shownProviders && (
          <p className={styles.error} role="alert">
            {errors.shownProviders}
          </p>
        )}
        <div hidden={!settings.shownProviders.includes('perplexity')}>
          <PerplexitySettings />
        </div>
        <AccountChatSettings sources={settings.chatSources} save={save} />
      </section>
      <Group label="VS Code">
        <Row
          label="Ghost practice location"
          error={errors.ghostPracticeLocation}
          help={{
            info: 'Trace existing code in its current tab or an untitled copy. Matching keystrokes reveal the original syntax colours.',
          }}
        >
          <HoverChoice
            label="Ghost practice location"
            value={settings.ghostPracticeLocation}
            options={[
              { value: 'current', label: 'Current file' },
              { value: 'copy', label: 'Practice copy' },
            ]}
            onChange={(ghostPracticeLocation: Settings['ghostPracticeLocation']) =>
              save({ ghostPracticeLocation })
            }
          />
        </Row>
        <Row
          label="Spoken ghost walkthroughs"
          help={{
            info: 'Allow Live to explain each line when you start typing in a requested ghost walkthrough.',
          }}
          error={errors.spokenGhostWalkthroughs}
        >
          <Toggle
            label="Spoken ghost walkthroughs"
            on={settings.spokenGhostWalkthroughs}
            onChange={(spokenGhostWalkthroughs) => void save({ spokenGhostWalkthroughs })}
          />
        </Row>
        <Row
          label="Automatic Python suggestions"
          help={{
            info: 'Show suggestions as you type in trusted Python files with Live Coach 0.6.1 or later. Choose VS Code setting to follow your editor preference.',
          }}
          error={errors.pythonSuggestions}
        >
          <HoverChoice
            label="Automatic Python suggestions"
            value={settings.pythonSuggestions}
            options={[
              { value: 'editor', label: 'VS Code setting' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(pythonSuggestions: Settings['pythonSuggestions']) =>
              save({ pythonSuggestions })
            }
          />
        </Row>
      </Group>
      <AgentSettings key={settings.agentProvider} settings={settings} save={save} />
      {KIMI_PREVIEW_ENABLED && (
        <div hidden={!settings.shownProviders.includes('kimi')}>
          <KimiSettings
            key={JSON.stringify(settings.kimiSetup)}
            setup={settings.kimiSetup}
            save={save}
            onOpenWorkspace={onOpenKimi}
          />
        </div>
      )}

      <Group label={en.settings.voice}>
        <ProviderChoices
          label="Screen regions"
          showAll={false}
          disabled={savingRegions}
          selected={settings.screenRegionModes}
          options={[
            {
              value: 'live',
              label: 'In Live',
              help: 'Release Ctrl after a right-drag to send the region to the current Live Agent.',
            },
            {
              value: 'outside',
              label: 'Outside Live',
              help: 'Release Ctrl after a right-drag to start a new Agent conversation with the region.',
            },
          ]}
          onChange={async (screenRegionModes) => {
            setSavingRegions(true)
            try {
              await save({ screenRegionModes })
            } catch {
              setErrors((old) => ({ ...old, screenRegionModes: 'Could not save screen regions.' }))
            } finally {
              setSavingRegions(false)
            }
          }}
        />
        {errors.screenRegionModes && (
          <p role="alert" className={styles.error}>
            {errors.screenRegionModes}
          </p>
        )}
        {settings.screenRegionModes.includes('outside') && (
          <Row
            label="Speak reply"
            slim
            help={{
              info:
                settings.agentProvider === 'codex'
                  ? 'Read the answer in the GPT Live voice. Your microphone stays closed.'
                  : 'Read the Claude answer with your Windows voice. Your microphone stays closed.',
            }}
            error={errors.speakScreenReply}
          >
            <Toggle
              label="Speak outside-Live replies"
              on={settings.speakScreenReply}
              onChange={(speakScreenReply) => void save({ speakScreenReply })}
            />
          </Row>
        )}
        <Row
          label={en.settings.voiceTarget}
          help={en.settings.help.voiceTarget}
          error={errors.voiceMode}
        >
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
        {settings.voiceMode === 'gpt-live' &&
          (currentAgentProvider ?? settings.agentProvider) !== 'codex' && (
            <p className={styles.error}>{en.settings.gptLiveNeedsCodex}</p>
          )}
        {settings.voiceMode === 'local-stt' && (
          <Row
            label={en.settings.localDestination}
            help={en.settings.help.localDestination}
            error={errors.voiceTarget}
          >
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
        <Hotkeys settings={settings} problem={hotkeyProblem}>
          <Row
            label={en.settings.talkHotkey}
            help={en.settings.help.talkHotkey}
            error={errors.talkHotkey}
          >
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
        </Hotkeys>
        {settings.voiceMode === 'local-stt' && settings.voiceTarget === 'thread' && (
          <Row label={en.settings.countdown} help={en.settings.help.countdown}>
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
          <Row label={en.settings.speechModel} help={en.settings.help.speechModel} tight>
            <ModelStatus stt={stt} />
          </Row>
        )}
      </Group>

      <Group label={en.settings.sessions}>
        <Row label={en.settings.listMode} help={en.settings.help.list}>
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
        <Row label={en.settings.listWindow} help={en.settings.help.window}>
          <Segmented
            value={settings.listWindowHours}
            options={SESSION_WINDOW_HOURS.map((hours) => ({
              value: hours,
              label: windowLabel(hours),
            }))}
            onChange={(listWindowHours) => save({ listWindowHours })}
          />
        </Row>
        {/* Only the Recent list has a length to choose, so the row is not shown for the others. */}
        {settings.listMode === 'recent' && (
          <Row label={en.settings.listCount} help={en.settings.help.count}>
            <Stepper
              value={settings.maxSessions}
              min={3}
              max={50}
              format={String}
              onChange={(maxSessions) => save({ maxSessions })}
            />
          </Row>
        )}
      </Group>

      <Group label="Shared Spaces">
        <Row
          label="Add to .gitignore"
          help={{
            info: 'Offer an unchecked option when creating a shared space. Existing spaces and ignore rules stay as they are.',
          }}
          error={errors.sharedSpacesGitignore}
          slim
        >
          <Toggle
            on={settings.sharedSpacesGitignore}
            label="Add to .gitignore"
            onChange={(sharedSpacesGitignore) => save({ sharedSpacesGitignore })}
          />
        </Row>
      </Group>

      <Group label={en.settings.app}>
        <Row
          label={en.settings.hoverHelp}
          help={en.settings.help.hoverHelp}
          error={errors.hoverHelp}
        >
          <Segmented
            value={settings.hoverHelp}
            options={[
              { value: 'tour', label: 'Tour', title: 'Show all available help immediately.' },
              { value: 'info', label: 'Full', title: 'Show normal hover information.' },
              {
                value: 'teach',
                label: 'Teach',
                title: 'Explain concepts and the consequences of actions.',
              },
              { value: 'off', label: 'Off', title: 'Hide hover information and help.' },
            ]}
            onChange={(hoverHelp) => save({ hoverHelp })}
          />
        </Row>
        <Row label={en.settings.openOn} help={en.settings.help.openOn}>
          <Segmented
            value={settings.openOn}
            options={[
              { value: 'hover', label: en.settings.hover },
              { value: 'click', label: en.settings.click },
            ]}
            onChange={(openOn) => save({ openOn })}
          />
        </Row>
        <Row label={en.settings.dotPosition} help={en.settings.help.dot}>
          <button className={styles.small} onClick={() => window.threadlight.resetDotPosition()}>
            {en.settings.reset}
          </button>
        </Row>
        <Row label={en.settings.restart} help={en.settings.help.restart}>
          <button
            className={`${styles.small} ${restarting ? styles.on : ''}`}
            aria-label={restarting ? en.settings.restarting : en.settings.restartButton}
            disabled={restarting}
            onClick={() => {
              setRestarting(true)
              window.threadlight.restartApp()
            }}
          >
            <span role="status">
              {restarting ? en.settings.restarting : en.settings.restartButton}
            </span>
          </button>
        </Row>
        <Row
          label={en.settings.launchAtSignIn}
          help={en.settings.help.launch}
          error={errors.launchAtSignIn}
          slim
        >
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
        {en.settings.attribution}
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
  /** Hover help: `info` always, `tour` only in Tour mode. */
  help?: { info: string; tour?: string }
  hint?: string
  error?: string | undefined
  disabled?: boolean
  /** Pulls the row up a little, closing the gap above it. */
  tight?: boolean
  /** A single-line row only as tall as its control, so a group's label sits close above it. */
  slim?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={[styles.row, props.tight && styles.rowTight, props.slim && styles.rowSlim]
        .filter(Boolean)
        .join(' ')}
      aria-disabled={props.disabled || undefined}
    >
      <div className={styles.text}>
        {props.help ? (
          <Tip className={styles.label} text={props.help.info} tourHelp={props.help.tour}>
            {props.label}
          </Tip>
        ) : (
          <span className={styles.label}>{props.label}</span>
        )}
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
