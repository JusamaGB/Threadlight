// Synthetic stdio MCP server. Its only mutation is a marker in the supplied test directory.
import { createInterface } from 'node:readline'
import { writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
const directory = process.argv[2]
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'initialize')
    return reply(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'threadlight-synthetic', version: '1.0.0' },
    })
  if (message.method === 'tools/list')
    return reply(message.id, {
      tools: [
        {
          name: 'write_marker',
          description: 'Write the synthetic approval-test marker. No input needed.',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        {
          name: 'read_marker',
          description: 'Read the synthetic approval-test marker.',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        },
      ],
    })
  if (message.method === 'tools/call') {
    if (message.params.name === 'write_marker') {
      writeFileSync(join(directory, 'approved-marker.txt'), 'SYNTHETIC_APPROVED')
      appendFileSync(join(directory, 'writes.txt'), 'write\n')
      return reply(message.id, { content: [{ type: 'text', text: 'Synthetic marker written.' }] })
    }
    if (message.params.name === 'read_marker') {
      let text = 'No marker'
      try {
        text = readFileSync(join(directory, 'approved-marker.txt'), 'utf8')
      } catch {
        /* The test starts without a marker. */
      }
      return reply(message.id, { content: [{ type: 'text', text }] })
    }
  }
  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Unknown synthetic method' },
    }) + '\n',
  )
})
