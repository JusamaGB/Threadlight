import { SPACE_CONTEXT_SERVER, SPACE_CONTEXT_TOOLS } from '../../shared/spaceContext'
import type { ThreadReadConnection } from '../threadRead/server'
import type { JsonObject } from '../sessions/json'
import { isObject } from '../sessions/json'

export function claudeSpaceConfig(connection: ThreadReadConnection) {
  return JSON.stringify({
    mcpServers: {
      [SPACE_CONTEXT_SERVER]: {
        type: 'http',
        url: connection.endpoint,
        headers: { Authorization: `Bearer ${connection.token}` },
      },
    },
  })
}
export function codexSpaceConfig(config: JsonObject, connection: ThreadReadConnection) {
  config.mcp_servers = {
    ...Object.fromEntries(
      Object.entries(isObject(config.mcp_servers) ? config.mcp_servers : {}).map(
        ([name, value]) => [name, { ...(isObject(value) ? value : {}), enabled: false }],
      ),
    ),
    [SPACE_CONTEXT_SERVER]: {
      url: connection.endpoint,
      http_headers: { Authorization: `Bearer ${connection.token}` },
      enabled: true,
      required: true,
      enabled_tools: SPACE_CONTEXT_TOOLS,
      default_tools_approval_mode: 'prompt',
      tools: Object.fromEntries(
        SPACE_CONTEXT_TOOLS.map((name) => [name, { approval_mode: 'approve' }]),
      ),
    },
  }
  config['features.shell_tool'] = false
  config['features.unified_exec'] = false
  config['features.apply_patch_freeform'] = false
  config['tools.view_image'] = false
  config.web_search = 'disabled'
}
export const builtinSpaceTool = (name: string) =>
  SPACE_CONTEXT_TOOLS.some((tool) => name === `mcp__${SPACE_CONTEXT_SERVER}__${tool}`)
