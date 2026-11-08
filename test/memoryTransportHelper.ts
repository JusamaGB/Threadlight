import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { memoryPost } from '../scripts/memory-transport.mjs'

/** Real encrypted requests and replies, with a key confined to the test sandbox. */
export function memoryTestTransport(root: string) {
  const key = randomBytes(32),
    directory = join(root, 'memory-auth'),
    authFile = join(directory, 'server.key')
  mkdirSync(directory, { recursive: true })
  writeFileSync(authFile, key.toString('hex'))
  return {
    key,
    directory,
    authFile,
    fetch: async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      if (
        headers.has('origin') ||
        headers.has('referer') ||
        headers.get('content-type') !== 'application/json'
      )
        return fetch(new URL('/secure-memory', url), { method: 'POST', headers })
      const token = headers.get('authorization')?.match(/^Bearer (.*)$/)?.[1]
      const result = await memoryPost(url, JSON.parse(String(init.body)), token, key, 35000)
      return new Response(result.value === undefined ? null : JSON.stringify(result.value), {
        status: result.status,
      })
    },
  }
}
