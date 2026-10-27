import type { ThreadReadConnection } from '../threadRead/server'
import { THREAD_READ_SERVER, THREAD_READ_TOOLS } from '../../shared/threadRead'
import type { JsonObject } from '../sessions/json'

export function codexReadConfig(config: JsonObject, connection: ThreadReadConnection): void {
  const servers = config.mcp_servers as JsonObject
  servers[THREAD_READ_SERVER] = {
    url: connection.endpoint,
    http_headers: { Authorization: `Bearer ${connection.token}` },
    enabled: true,
    default_tools_approval_mode: 'prompt',
    enabled_tools: [...THREAD_READ_TOOLS],
    tools: Object.fromEntries(
      THREAD_READ_TOOLS.map((name) => [name, { approval_mode: 'approve' }]),
    ),
  }
}
export function claudeReadConfig(connection: ThreadReadConnection): string {
  return JSON.stringify({
    mcpServers: {
      [THREAD_READ_SERVER]: {
        type: 'http',
        url: connection.endpoint,
        headers: { Authorization: `Bearer ${connection.token}` },
      },
    },
  })
}
export const builtinReadTool = (name: string) =>
  THREAD_READ_TOOLS.some((tool) => name === `mcp__${THREAD_READ_SERVER}__${tool}`)
