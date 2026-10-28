// Packaged into both providers. No dependencies, credential files or provider APIs.
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const provider = process.argv[process.argv.indexOf('--provider') + 1]
if (!['claude', 'codex'].includes(provider)) throw new Error('Choose --provider claude or codex.')
const url = new URL(process.env.THREADLIGHT_MEMORY_URL || 'http://127.0.0.1:47618/mcp')
if (
  url.protocol !== 'http:' ||
  url.hostname !== '127.0.0.1' ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== '/mcp'
)
  throw new Error('Threadlight memory must use an HTTP 127.0.0.1 /mcp endpoint.')
const protocol = JSON.parse(
  readFileSync(new URL('./memory-protocol.json', import.meta.url), 'utf8'),
)
const connections = new Map()
const wakeups = new Map()
const wakeupRequests = new Map()
const objectSchema = (properties, required) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const connectionId = {
  type: 'string',
  format: 'uuid',
  description: 'The connection ID returned for THIS chat. Never reuse another chat’s ID.',
}
const tools = [
  ...(provider === 'claude'
    ? ['enable', 'disable'].map((action) => ({
        name: `memory_${action}_wakeup`,
        description: `${action === 'enable' ? 'Enable automatic inbox notifications for THIS human-enrolled Claude runtime when the user requests it. Runtime credentials stay private to this bridge; the app reports release-gate readiness.' : 'Disable automatic inbox notifications for this enrolled runtime.'}`,
        inputSchema: objectSchema({ connectionId }, ['connectionId']),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      }))
    : []),
  {
    name: 'memory_connect',
    description:
      'Request human-approved access to Threadlight shared memory. First call with a descriptive label, then show the verification code. After approval call with connectionId. This does not read memory or grant access.',
    inputSchema: objectSchema(
      { label: { type: 'string', minLength: 1, maxLength: 80 }, connectionId },
      [],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'memory_disconnect',
    description: 'Release this connection and revoke its memory access.',
    inputSchema: objectSchema({ connectionId }, ['connectionId']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  ...protocol.tools.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: { ...tool.inputSchema.properties, connectionId },
      required: [...(tool.inputSchema.required || []), 'connectionId'],
    },
  })),
]
async function post(path, body, secret, timeout = 5000) {
  let response
  try {
    response = await fetch(new URL(path, url), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(
      'Threadlight is unavailable or the response was lost. Open Threadlight and check the connection. Do not blindly retry a write; inspect memory first using its operationId.',
    )
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 15_000_000) throw new Error('Memory response too large. Narrow the request.')
    chunks.push(chunk)
  }
  let result
  try {
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error(
      'Threadlight returned an incompatible response. Update the application and plugin together.',
    )
  }
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Connection is unapproved, expired or revoked. Request fresh access in Threadlight.'
        : result.error || 'Threadlight rejected the request.',
    )
  return result
}
const content = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  isError: false,
})
async function call(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Use an arguments object.')
  if (name === 'memory_connect') {
    if (Object.keys(args).some((k) => !['connectionId', 'label'].includes(k)))
      throw new Error('Unknown connection option.')
    let record
    if (args.connectionId) {
      record = connections.get(args.connectionId)
      if (!record)
        throw new Error(
          'This bridge does not own that connection. Request a new one for this chat.',
        )
    } else {
      if (typeof args.label !== 'string' || !args.label.trim() || args.label.length > 80)
        throw new Error('Provide a short descriptive label for this chat.')
      if (connections.size >= 64)
        throw new Error('Disconnect unused connections before creating another.')
      record = {
        id: randomUUID(),
        secret: randomBytes(32).toString('hex'),
        label: args.label.trim(),
        provider,
      }
      connections.set(record.id, record)
    }
    try {
      const status = await post('/plugin/connect', {
        action: args.connectionId ? 'status' : 'request',
        ...record,
      })
      return content({
        ...status,
        connectionId: record.id,
        next:
          status.state === 'pending'
            ? 'Show this verification code to the human. They approve it in Threadlight → Shared memory → choose a space → Agent access. Then check this connectionId once. Do not poll.'
            : status.state === 'rejected'
              ? 'Access was rejected or revoked. Do not request again without the human’s direction.'
              : 'Call memory_briefing with this connectionId before reading or publishing.',
      })
    } catch (e) {
      throw new Error(`${e.message} Connection ID for checking this request: ${record.id}`, {
        cause: e,
      })
    }
  }
  const { connectionId: id, ...arguments_ } = args
  const record = connections.get(id)
  if (!record)
    throw new Error('No connection for this chat. Call memory_connect with a label first.')
  if (name === 'memory_enable_wakeup' || name === 'memory_disable_wakeup') {
    if (provider !== 'claude' || Object.keys(arguments_).length)
      throw new Error('Use only this Claude connectionId.')
    const ticket = (wakeupRequests.get(id) ?? 0) + 1
    wakeupRequests.set(id, ticket)
    clearInterval(wakeups.get(id))
    wakeups.delete(id)
    if (name === 'memory_disable_wakeup')
      return content(await post(`/plugin/runtime/${id}`, { action: 'unregister' }, record.secret))
    const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET,
      token = process.env.CLAUDE_CODE_MESSAGING_TOKEN
    if (!socket || !token)
      throw new Error(
        'This Claude runtime did not export an inbox. Reopen this chat with the current plugin; do not resume it in a second process.',
      )
    const register = () =>
      post(`/plugin/runtime/${id}`, { action: 'register', socket, token }, record.secret)
    const result = await register()
    if (wakeupRequests.get(id) !== ticket)
      return content({ enabled: false, reason: 'A newer wakeup setting superseded this request.' })
    // Lease renewal does not send prompts. A lost lease never replays a task.
    let renewing = false
    const timer = setInterval(async () => {
      if (renewing) return
      renewing = true
      try {
        await register()
      } catch {
        clearInterval(timer)
        if (wakeups.get(id) === timer) wakeups.delete(id)
      } finally {
        renewing = false
      }
    }, 20000)
    timer.unref()
    wakeups.set(id, timer)
    return content(result)
  }
  if (name === 'memory_disconnect') {
    wakeupRequests.set(id, (wakeupRequests.get(id) ?? 0) + 1)
    clearInterval(wakeups.get(id))
    wakeups.delete(id)
    await post('/plugin/connect', { action: 'disconnect', id, secret: record.secret })
    connections.delete(id)
    return content({ disconnected: true })
  }
  if (!protocol.tools.some((t) => t.name === name)) throw new Error('Unknown memory tool.')
  const result = await post(
    `/plugin/mcp/${id}`,
    {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: arguments_ },
    },
    record.secret,
    name === 'threadlight_read_question' ? 35000 : 5000,
  )
  if (result.error) throw new Error(result.error.message)
  return result.result
}
async function handle(message) {
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    throw new Error('Invalid JSON-RPC request')
  if (message.id === undefined) return
  if (message.method === 'initialize')
    return {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: `Threadlight ${provider} memory`, version: '1.1.0' },
      instructions:
        'Use memory_connect to request access for THIS chat, show the verification code, then wait for human approval in Threadlight. Every memory call requires its explicit connectionId. No implicit current connection. ' +
        protocol.instructions,
    }
  if (message.method === 'ping') return {}
  if (message.method === 'tools/list') return { tools }
  if (message.method === 'tools/call') {
    try {
      return await call(message.params?.name, message.params?.arguments ?? {})
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
  }
  throw new Error('Method not supported')
}
let buffer = '',
  running = 0
const write = (value) => process.stdout.write(JSON.stringify(value) + '\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  if (Buffer.byteLength(buffer) > 15_000_000) {
    process.stderr.write('MCP input too large.\n')
    process.exit(1)
  }
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })
      continue
    }
    if (running >= 16) {
      if (msg?.id !== undefined)
        write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: 'Too many concurrent requests' },
        })
      continue
    }
    running++
    void Promise.resolve()
      .then(() => handle(msg))
      .then((result) => {
        if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, result })
      })
      .catch(() =>
        write({
          jsonrpc: '2.0',
          id: msg?.id ?? null,
          error: { code: -32600, message: 'Invalid or unsupported request' },
        }),
      )
      .finally(() => running--)
  }
})
process.stdin.on('end', () => {
  for (const timer of wakeups.values()) clearInterval(timer)
  // Best effort only; app-side expiry/revocation remains authoritative after a crash.
  void Promise.allSettled(
    [...connections.values()].map(({ id, secret }) =>
      post('/plugin/connect', { action: 'disconnect', id, secret }),
    ),
  ).finally(() => process.exit(0))
})
process.stdin.on('error', () => process.exit(1))
process.stdout.on('error', () => process.exit(1))
