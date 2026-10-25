// How much each thread's folder has changed since its last commit: lines added and removed,
// shown beside the thread's title. It counts against HEAD, so it goes back to nothing when the
// work is committed. New files git does not track yet count as added lines.
//
// Several threads often share one folder, and a scan runs every second, so each folder is
// counted at most every REFRESH_MS, in the background; the scan only ever reads the last count.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { DiffStat } from '../../shared/types'

/** How often a folder is counted again. */
const REFRESH_MS = 5000
/** Bigger new files are not read; they are counted as one changed file, not by lines. */
const MAX_NEW_FILE_BYTES = 1024 * 1024
const MAX_NEW_FILES = 200
const GIT_TIMEOUT_MS = 10_000

interface Entry {
  diff: DiffStat | null
  countedAt: number
  counting: boolean
}

export class GitDiffs {
  private folders = new Map<string, Entry>()

  constructor(
    /** Called when a folder's count changes, so the list can show it. */
    private readonly onChange: () => void,
    private readonly now: () => number = Date.now,
    private readonly count: (folder: string) => Promise<DiffStat | null> = countChanges,
  ) {}

  /** The folder's last count (null if none yet, or not a git folder); recounts it when due. */
  get(folder: string): DiffStat | null {
    if (!folder) return null
    let entry = this.folders.get(folder)
    if (!entry) {
      entry = { diff: null, countedAt: -Infinity, counting: false } // never counted: due now
      this.folders.set(folder, entry)
    }
    if (!entry.counting && this.now() - entry.countedAt >= REFRESH_MS) this.recount(folder, entry)
    return entry.diff
  }

  private recount(folder: string, entry: Entry): void {
    entry.counting = true
    void this.count(folder)
      .catch(() => null)
      .then((diff) => {
        const changed = JSON.stringify(diff) !== JSON.stringify(entry.diff)
        entry.diff = diff
        entry.countedAt = this.now()
        entry.counting = false
        if (changed) this.onChange()
      })
  }
}

/** Lines added and removed in a folder against its last commit; null if it is not a git folder. */
export async function countChanges(folder: string): Promise<DiffStat | null> {
  const tracked = await git(folder, ['diff', 'HEAD', '--numstat', '--no-renames', '-z'])
  if (tracked === null) return null // not a repository, no commit yet, or git is missing
  const diff = parseNumstat(tracked)
  const untracked = await git(folder, ['ls-files', '--others', '--exclude-standard', '-z'])
  for (const path of (untracked ?? '').split('\0').filter(Boolean).slice(0, MAX_NEW_FILES)) {
    diff.added += await lineCount(join(folder, path))
  }
  return diff
}

/** `git diff --numstat -z`: "added<TAB>removed<TAB>path\0" per file; binary files show "-". */
export function parseNumstat(output: string): DiffStat {
  const diff: DiffStat = { added: 0, removed: 0 }
  for (const record of output.split('\0')) {
    const [added, removed] = record.split('\t')
    if (!added || !removed || added === '-' || removed === '-') continue
    diff.added += Number.parseInt(added, 10) || 0
    diff.removed += Number.parseInt(removed, 10) || 0
  }
  return diff
}

async function lineCount(path: string): Promise<number> {
  try {
    if ((await stat(path)).size > MAX_NEW_FILE_BYTES) return 0
    const text = await readFile(path, 'utf8')
    if (text.includes('\0')) return 0 // binary
    if (!text) return 0
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  } catch {
    return 0
  }
}

function git(folder: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', folder, ...args],
      { windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
}
