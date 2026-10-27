// Reads the Claude app's own record of each thread: its title, archive flag and the
// Claude Code session behind it. Undocumented format; see paths.ts for the location.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { PullRequest } from '../../shared/types'
import { isObject, str } from './json'
import { FILE_LANES, mapLimit } from './parallel'

export interface AppRecord {
  /** The app's thread id (`local_…`). */
  appId: string
  /** The Claude Code session id the thread runs on. */
  cliSessionId: string
  title: string | null
  archived: boolean
  cwd: string | null
  /** The workspace folder the sidebar groups it under (a worktree's own repo, not the worktree). */
  workspace: string | null
  /** The thread that started this one (a side thread), by its `local_…` id. */
  parentAppId: string | null
  permissionMode: string | null
  model: string | null
  pullRequests: PullRequest[]
  lastActivityAt: number
  /** When the thread was last open in front of the user; the latest marks the current workspace. */
  lastFocusedAt: number
  /**
   * When the thread's latest turn started or ended: the moment Claude's own turn timer counts
   * from while it works. 0 when the record has none.
   */
  lastTurnEdgeAt: number
  /** The git worktree the app made for the thread, when it made one. */
  worktreePath: string | null
}

/** Caches parsed records by file modification time, so a refresh only re-reads changed files. */
export class AppRecordIndex {
  private cache = new Map<string, { mtimeMs: number; record: AppRecord | null }>()

  constructor(private readonly dir: string) {}

  /** Records keyed by Claude Code session id. */
  async refresh(): Promise<Map<string, AppRecord>> {
    const byCliId = new Map<string, AppRecord>()
    const seen = new Set<string>()
    const files = await recordFiles(this.dir)
    const records = await mapLimit(files, FILE_LANES, (file) => this.load(file))
    for (const [index, file] of files.entries()) {
      seen.add(file)
      const record = records[index]
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
    workspace: str(raw['originCwd']) ?? str(raw['gitAnchorsFolderRealpath']) ?? str(raw['cwd']),
    parentAppId: isObject(raw['spawnedFrom']) ? str(raw['spawnedFrom']['sessionId']) : null,
    permissionMode: str(raw['permissionMode']),
    model: str(raw['model']),
    pullRequests: parsePullRequests(raw['prs']),
    lastActivityAt: num(raw['lastActivityAt']),
    lastFocusedAt: num(raw['lastFocusedAt']),
    lastTurnEdgeAt: num(raw['lastTurnEdgeAt']),
    worktreePath: str(raw['worktreePath']),
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
