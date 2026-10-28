import { createContext, useContext } from 'react'
import type { TimelineItem } from '../../shared/threadTimeline'
import styles from './ThreadConversation.module.css'

export const CardChangesContext = createContext<
  ((threadId: string, item: TimelineItem) => void) | null
>(null)

function Counts({ added, removed }: { added: number | null; removed: number | null }) {
  return added === null || removed === null ? (
    <span className={styles.fileUnknown}>Counts unavailable</span>
  ) : (
    <span className={styles.fileCounts}>
      <span>+{added}</span>
      <span>−{removed}</span>
    </span>
  )
}

export function ThreadFileChanges({ item, threadId }: { item: TimelineItem; threadId: string }) {
  const openChanges = useContext(CardChangesContext)
  const files = item.fileChanges ?? []
  const count = item.fileCount ?? files.length
  const known =
    files.length > 0 &&
    files.length === count &&
    files.every((file) => file.added !== null && file.removed !== null)
  const added = known ? files.reduce((n, file) => n + file.added!, 0) : null
  const removed = known ? files.reduce((n, file) => n + file.removed!, 0) : null
  return (
    <section className={styles.fileCard} data-message-id={item.id} aria-label={item.text}>
      <header>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <rect x="4" y="2" width="12" height="16" rx="3" />
          <path d="M7 8h6m-3-3v6m-3 3h6" />
        </svg>
        <div className={styles.fileHeading}>
          <strong>{item.text}</strong>
          <Counts added={added} removed={removed} />
        </div>
        <button
          type="button"
          disabled={!openChanges || !files.length}
          aria-description="View only the changes recorded on this card."
          onClick={() => openChanges?.(threadId, item)}
        >
          View changes
        </button>
      </header>
    </section>
  )
}
