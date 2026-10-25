import type { GitState } from '../../shared/types'
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

/** The row's tooltip, one fact a line. */
export function gitSummary(git: GitState): string[] {
  return [
    git.branch ?? en.git.noBranch,
    (git.added > 0 || git.removed > 0) && en.git.changed(git.added, git.removed),
    git.ahead > 0 && en.git.toPush(git.ahead),
    git.behind > 0 && en.git.behind(git.behind),
    git.worktrees.length > 1 && en.git.worktrees(git.worktrees.length),
  ].filter((line): line is string => Boolean(line))
}
