import { open, realpath } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import type { HistoryCursor } from './types'

export async function contained(path: string, roots: string[]): Promise<string> {
  const resolved = await realpath(path)
  for (const root of roots) {
    const base = await realpath(root).catch(() => null)
    if (!base) continue
    const rel = relative(base, resolved)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return resolved
  }
  throw new Error('Source is outside the configured provider roots.')
}

/** Read backwards at byte boundaries; never decode a partial UTF-8 or JSON record. */
export async function jsonlPage(
  path: string,
  roots: string[],
  cursor?: HistoryCursor,
  maxBytes = 2 * 1024 * 1024,
) {
  const file = await open(await contained(path, roots), 'r')
  try {
    const before = await file.stat()
    const identity = `${before.dev}:${before.ino}:${before.birthtimeMs}`
    if (cursor && (cursor.identity !== identity || before.size < cursor.boundary))
      throw new Error('cursor_expired')
    const end = cursor?.position ?? before.size
    const start = Math.max(0, end - maxBytes)
    const data = Buffer.alloc(end - start)
    const { bytesRead } = await file.read(data, 0, data.length, start)
    const buffer = data.subarray(0, bytesRead)
    const first = start ? buffer.indexOf(10) + 1 : 0
    const last = buffer.lastIndexOf(10)
    const coverage: string[] = []
    const records: { value: unknown; offset: number }[] = []
    if (last < buffer.length - 1) coverage.push('Incomplete trailing record omitted.')
    if (first === 0 && start > 0) coverage.push('Record exceeds page byte budget.')
    else {
      let offset = first
      while (offset <= last) {
        const next = buffer.indexOf(10, offset)
        if (next < 0) break
        const line = buffer.subarray(offset, next).toString('utf8').trim()
        if (line) {
          try {
            records.push({ value: JSON.parse(line), offset: start + offset })
          } catch {
            coverage.push(`Malformed record at byte ${start + offset}.`)
          }
        }
        offset = next + 1
      }
    }
    const after = await file.stat()
    const changedDuringRead = before.size !== after.size || before.mtimeMs !== after.mtimeMs
    const position = start === 0 ? 0 : first > 0 ? start + first : start
    return {
      records,
      coverage,
      changedDuringRead,
      checkedAt: Date.now(),
      sourceUpdatedAt: before.mtimeMs,
      revision: `${identity}:${before.size}:${before.mtimeMs}`,
      identity,
      size: before.size,
      cursor:
        position > 0
          ? { position, identity, boundary: cursor?.boundary ?? before.size }
          : undefined,
    }
  } finally {
    await file.close()
  }
}
