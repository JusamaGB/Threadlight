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

/**
 * The hover's one sentence: the branch and what is waiting on it, short enough for the panel,
 * e.g. "main · 16 files changed (5 new), +1.7k −26 uncommitted" or
 * "feature/guide · 3 files changed, +40 −12 uncommitted · 2 to push · 5 behind main".
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
