import { APP_CONTROL_SERVER, controlTools } from '../../shared/appControl'
import type { ThreadReadConnection } from '../threadRead/server'
import type { JsonObject } from '../sessions/json'

export function controlConfig(config: string, connection?: ThreadReadConnection): string {
  if (!connection) return config
  const value = JSON.parse(config)
  value.mcpServers[APP_CONTROL_SERVER] = {
    type: 'http',
    url: connection.endpoint,
    headers: { Authorization: `Bearer ${connection.token}` },
  }
  return JSON.stringify(value)
}
export function codexControlConfig(config: JsonObject, connection: ThreadReadConnection) {
  ;(config.mcp_servers as JsonObject)[APP_CONTROL_SERVER] = {
    url: connection.endpoint,
    http_headers: { Authorization: `Bearer ${connection.token}` },
    enabled: true,
    default_tools_approval_mode: 'prompt',
    enabled_tools: controlTools.map((t) => t.name),
    // Writes are proposed, never executed, until the service receives the real Agent card decision.
    tools: Object.fromEntries(controlTools.map((t) => [t.name, { approval_mode: 'approve' }])),
  }
}
export const builtinControlTool = (name: string) =>
  controlTools.some((t) => name === `mcp__${APP_CONTROL_SERVER}__${t.name}`)
