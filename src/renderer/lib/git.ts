import type { GitState, ThreadDiffSummary } from '../../shared/types'
import { en } from '../i18n/en'

/** The expanded thread's line: "feature/x · 2 to push · 5 behind main · 3 worktrees". */
export function gitLine(git: GitState): string {
  return [
    git.branch ?? en.git.noBranch,
    git.ahead > 0 && en.git.toPush(git.ahead),
    git.behind > 0 && en.git.behind(git.behind),
    git.worktrees.length > 1 && en.git.worktrees(git.worktrees.length),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The hover names the worktree so its repository-wide count cannot be mistaken
 * for one chat's recorded edits. Counts include every writer and formatter.
 */
export function gitSentence(git: GitState): string {
  const lines = [
    git.added > 0 && `+${compact(git.added)}`,
    git.removed > 0 && `−${compact(git.removed)}`,
  ]
    .filter(Boolean)
    .join(' ')
  const changed =
    git.files > 0
      ? en.git.uncommitted(
          en.git.filesChanged(git.files) +
            (git.newFiles > 0 ? ` (${en.git.newOf(git.newFiles)})` : ''),
          lines,
        )
      : null
  return [
    en.git.worktreeTotal,
    git.root,
    git.branch ?? en.git.noBranch,
    changed ?? (git.ahead || git.behind ? null : en.git.clean),
    git.ahead > 0 && en.git.toPush(git.ahead),
    git.behind > 0 && en.git.behind(git.behind),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 1234 → "1.2k", so a big change still reads at a glance. */
export const compact = (n: number) =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`

export function threadDiffSentence(diff: ThreadDiffSummary): string {
  return [
    en.changes.title,
    en.git.filesChanged(diff.files),
    diff.added > 0 && `+${compact(diff.added)}`,
    diff.removed > 0 && `−${compact(diff.removed)}`,
    !diff.complete && en.changes.partialShort,
  ]
    .filter(Boolean)
    .join(' · ')
}
