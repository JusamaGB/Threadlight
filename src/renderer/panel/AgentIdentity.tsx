import { useState, type MouseEvent } from 'react'
import type { AgentProvider } from '../../shared/agent'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { codexModelSettings, useAgentModels } from '../hooks/useAgentModels'
import { ContextMenu, type MenuItem } from './ContextMenu'
import styles from './Panel.module.css'

type Field = 'provider' | 'model' | 'effort'
type Menu = { field: Field; anchor: HTMLButtonElement; x: number; y: number }

/** The labels describe the current conversation; choices save settings for the next one. */
export function AgentIdentity({
  provider,
  model,
  reasoning,
  hasConversation,
  settings,
  onError,
}: {
  provider: AgentProvider | null
  model: string | null
  reasoning: string | null
  hasConversation: boolean
  settings: Settings | null
  onError: (message: string | null) => void
}) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [additional, setAdditional] = useState(false)
  const [saving, setSaving] = useState(false)
  const activeProvider = provider ?? settings?.agentProvider ?? 'claude'
  const { models, error, loading, reload } = useAgentModels(activeProvider === 'codex')
  const selected = models.find((candidate) =>
    model ? candidate.id === model : candidate.isDefault,
  )
  const configured = models.find((candidate) =>
    settings?.agentCodexModel ? candidate.id === settings.agentCodexModel : candidate.isDefault,
  )
  const save = async (patch: SettingsPatch) => {
    setSaving(true)
    try {
      const result = await window.threadlight.updateSettings(patch)
      onError(result.ok ? null : result.reason)
    } catch {
      onError('Could not save Agent settings. Try again.')
    } finally {
      setSaving(false)
    }
  }
  const open = (field: Field, event: MouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget
    const box = anchor.getBoundingClientRect()
    setMenu({ field, anchor, x: box.left, y: box.bottom })
  }
  const close = () => {
    setMenu(null)
    menu?.anchor.focus()
  }
  const note = (label: string): MenuItem[] => [{ label, disabled: true, onSelect: () => {} }]
  let items: MenuItem[] = []
  if (menu?.field === 'provider') {
    items = (['claude', 'codex'] as const).map((value) => ({
      label: value === 'codex' ? 'Codex' : 'Claude',
      disabled: settings?.agentProvider === value,
      onSelect: () => void save({ agentProvider: value }),
    }))
  } else if (menu?.field === 'model' && activeProvider === 'claude') {
    items = (['opus', 'sonnet'] as const).map((value) => ({
      label: value === 'opus' ? 'Opus' : 'Sonnet',
      disabled: settings?.agentProvider === 'claude' && settings.agentWorker === value,
      onSelect: () => void save({ agentProvider: 'claude', agentWorker: value }),
    }))
  } else if (menu) {
    if (loading) items = note('Reading Codex models…')
    else if (error)
      items = [
        ...note(error),
        {
          label: 'Retry',
          onSelect: () => {
            reload()
            setMenu(menu)
          },
        },
      ]
    else if (menu.field === 'model') {
      items = models
        .filter((candidate) => additional || !candidate.hidden || candidate.id === selected?.id)
        .map((candidate) => ({
          label: candidate.name + (candidate.hidden ? ' · additional' : ''),
          disabled: settings?.agentProvider === 'codex' && configured?.id === candidate.id,
          onSelect: () => void save({ agentProvider: 'codex', ...codexModelSettings(candidate) }),
        }))
      if (!items.length) items = note('No Codex models available.')
      if (
        !additional &&
        models.some((candidate) => candidate.hidden && candidate.id !== selected?.id)
      ) {
        items.push({
          label: 'Show additional models',
          onSelect: () => {
            setAdditional(true)
            setMenu(menu)
          },
        })
      }
    } else if (selected?.efforts.length) {
      items = selected.efforts.map((effort) => ({
        label: effort,
        disabled:
          settings?.agentProvider === 'codex' &&
          configured?.id === selected.id &&
          (settings.agentCodexReasoning ?? selected.defaultEffort) === effort,
        onSelect: () =>
          void save({
            agentProvider: 'codex',
            agentCodexModel: selected.id,
            agentCodexReasoning: effort,
          }),
      }))
    } else items = note('No effort options available for this model.')
  }
  const labels = {
    provider: activeProvider === 'codex' ? 'Codex' : 'Claude',
    model: model ?? (hasConversation ? 'Model not recorded' : 'Runtime default'),
    effort: reasoning ?? 'Effort',
  }
  const control = (field: Field) => (
    <button
      className={styles.agentSetting}
      data-field={field}
      aria-label={`Agent ${field}: ${labels[field]}`}
      title={`Choose ${field}${hasConversation ? ' for your next conversation' : ''}`}
      aria-haspopup="menu"
      aria-expanded={menu?.field === field}
      disabled={!settings || saving}
      onClick={(event) => open(field, event)}
    >
      {labels[field]}
    </button>
  )
  return (
    <>
      {control('provider')}
      <span aria-hidden="true"> · </span>
      {control('model')}
      {activeProvider === 'codex' && (
        <>
          <span aria-hidden="true"> · </span>
          {control('effort')}
        </>
      )}
      {menu && (
        <ContextMenu
          key={`${menu.field}:${items.map((item) => item.label).join('|')}`}
          label={`Agent ${menu.field}`}
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          items={items}
          onClose={close}
        />
      )}
    </>
  )
}
