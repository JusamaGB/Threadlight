import type { AgentModel } from '../../shared/agent'
import { isObject, str, type JsonObject } from '../sessions/json'
import type { CodexTransport } from './codexClient'

/** Repeated cursors and unbounded catalogs are protocol errors, not a reason to loop forever. */
export async function pages(
  client: CodexTransport,
  method: string,
  params: JsonObject = {},
): Promise<JsonObject[]> {
  const rows: JsonObject[] = [],
    seen = new Set<string>()
  let cursor: string | null = null
  do {
    const result = await client.request(method, { ...params, cursor, limit: 100 })
    if (!Array.isArray(result.data))
      throw new Error(`Codex does not support ${method} in this version.`)
    rows.push(...result.data.filter(isObject))
    cursor = str(result.nextCursor)
    if (cursor && (seen.has(cursor) || seen.size >= 100))
      throw new Error('Codex pagination did not finish.')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return rows
}

export async function discoverModels(client: CodexTransport): Promise<AgentModel[]> {
  const rows = await pages(client, 'model/list', { includeHidden: true })
  const models = rows
    .filter((r) => !Array.isArray(r.inputModalities) || r.inputModalities.includes('text'))
    .flatMap((r) => {
      const id = str(r.model)
      if (!id || id.length > 200) return []
      const efforts = Array.isArray(r.supportedReasoningEfforts)
        ? r.supportedReasoningEfforts
            .filter(isObject)
            .map((e) => str(e.reasoningEffort))
            .filter((e): e is string => !!e && e.length <= 40)
        : []
      return [
        {
          id,
          name: str(r.displayName) ?? id,
          hidden: r.hidden === true,
          isDefault: r.isDefault === true,
          efforts,
          defaultEffort: efforts.includes(str(r.defaultReasoningEffort) ?? '')
            ? str(r.defaultReasoningEffort)
            : null,
        },
      ]
    })
  return [...new Map(models.map((m) => [m.id, m])).values()]
}

export function chooseModel(
  models: AgentModel[],
  id: string | null,
  effort: string | null,
): { model: string; reasoning: string | null } {
  const selected = id ? models.find((m) => m.id === id) : models.find((m) => m.isDefault)
  if (!selected)
    throw new Error(
      id
        ? `The selected Codex model (${id}) is unavailable. Choose a model in Settings.`
        : 'Choose a Codex model in Settings.',
    )
  if (effort && !selected.efforts.includes(effort))
    throw new Error('The selected reasoning level is unavailable for this model. Update Settings.')
  return { model: selected.id, reasoning: effort ?? selected.defaultEffort }
}
