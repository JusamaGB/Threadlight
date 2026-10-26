import { dirname, isAbsolute, win32 } from 'node:path'
import type { PullRequest } from '../../shared/types'
import { isObject, str } from '../sessions/json'

/** Structured activity only: never infer a repository from prose, tool output or JS source. */
export function codexGitFolders(records: Record<string, unknown>[]): string[] {
  const folders: string[] = []
  const add = (value: unknown, file = false) => {
    const path = str(value)
    if (!path || (!isAbsolute(path) && !win32.isAbsolute(path))) return
    const folder = file ? (win32.isAbsolute(path) ? win32.dirname(path) : dirname(path)) : path
    if (!folders.includes(folder)) folders.push(folder)
  }
  for (const record of [...records].reverse()) {
    const item = isObject(record['payload']) ? record['payload'] : record
    const type = str(item['type'])
    if (type === 'fileChange' && Array.isArray(item['changes']))
      for (const change of item['changes'].filter(isObject)) add(change['path'], true)
    if (type === 'commandExecution' || record['type'] === 'turn_context') add(item['cwd'])
    if (type === 'function_call' || type === 'functionCall') {
      const name = str(item['name']) || ''
      if (!/(?:^|[.:])exec_command$/.test(name)) continue
      try {
        const args: unknown = JSON.parse(str(item['arguments']) || '{}')
        if (isObject(args)) add(args['workdir'])
      } catch {
        /* incomplete tool arguments */
      }
    }
  }
  return folders.slice(0, 8)
}

/** Native attachments are links, without provider status. Do not guess that a PR is open. */
export function codexPullRequest(payload: unknown): PullRequest | null {
  if (!isObject(payload) || typeof payload['url'] !== 'string') return null
  try {
    const url = new URL(payload['url'])
    if (url.protocol !== 'https:') return null
    const match =
      url.pathname.match(/^\/[^/]+\/[^/]+\/(?:pull|pulls)\/(\d+)\/?$/) ||
      url.pathname.match(/^\/.+\/-\/merge_requests\/(\d+)\/?$/)
    const number = Number(match?.[1])
    return Number.isSafeInteger(number) && number > 0 ? { number, state: 'unknown' } : null
  } catch {
    return null
  }
}
