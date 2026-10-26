import { COMMUNICATION_SERVER, communicationTools } from '../../shared/communication'
import type { ThreadReadConnection } from '../threadRead/server'
import type { JsonObject } from '../sessions/json'
import { claudeReadConfig } from './threadReadTools'

export function communicationConfig(
  reader?: ThreadReadConnection,
  connection?: ThreadReadConnection,
): string {
  const config = reader ? JSON.parse(claudeReadConfig(reader)) : { mcpServers: {} }
  if (connection)
    config.mcpServers[COMMUNICATION_SERVER] = {
      type: 'http',
      url: connection.endpoint,
      headers: { Authorization: `Bearer ${connection.token}` },
    }
  return JSON.stringify(config)
}
export function codexCommunicationConfig(config: JsonObject, connection: ThreadReadConnection) {
  ;(config.mcp_servers as JsonObject)[COMMUNICATION_SERVER] = {
    url: connection.endpoint,
    http_headers: { Authorization: `Bearer ${connection.token}` },
    enabled: true,
    default_tools_approval_mode: 'prompt',
    enabled_tools: communicationTools.map((t) => t.name),
    tools: Object.fromEntries(
      communicationTools.map((t) => [t.name, { approval_mode: 'approve' }]),
    ),
  }
}
export const builtinCommunicationTool = (name: string) =>
  communicationTools.some((t) => name === `mcp__${COMMUNICATION_SERVER}__${t.name}`)
