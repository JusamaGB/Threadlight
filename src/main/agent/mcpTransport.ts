import type { ThreadReadConnection } from '../threadRead/server'
export function authenticatedMcp(connection: ThreadReadConnection) {
  if (!connection.mcp) throw new Error('Authenticated local MCP proxy is required.')
  return connection.mcp
}
