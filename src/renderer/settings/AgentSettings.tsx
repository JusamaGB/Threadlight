import { useEffect, useState } from 'react'
import type { AgentModel } from '../../shared/agent'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { en } from '../i18n/en'
import styles from './Settings.module.css'

export function AgentSettings({
  settings,
  save: persist,
}: {
  settings: Settings
  save: (patch: SettingsPatch) => Promise<boolean>
}) {
  const [models, setModels] = useState<AgentModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(settings.agentProvider === 'codex')
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState(false)
  const save = async (patch: SettingsPatch) => {
    try {
      setSaveError((await persist(patch)) ? null : 'Could not save Agent settings. Try again.')
    } catch {
      setSaveError('Could not save Agent settings. Try again.')
    }
  }
  useEffect(() => {
    let live = true
    if (settings.agentProvider === 'codex') {
      void window.threadlight
        .agentModels()
        .then((result) => {
          if (!live) return
          setModels(result.models)
          setError(result.error)
        })
        .catch(() => {
          if (live) setError('Could not discover Codex models.')
        })
        .finally(() => {
          if (live) setLoading(false)
        })
    }
    return () => {
      live = false
    }
  }, [settings.agentProvider, refresh])
  const selected = models.find((m) =>
    settings.agentCodexModel ? m.id === settings.agentCodexModel : m.isDefault,
  )
  const visible = models.filter(
    (m) =>
      (hidden || !m.hidden || m.id === selected?.id) &&
      (m.id === selected?.id || `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase())),
  )
  return (
    <section className={styles.group}>
      <h3 className={styles.groupLabel}>{en.settings.agent}</h3>
      {saveError && (
        <p role="alert" className={styles.error}>
          {saveError}
        </p>
      )}
      <label className={styles.row}>
        <span className={styles.text}>Provider</span>
        <select
          aria-label="Agent provider"
          value={settings.agentProvider}
          onChange={(e) => void save({ agentProvider: e.target.value as 'claude' | 'codex' })}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      {settings.agentProvider === 'claude' ? (
        <label className={styles.row}>
          <span className={styles.text}>Worker · Haiku handles conversation</span>
          <select
            aria-label="Claude worker"
            value={settings.agentWorker}
            onChange={(e) => void save({ agentWorker: e.target.value as 'opus' | 'sonnet' })}
          >
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
          </select>
        </label>
      ) : (
        <>
          <div className={styles.agentModels}>
            <input
              aria-label="Search Codex models"
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className={styles.small}
              disabled={loading}
              onClick={() => {
                setLoading(true)
                setError(null)
                setRefresh((v) => v + 1)
              }}
            >
              {loading ? 'Checking…' : 'Refresh models'}
            </button>
            <select
              aria-label="Codex agent model"
              disabled={loading || !!error}
              value={settings.agentCodexModel ?? selected?.id ?? ''}
              onChange={(e) => {
                const model = models.find((m) => m.id === e.target.value)
                if (model)
                  void save({ agentCodexModel: model.id, agentCodexReasoning: model.defaultEffort })
              }}
            >
              {!selected && (
                <option value={settings.agentCodexModel ?? ''}>
                  {settings.agentCodexModel
                    ? `${settings.agentCodexModel} · unavailable`
                    : 'Choose a model'}
                </option>
              )}
              {visible.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.hidden ? ' · additional' : ''}
                </option>
              ))}
            </select>
            <label className={styles.hint}>
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
              />{' '}
              Show additional models
            </label>
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {!!selected?.efforts.length && (
            <label className={styles.row}>
              <span className={styles.text}>Reasoning</span>
              <select
                aria-label="Agent reasoning"
                value={settings.agentCodexReasoning ?? selected.defaultEffort ?? ''}
                onChange={(e) => void save({ agentCodexReasoning: e.target.value || null })}
              >
                {settings.agentCodexReasoning &&
                  !selected.efforts.includes(settings.agentCodexReasoning) && (
                    <option value={settings.agentCodexReasoning}>
                      {settings.agentCodexReasoning} · unavailable
                    </option>
                  )}
                {!selected.defaultEffort && !settings.agentCodexReasoning && (
                  <option value="">Runtime default</option>
                )}
                {selected.efforts.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <label className={styles.row}>
        <span className={styles.text}>{en.settings.agentLifetime}</span>
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
