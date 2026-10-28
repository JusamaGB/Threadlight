import type { TimelineItem } from '../../shared/threadTimeline'
import { activitySummary } from '../../shared/threadActivity'
import styles from './ThreadConversation.module.css'
import { ThreadImages } from './ThreadImages'

export function ActivityIcon({ kind }: { kind?: TimelineItem['activity'] }) {
  return (
    <svg
      className={styles.activityIcon}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      {kind === 'command' ? (
        <>
          <rect x="2" y="3" width="16" height="14" rx="3" />
          <path d="m5 7 3 3-3 3m6 0h4" />
        </>
      ) : kind === 'compaction' ? (
        <>
          <path d="M5 2v5H2m0-5 4 4m9 12v-5h3m0 5-4-4M8 5h7M5 10h10M5 15h7" />
        </>
      ) : (
        <path d="M12 3a5 5 0 0 0-6 6l-4 6a2 2 0 0 0 3 3l6-5a5 5 0 0 0 6-6l-3 3-3-3 3-4Z" />
      )}
    </svg>
  )
}

export function ActivityGroup({
  items,
  active,
  threadId,
  onOpenArtifact,
}: {
  items: TimelineItem[]
  active: boolean
  threadId: string
  onOpenArtifact?: (id: string) => void
}) {
  const images = items.filter((item) => item.activity === 'image')
  const label = activitySummary(items, active)
  const current = active ? items.findLast((item) => !item.complete) : undefined
  const kind =
    current?.activity ?? (items.every((item) => item.activity === 'command') ? 'command' : 'tool')
  return (
    <details
      className={styles.activityGroup}
      data-message-id={items[0]!.id}
      data-active={!!current}
    >
      <summary title={label}>
        <ActivityIcon kind={kind} />
        <span>{label}</span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </summary>
      <ol className={styles.activityList} aria-label="Activity details">
        {items
          .filter((item) => item.activity !== 'image' || item.id === images[0]?.id)
          .map((item) => (
            <li key={item.id} data-activity-id={item.id} data-failed={item.failed || undefined}>
              {item.activity === 'image' ? (
                <ThreadImages threadId={threadId} items={images} onOpenArtifact={onOpenArtifact} />
              ) : item.detail ? (
                <details className={styles.tool}>
                  <summary>
                    <span>{item.text}</span>
                  </summary>
                  <pre>{item.detail}</pre>
                </details>
              ) : (
                <p>{item.text}</p>
              )}
            </li>
          ))}
      </ol>
    </details>
  )
}
