import type { PullRequest } from '../../shared/types'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

/**
 * The branch icon the Claude app's sidebar shows for a thread with pull requests: coloured by the
 * latest one's state, with a count when there are several.
 */
export function PullRequestBadge({ pullRequests }: { pullRequests: PullRequest[] }) {
  const latest = pullRequests.at(-1)
  if (!latest) return null
  const count = pullRequests.length
  return (
    <span
      className={styles.pr}
      data-state={latest.state}
      title={en.pr.tooltip(latest.number, en.pr.state[latest.state], count)}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <circle cx="4.5" cy="3.5" r="1.75" />
        <circle cx="4.5" cy="12.5" r="1.75" />
        <circle cx="11.5" cy="9" r="1.75" />
        <path d="M4.5 5.25v5.5M4.5 5.25c0 2.4 2 3.75 5.25 3.75" />
      </svg>
      {count > 1 && <span className={styles.prCount}>{count}</span>}
    </span>
  )
}
