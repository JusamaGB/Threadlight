// Reads the Claude app's own record of each thread: its title, archive flag and the
// Claude Code session behind it. Undocumented format; see paths.ts for the location.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { PullRequest } from '../../shared/types'
import { isObject, str } from './json'

export interface AppRecord {
  /** The app's thread id (`local_…`). */
  appId: string
  /** The Claude Code session id the thread runs on. */
  cliSessionId: string
  title: string | null
  archived: boolean
  cwd: string | null
  permissionMode: string | null
  model: string | null
  pullRequests: PullRequest[]
}

/** Caches parsed records by file modification time, so a refresh only re-reads changed files. */
export class AppRecordIndex {
  private cache = new Map<string, { mtimeMs: number; record: AppRecord | null }>()

  constructor(private readonly dir: string) {}

  /** Records keyed by Claude Code session id. */
  async refresh(): Promise<Map<string, AppRecord>> {
    const byCliId = new Map<string, AppRecord>()
    const seen = new Set<string>()
    for (const file of await recordFiles(this.dir)) {
      seen.add(file)
      const record = await this.load(file)
      if (record) byCliId.set(record.cliSessionId, record)
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file)
    return byCliId
  }

  private async load(file: string): Promise<AppRecord | null> {
    try {
      const { mtimeMs } = await stat(file)
      const cached = this.cache.get(file)
      if (cached?.mtimeMs === mtimeMs) return cached.record
      const record = parseAppRecord(JSON.parse(await readFile(file, 'utf8')))
      this.cache.set(file, { mtimeMs, record })
      return record
    } catch {
      return null // being written right now, or not ours to understand
    }
  }
}

export function parseAppRecord(raw: unknown): AppRecord | null {
  if (!isObject(raw)) return null
  const appId = str(raw['sessionId'])
  const cliSessionId = str(raw['cliSessionId'])
  if (!appId || !cliSessionId) return null
  return {
    appId,
    cliSessionId,
    title: str(raw['title']),
    archived: raw['isArchived'] === true,
    cwd: str(raw['cwd']),
    permissionMode: str(raw['permissionMode']),
    model: str(raw['model']),
    pullRequests: parsePullRequests(raw['prs']),
  }
}

const PR_STATES: Record<string, PullRequest['state']> = {
  OPEN: 'open',
  DRAFT: 'draft',
  MERGED: 'merged',
  CLOSED: 'closed',
}

/** `prs: [{ prNumber, state: 'OPEN' | 'MERGED' | …, isDraft?, dismissed? }]`. Dismissed ones are hidden in the app too. */
function parsePullRequests(raw: unknown): PullRequest[] {
  if (!Array.isArray(raw)) return []
  const list: PullRequest[] = []
  for (const item of raw) {
    if (!isObject(item) || item['dismissed'] === true) continue
    const number = item['prNumber']
    const state = PR_STATES[str(item['state']) ?? '']
    if (typeof number !== 'number' || !state) continue
    list.push({ number, state: state === 'open' && item['isDraft'] === true ? 'draft' : state })
  }
  return list
}

/** `<dir>/<account>/<org>/local_*.json` */
async function recordFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const account of await subdirs(dir)) {
    for (const org of await subdirs(account)) {
      try {
        for (const entry of await readdir(org, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.startsWith('local_') && entry.name.endsWith('.json')) {
            files.push(join(org, entry.name))
          }
        }
      } catch {
        // folder vanished between listing and reading
      }
    }
  }
  return files
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
  } catch {
    return []
  }
}
