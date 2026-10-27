import { describe, expect, it } from 'vitest'

import { parseMcpList } from '../src/main/agent/agentApps'
import { appToolPrefix } from '../src/main/agent/agentRun'

describe('connected apps', () => {
  it('reads `claude mcp list`, one app a line, with a plain status', () => {
    const output = [
      'Checking MCP server health…',
      '',
      'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✓ Connected',
      'claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - √ Connected',
      'higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ! Needs authentication',
      'broken: node server.js - ✗ Failed to connect',
    ].join('\n')
    expect(parseMcpList(output)).toEqual([
      { name: 'claude.ai Gmail', status: 'connected' },
      { name: 'claude.ai Google Drive', status: 'connected' },
      { name: 'higgsfield', status: 'needs sign-in' },
      { name: 'broken', status: 'failed to connect' },
    ])
  })

  it('names an app’s tools the way Claude Code does', () => {
    expect(appToolPrefix('claude.ai Gmail')).toBe('mcp__claude_ai_Gmail')
    expect(appToolPrefix('claude.ai Google Calendar')).toBe('mcp__claude_ai_Google_Calendar')
  })
})
