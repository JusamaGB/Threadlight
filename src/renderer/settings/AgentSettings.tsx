import { BrowserAccessSettings } from './BrowserAccessSettings'
import { useState, type ReactNode } from 'react'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { VOICE_PACES, VOICE_PACE } from '../../shared/voicePace'
import { AgentIdentity } from '../panel/AgentIdentity'
import { Tip } from '../panel/Tip'
import { HoverChoice } from './HoverChoice'
import { en } from '../i18n/en'
import styles from './Settings.module.css'

export function AgentSettings({
  settings,
  save: persist,
  identity,
}: {
  identity?: ReactNode
  settings: Settings
  save: (patch: SettingsPatch) => Promise<boolean>
}) {
  const pace = settings.agentVoicePace ?? 'normal'
  const paceHint = 'Applies to the next call or spoken screen reply.'
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = async (patch: SettingsPatch) => {
    try {
      setSaveError((await persist(patch)) ? null : 'Could not save Agent settings. Try again.')
    } catch {
      setSaveError('Could not save Agent settings. Try again.')
    }
  }
  return (
    <section className={styles.group}>
      <h3 className={styles.groupLabel}>
        <Tip text={en.settings.help.agent.info} tourHelp={en.settings.help.agent.tour}>
          {en.settings.agent}
        </Tip>
      </h3>
      {saveError && (
        <p role="alert" className={styles.error}>
          {saveError}
        </p>
      )}
      <div className={styles.agentSelection} role="group" aria-label="Agent settings">
        {identity ?? (
          <AgentIdentity
            provider={settings.agentProvider}
            model={
              settings.agentProvider === 'codex' ? settings.agentCodexModel : settings.agentWorker
            }
            reasoning={settings.agentProvider === 'codex' ? settings.agentCodexReasoning : null}
            hasConversation={false}
            settings={settings}
            onError={setSaveError}
            appearance="settings"
            saveSettings={persist}
          />
        )}
        {/* How long the conversation lasts sits in the same row as provider, model and effort and
            works like them: hover to list the other choices, click to hold the menu open. */}
        <HoverChoice
          label="Agent conversation lifetime"
          title={en.settings.help.agentLifetime.info}
          appearance="text"
          value={String(settings.agentLifetimeMinutes)}
          options={[...new Set([10, 60, 240, 0, settings.agentLifetimeMinutes])].map((n) => ({
            value: String(n),
            label: en.settings.lifetime(n),
          }))}
          onChange={(minutes) => save({ agentLifetimeMinutes: Number(minutes) })}
        />
      </div>
      <div className={styles.voicePaceRow}>
        <label htmlFor="agent-voice-pace">Voice pace</label>
        <input
          id="agent-voice-pace"
          type="range"
          min={0}
          max={VOICE_PACES.length - 1}
          step={1}
          value={VOICE_PACES.indexOf(pace)}
          aria-valuetext={VOICE_PACE[pace].label}
          aria-description={paceHint}
          title={paceHint}
          onChange={(event) =>
            void save({ agentVoicePace: VOICE_PACES[event.currentTarget.valueAsNumber] })
          }
        />
        {pace === 'normal' ? (
          <span>{VOICE_PACE[pace].label}</span>
        ) : (
          <button
            type="button"
            aria-label="Reset voice pace to Normal"
            title="Reset voice pace to Normal"
            onClick={() => void save({ agentVoicePace: 'normal' })}
          >
            {VOICE_PACE[pace].label}
          </button>
        )}
      </div>
      <label className={styles.row}>
        <span>Show spoken replies in waveform pill</span>
        <button
          type="button"
          role="switch"
          className={styles.toggle}
          aria-label="Show spoken replies in waveform pill"
          aria-checked={settings.spokenReplyCompanion}
          onClick={() => void save({ spokenReplyCompanion: !settings.spokenReplyCompanion })}
        >
          <span />
        </button>
      </label>
      <BrowserAccessSettings />
    </section>
  )
}
