import { authenticatedMcp } from './mcpTransport'
import {
  SPACE_CONTEXT_SERVER,
  SPACE_CONTEXT_TOOLS,
  SPACE_TOOL_POLICY,
} from '../../shared/spaceContext'
import type { ThreadReadConnection } from '../threadRead/server'
import type { JsonObject } from '../sessions/json'
import { isObject } from '../sessions/json'

export function claudeSpaceConfig(connection: ThreadReadConnection) {
  return JSON.stringify({
    mcpServers: {
      [SPACE_CONTEXT_SERVER]: {
        type: 'stdio',
        ...authenticatedMcp(connection),
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
      ...authenticatedMcp(connection),
      enabled: true,
      required: true,
      enabled_tools: SPACE_CONTEXT_TOOLS,
      default_tools_approval_mode: 'prompt',
      tools: Object.fromEntries(
        SPACE_CONTEXT_TOOLS.filter(scopedAuthority).map((name) => [
          name,
          { approval_mode: 'approve' },
        ]),
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
  SPACE_CONTEXT_TOOLS.some(
    (tool) => scopedAuthority(tool) && name === `mcp__${SPACE_CONTEXT_SERVER}__${tool}`,
  )

// Notes/drafts are bounded project writes. Runtime tools independently enforce the
// exact human-approved graph revision and live policy, never generic execution.
const scopedAuthority = (tool: keyof typeof SPACE_TOOL_POLICY) =>
  ['read', 'note-write', 'draft-write', 'authorized-runtime'].includes(SPACE_TOOL_POLICY[tool])
