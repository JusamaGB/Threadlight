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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DiffStat, GitState } from '../../shared/types'
import { findGitRepository } from './gitRepository'
import { runGit } from './gitProcess'
import { captureGit, invalidateGitComparison } from '../changes/git'
export { GitStates } from './gitStates'

/** The branch "behind" is measured against, the first of these that exists. */
const MAIN_BRANCHES = ['main', 'master']

/** Everything the list shows about a folder's repository; null if it is not in one. */
export async function readGitState(
  folder: string,
  metadata?: (state: GitState) => void,
): Promise<GitState | null> {
  const repository = await findGitRepository(folder)
  if (!repository) return null
  const { root: top, gitDir } = repository
  const head = (await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => '')).trim()
  if (!head) return null
  const branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null
  metadata?.({
    root: top,
    branch,
    added: 0,
    removed: 0,
    files: 0,
    newFiles: 0,
    ahead: 0,
    behind: 0,
    worktrees: [],
    pending: true,
  })
  const [counted, branches, tracking, trees] = await Promise.all([
    countChanges(top),
    git(top, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/main', 'refs/heads/master']),
    git(top, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    git(top, ['worktree', 'list', '--porcelain']),
  ])
  if (!counted) return null
  const names = branches?.trim().split(/\r?\n/) ?? []
  const main = MAIN_BRANCHES.find((name) => names.includes(name)) ?? null
  const onMain = main !== null && branch === main
  const [behind, ahead] = await Promise.all([
    main && !onMain ? countCommits(top, `HEAD..${main}`) : 0,
    tracking !== null
      ? Number.parseInt(tracking.trim().split(/\s+/)[1] ?? '0', 10) || 0
      : main && !onMain
        ? countCommits(top, `${main}..HEAD`)
        : 0,
  ])
  return { ...counted, root: top, branch, ahead, behind, worktrees: parseWorktrees(trees ?? '') }
}

/**
 * Lines added and removed in a folder against its last commit, and how many files that is
 * (new ones counted apart); null if it is not a git folder.
 */
export async function countChanges(folder: string): Promise<
  | (DiffStat & {
      files: number
      newFiles: number
      complete?: boolean
      revision?: string
      hasOtherLensChanges?: boolean | null
      stale?: boolean
    })
  | null
> {
  try {
    invalidateGitComparison(folder)
    const result = await captureGit(folder)
    return {
      added: result.files.reduce((n, f) => n + f.added, 0),
      removed: result.files.reduce((n, f) => n + f.removed, 0),
      files: result.files.length,
      newFiles: result.files.filter((f) => f.status === 'added').length,
      complete: result.complete,
      revision: result.revision,
      hasOtherLensChanges: result.hasOtherLensChanges,
      stale: result.stale,
    }
  } catch {
    return null
  }
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

function git(folder: string, args: string[]): Promise<string | null> {
  return runGit(folder, args).catch(() => null)
}
