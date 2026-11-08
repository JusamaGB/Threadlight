// Authenticated local transport shared by both plugins and owned stdio MCP clients.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export function memoryAuthFile() {
  return (
    process.env.THREADLIGHT_MEMORY_AUTH_FILE ||
    join(
      process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
      'Threadlight',
      'memory-auth',
      'server.key',
    )
  )
}
export function readMemoryKey() {
  const value = readFileSync(memoryAuthFile(), 'utf8')
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid Threadlight server credential.')
  return Buffer.from(value, 'hex')
}
export function memoryEndpoint(endpoint) {
  const url = new URL(endpoint)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Threadlight requires a local HTTP endpoint.')
  return url
}
function seal(key, aad, value) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('base64'),
  }
}
function open(key, aad, envelope) {
  if (
    !envelope ||
    !/^[a-f0-9]{24}$/.test(envelope.iv) ||
    !/^[a-f0-9]{32}$/.test(envelope.tag) ||
    typeof envelope.data !== 'string'
  )
    throw new Error('Invalid authenticated response.')
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'))
  cipher.setAAD(Buffer.from(aad))
  cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'))
  return JSON.parse(
    Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString(
      'utf8',
    ),
  )
}
export async function memoryPost(endpoint, body, secret, key, timeout = 5000) {
  const url = memoryEndpoint(endpoint)
  const clear = JSON.stringify({ path: url.pathname, token: secret || '', body })
  if (Buffer.byteLength(clear) > 14_110_000) throw new Error('Memory request too large.')
  const aad = `threadlight-memory-v1:${url.origin}`
  const envelope = seal(key, `POST:${aad}:request`, { time: Date.now(), body: clear })
  const response = await fetch(new URL('/secure-memory', url), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  // Never trust a status, error message, redirect, or MCP result from an unverified listener.
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error('Threadlight server authentication failed.')
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 23_000_000) throw new Error('Memory response too large.')
    chunks.push(chunk)
  }
  const result = open(
    key,
    `${aad}:response:${envelope.iv}`,
    JSON.parse(Buffer.concat(chunks).toString('utf8')),
  )
  if (!Number.isInteger(result.status) || result.status < 100 || result.status > 599)
    throw new Error('Invalid authenticated status.')
  return result
}

// Owned clients receive only a private configuration path on argv. The file is removed
// by Threadlight on connection close; no bearer or bootstrap key goes on the command line.
if (process.argv[2] === '--threadlight-memory-proxy') {
  const config = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  const key = Buffer.from(config.key, 'hex')
  memoryEndpoint(config.endpoint)
  if (key.length !== 32 || typeof config.token !== 'string')
    throw new Error('Invalid private MCP configuration.')
  let pending = '',
    active = 0
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    pending += chunk
    if (Buffer.byteLength(pending) > 15_000_000) process.exit(1)
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line.trim()) continue
      if (++active > 16) process.exit(1)
      void (async () => {
        let id = null
        try {
          const message = JSON.parse(line)
          id = message.id ?? null
          const result = await memoryPost(config.endpoint, message, config.token, key, 35000)
          if (id === null) return
          if (result.status !== 200 || result.value?.jsonrpc !== '2.0' || result.value.id !== id)
            throw new Error('Invalid MCP response.')
          process.stdout.write(JSON.stringify(result.value) + '\n')
        } catch {
          if (id !== null)
            process.stdout.write(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: {
                  code: -32000,
                  message:
                    'Threadlight connection unavailable or unverified. Check the app before retrying a write.',
                },
              }) + '\n',
            )
        } finally {
          active--
        }
      })()
    }
  })
}
