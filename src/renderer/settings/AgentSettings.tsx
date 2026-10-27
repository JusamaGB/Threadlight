import { useState } from 'react'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { AgentIdentity } from '../panel/AgentIdentity'
import { Tip } from '../panel/Tip'
import { HoverChoice } from './HoverChoice'
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
    </section>
  )
}
