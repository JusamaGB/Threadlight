import { createContext, useContext } from 'react'
import type { TimelineItem } from '../../shared/threadTimeline'
import styles from './ThreadConversation.module.css'

export const CardChangesContext = createContext<
  ((threadId: string, item: TimelineItem) => void) | null
>(null)

function Counts({ added, removed }: { added: number | null; removed: number | null }) {
  return added === null || removed === null ? null : (
    <span className={styles.fileCounts}>
      <span>+{added}</span>
      <span aria-hidden="true">—</span>
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
        <Counts added={added} removed={removed} />
        <div className={styles.fileHeading}>
          <strong>{item.text}</strong>
          {!known && <span className={styles.fileUnknown}>Counts unavailable</span>}
        </div>
        <button
          type="button"
          disabled={!openChanges || !files.length}
          aria-description="View only the changes recorded on this card."
          onClick={() => openChanges?.(threadId, item)}
        >
          View
        </button>
      </header>
    </section>
  )
}
