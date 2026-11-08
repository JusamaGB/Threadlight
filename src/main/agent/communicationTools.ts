import { COMMUNICATION_SERVER, communicationTools } from '../../shared/communication'
import type { ThreadReadConnection } from '../threadRead/server'
import type { JsonObject } from '../sessions/json'
import { claudeReadConfig } from './threadReadTools'

export function communicationConfig(
  reader?: ThreadReadConnection,
  connection?: ThreadReadConnection,
): string {
  const config = reader ? JSON.parse(claudeReadConfig(reader)) : { mcpServers: {} }
  if (connection) {
    if (!connection.mcp) throw new Error('Authenticated communication proxy is required.')
    config.mcpServers[COMMUNICATION_SERVER] = { type: 'stdio', ...connection.mcp }
  }
  return JSON.stringify(config)
}
export function codexCommunicationConfig(config: JsonObject, connection: ThreadReadConnection) {
  if (!connection.mcp) throw new Error('Authenticated communication proxy is required.')
  ;(config.mcp_servers as JsonObject)[COMMUNICATION_SERVER] = {
    ...connection.mcp,
    enabled: true,
    default_tools_approval_mode: 'prompt',
    enabled_tools: communicationTools.map((t) => t.name),
    tools: Object.fromEntries(
      communicationTools.map((t) => [
        t.name,
        { approval_mode: t.name.endsWith('_process') ? 'prompt' : 'approve' },
      ]),
    ),
  }
}
export const builtinCommunicationTool = (name: string) =>
  communicationTools.some(
    (t) => !t.name.endsWith('_process') && name === `mcp__${COMMUNICATION_SERVER}__${t.name}`,
  )
