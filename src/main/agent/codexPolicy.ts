import type { AgentApp } from '../../shared/agent'
import { isObject, type JsonObject } from '../sessions/json'
import type { CodexTransport } from './codexClient'
import { pages } from './agentModels'

// config/read includes null defaults, which have no TOML representation in overrides.
function withoutNulls(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([key, v]) => [key, isObject(v) ? withoutNulls(v) : v]),
  )
}

/** Only configured MCP servers have a validated per-tool policy in this adapter.
 * Desktop plugins and apps may depend on its private executor; do not borrow that identity. */
export async function codexPolicy(
  client: CodexTransport,
  cwd: string,
  off: string[],
): Promise<{ config: JsonObject; apps: AgentApp[] }> {
  const read = await client.request('config/read', { includeLayers: false, cwd })
  if (!isObject(read.config)) throw new Error('Codex configuration discovery is unavailable.')
  const source = read.config
  const config: JsonObject = {
    'features.multi_agent': false,
    'features.apps': false,
    'features.hooks': false,
    'features.default_mode_request_user_input': true,
    apps: { _default: { enabled: false } },
    plugins: {},
    mcp_servers: {},
    approvals_reviewer: 'user',
  }
  const apps: AgentApp[] = []
  for (const [name, value] of Object.entries(
    isObject(source.mcp_servers) ? source.mcp_servers : {},
  )) {
    if (!isObject(value)) continue
    // Whole tables preserve literal server/tool names; RPC override keys are not TOML syntax.
    const policy = withoutNulls(value)
    policy.enabled = value.enabled !== false && !off.includes(name)
    policy.default_tools_approval_mode = 'prompt'
    policy.tools = Object.fromEntries(
      Object.entries(isObject(value.tools) ? value.tools : {}).map(([tool, setting]) => [
        tool,
        { ...(isObject(setting) ? setting : {}), approval_mode: 'prompt' },
      ]),
    )
    ;(config.mcp_servers as JsonObject)[name] = policy
    apps.push({
      name,
      status:
        value.enabled === false
          ? 'disabled in Codex'
          : 'configured · permission required for each tool',
      unavailable: value.enabled === false,
    })
  }
  for (const name of Object.keys(isObject(source.plugins) ? source.plugins : {})) {
    ;(config.plugins as JsonObject)[name] = { enabled: false }
    apps.push({
      name,
      status: 'unavailable · desktop plugin policy not verified',
      unavailable: true,
    })
  }
  for (const name of Object.keys(isObject(source.apps) ? source.apps : {})) {
    if (name === '_default') continue
    ;(config.apps as JsonObject)[name] = { enabled: false }
    apps.push({
      name,
      status: 'unavailable · desktop connector not exposed here',
      unavailable: true,
    })
  }
  return { config, apps }
}

export function verifyCodexPolicy(result: JsonObject, model: string): void {
  if (result.model !== model)
    throw new Error('Codex selected a different model. No message was sent.')
  if (
    result.approvalPolicy !== 'untrusted' ||
    result.approvalsReviewer !== 'user' ||
    !isObject(result.sandbox) ||
    result.sandbox.type !== 'readOnly'
  ) {
    throw new Error(
      'This Codex configuration cannot enforce the Agent approval policy. No message was sent.',
    )
  }
}

/** Inspect the effective thread inventory before inference; config intent alone is insufficient. */
export async function verifyCodexTools(
  client: CodexTransport,
  threadId: string,
  config: JsonObject,
): Promise<void> {
  const allowed = new Set(
    Object.entries(isObject(config.mcp_servers) ? config.mcp_servers : {})
      .filter(([, v]) => isObject(v) && v.enabled === true)
      .map(([name]) => name),
  )
  const servers = await pages(client, 'mcpServerStatus/list', {
    threadId,
    detail: 'toolsAndAuthOnly',
  })
  if (
    servers.some(
      (server) => !allowed.has(String(server.name)) && server.runtimeStatus !== 'disabled',
    )
  )
    throw new Error(
      'Codex exposed an integration outside the Agent app policy. No message was sent.',
    )
}
