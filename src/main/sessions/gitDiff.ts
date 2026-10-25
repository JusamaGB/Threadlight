// Where each thread's git folder stands: lines changed since the last commit, commits waiting to
// be pushed, commits behind main, and the repository's worktrees. Shown beside the thread's
// title, compactly, and in full when it is expanded.
//
// The diff counts against HEAD, so it goes back to nothing when the work is committed; from
// then on "to push" carries the story. New files git does not track yet count as added lines.
// "Behind main" is against the local main branch: nothing is fetched from the network.
//
// Several threads often share one folder, and a scan runs every second, so each folder is
// counted at most every REFRESH_MS, in the background; the scan only ever reads the last count.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { DiffStat, GitState } from '../../shared/types'

/** How often a folder is counted again. */
const REFRESH_MS = 5000
/** Bigger new files are not read; they are counted as one changed file, not by lines. */
const MAX_NEW_FILE_BYTES = 1024 * 1024
const MAX_NEW_FILES = 200
const GIT_TIMEOUT_MS = 10_000
/** The branch "behind" is measured against, the first of these that exists. */
const MAIN_BRANCHES = ['main', 'master']

interface Entry {
  state: GitState | null
  countedAt: number
  counting: boolean
}

export class GitStates {
  private folders = new Map<string, Entry>()

  constructor(
    /** Called when a folder's count changes, so the list can show it. */
    private readonly onChange: () => void,
    private readonly now: () => number = Date.now,
    private readonly count: (folder: string) => Promise<GitState | null> = readGitState,
  ) {}

  /** The folder's last count (null if none yet, or not a git folder); recounts it when due. */
  get(folder: string): GitState | null {
    if (!folder) return null
    let entry = this.folders.get(folder)
    if (!entry) {
      entry = { state: null, countedAt: -Infinity, counting: false } // never counted: due now
      this.folders.set(folder, entry)
    }
    if (!entry.counting && this.now() - entry.countedAt >= REFRESH_MS) this.recount(folder, entry)
    return entry.state
  }

  private recount(folder: string, entry: Entry): void {
    entry.counting = true
    void this.count(folder)
      .catch(() => null)
      .then((state) => {
        const changed = JSON.stringify(state) !== JSON.stringify(entry.state)
        entry.state = state
        entry.countedAt = this.now()
        entry.counting = false
        if (changed) this.onChange()
      })
  }
}

/** Everything the list shows about a folder's repository; null if it is not in one. */
export async function readGitState(folder: string): Promise<GitState | null> {
  const top = (await git(folder, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) return null // not a repository, or git is missing
  const counted = (await countChanges(top)) ?? { added: 0, removed: 0, files: 0, newFiles: 0 }
  const head = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
  const branch = head && head !== 'HEAD' ? head : null // "HEAD": detached, no branch
  let main: string | null = null
  for (const name of MAIN_BRANCHES) {
    if ((await git(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) !== null) {
      main = name
      break
    }
  }
  const onMain = main !== null && branch === main
  const behind = main && !onMain ? await countCommits(top, `HEAD..${main}`) : 0
  // To push: ahead of the branch's upstream; never pushed, then everything ahead of main.
  const tracking = await git(top, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  const ahead =
    tracking !== null
      ? Number.parseInt(tracking.trim().split(/\s+/)[1] ?? '0', 10) || 0
      : main && !onMain
        ? await countCommits(top, `${main}..HEAD`)
        : 0
  const worktrees = parseWorktrees((await git(top, ['worktree', 'list', '--porcelain'])) ?? '')
  return { ...counted, root: top, branch, ahead, behind, worktrees }
}

/**
 * Lines added and removed in a folder against its last commit, and how many files that is
 * (new ones counted apart); null if it is not a git folder.
 */
export async function countChanges(
  folder: string,
): Promise<(DiffStat & { files: number; newFiles: number }) | null> {
  const tracked = await git(folder, ['diff', 'HEAD', '--numstat', '--no-renames', '-z'])
  if (tracked === null) return null // not a repository, no commit yet, or git is missing
  const diff = parseNumstat(tracked)
  const changed = tracked.split('\0').filter((record) => record.includes('\t')).length
  const untracked = (await git(folder, ['ls-files', '--others', '--exclude-standard', '-z'])) ?? ''
  const fresh = untracked.split('\0').filter(Boolean)
  for (const path of fresh.slice(0, MAX_NEW_FILES)) {
    diff.added += await lineCount(join(folder, path))
  }
  return { ...diff, files: changed + fresh.length, newFiles: fresh.length }
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

/** `git worktree list --porcelain`: one "worktree <path>" line per worktree, main one first. */
export function parseWorktrees(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
}

async function countCommits(folder: string, range: string): Promise<number> {
  const out = await git(folder, ['rev-list', '--count', range])
  return out === null ? 0 : Number.parseInt(out.trim(), 10) || 0
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
