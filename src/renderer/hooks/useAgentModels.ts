import { useEffect, useState } from 'react'
import type { AgentModel } from '../../shared/agent'
import type { SettingsPatch } from '../../shared/settings'

/** Settings and the Agent footer use the same runtime model catalog. */
export function useAgentModels(enabled: boolean) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ models: AgentModel[]; error: string | null } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void window.threadlight.agentModels().then(
      (found) => {
        if (live) setResult(found)
      },
      () => {
        if (live) setResult({ models: [], error: 'Could not discover Codex models.' })
      },
    )
    return () => {
      live = false
    }
  }, [enabled, version])
  return {
    models: result?.models ?? [],
    error: result?.error ?? null,
    loading: enabled && !result,
    reload: () => {
      setResult(null)
      setVersion((value) => value + 1)
    },
  }
}

/** Changing a model replaces the previous model's effort with the new model's default. */
export function codexModelSettings(model: AgentModel): SettingsPatch {
  return { agentCodexModel: model.id, agentCodexReasoning: model.defaultEffort }
}
