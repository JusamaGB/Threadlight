// Hook transport only. Errors produce no decision and never expose input or credentials.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export async function callHook(port, path, seconds, body, key) {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^\/(?:hook\/[A-Za-z]{1,40}|ask|stop|permission|offer|context)$/.test(path) ||
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > 43200 ||
    key.length !== 32 ||
    Buffer.byteLength(body) > 16 * 1024 * 1024
  )
    throw new Error('Invalid hook request.')
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`POST:${path}`))
  const data = Buffer.concat([
    cipher.update(JSON.stringify({ time: Date.now(), body })),
    cipher.final(),
  ])
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(seconds * 1000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('base64'),
    }),
  })
  if (response.status !== 200) throw new Error('Hook unavailable.')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 23 * 1024 * 1024) throw new Error('Hook reply too large.')
    chunks.push(chunk)
  }
  const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (
    !/^[a-f0-9]{24}$/.test(reply.iv) ||
    !/^[a-f0-9]{32}$/.test(reply.tag) ||
    typeof reply.data !== 'string'
  )
    throw new Error('Invalid hook reply.')
  const decrypt = createDecipheriv('aes-256-gcm', key, Buffer.from(reply.iv, 'hex'))
  decrypt.setAAD(Buffer.from(`response:${iv.toString('hex')}`))
  decrypt.setAuthTag(Buffer.from(reply.tag, 'hex'))
  const value = JSON.parse(
    Buffer.concat([decrypt.update(Buffer.from(reply.data, 'base64')), decrypt.final()]).toString(
      'utf8',
    ),
  )
  if (![200, 204].includes(value.status) || typeof value.body !== 'string')
    throw new Error('Hook rejected.')
  return value.body
}

export async function run(args = process.argv.slice(1)) {
  try {
    const [portText, path, timeout] = args,
      port = Number(portText)
    if (![47615, 47616].includes(port)) return
    const keyText = await readFile(
      join(
        process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
        'Threadlight',
        'hook-auth',
        `${port}.key`,
      ),
      'utf8',
    )
    if (!/^[a-f0-9]{64}$/.test(keyText)) return
    const chunks = []
    let size = 0
    for await (const chunk of process.stdin) {
      size += chunk.length
      if (size > 16 * 1024 * 1024) return
      chunks.push(chunk)
    }
    const answer = await callHook(
      port,
      path,
      Number(timeout),
      Buffer.concat(chunks).toString('utf8'),
      Buffer.from(keyText, 'hex'),
    )
    if (answer) process.stdout.write(answer)
  } catch {
    /* Closed, stale or unauthenticated connections never manufacture an answer. */
  }
}
