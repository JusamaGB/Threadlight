import { useState } from 'react'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { AgentIdentity } from '../panel/AgentIdentity'
import { Tip } from '../panel/Tip'
import { en } from '../i18n/en'
import styles from './Settings.module.css'

export function AgentSettings({
  settings,
  save: persist,
}: {
  settings: Settings
  save: (patch: SettingsPatch) => Promise<boolean>
}) {
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
      </div>
      <label className={styles.row}>
        <span className={styles.text}>
          <Tip
            className={styles.label}
            text={en.settings.help.agentLifetime.info}
            tourHelp={en.settings.help.agentLifetime.tour}
          >
            {en.settings.agentLifetime}
          </Tip>
        </span>
        <select
          aria-label="Agent conversation lifetime"
          value={settings.agentLifetimeMinutes}
          onChange={(e) => void save({ agentLifetimeMinutes: Number(e.target.value) })}
        >
          {[...new Set([10, 60, 240, 0, settings.agentLifetimeMinutes])].map((n) => (
            <option key={n} value={n}>
              {en.settings.lifetime(n)}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}
