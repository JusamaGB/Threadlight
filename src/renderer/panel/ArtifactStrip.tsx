import { useArtifactCatalog } from '../hooks/useArtifactCatalog'
import { Tip } from './Tip'
import styles from './Panel.module.css'

export function ArtifactStrip({
  threadId,
  onOpen,
}: {
  threadId: string
  onOpen: (id: string) => void
}) {
  const items = useArtifactCatalog(threadId)?.items ?? []
  // Every thread reserves this line, including while references are loading or absent.
  if (!items.length) return <div className={styles.artifactStrip} aria-hidden />
  return (
    <div className={styles.artifactStrip} role="group" aria-label="Thread attachments">
      {items.slice(0, items.length > 20 ? 19 : 20).map((item) => (
        <Tip
          key={item.id}
          as="button"
          text={item.title}
          title={item.title}
          className={styles.artifactTile}
          aria-label={`Open artifact: ${item.title}`}
          onClick={(event) => {
            event.stopPropagation()
            onOpen(item.id)
          }}
        >
          <span aria-hidden="true" />
        </Tip>
      ))}
      {items.length > 20 && (
        <Tip
          as="button"
          className={styles.artifactTile}
          text={`${items.length - 19} more artifacts`}
          aria-label="View all thread artifacts"
          onClick={(event) => {
            event.stopPropagation()
            onOpen('')
          }}
        >
          <span aria-hidden="true" />
        </Tip>
      )}
    </div>
  )
}
