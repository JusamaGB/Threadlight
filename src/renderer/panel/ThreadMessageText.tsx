import { useMemo } from 'react'
import type { ThreadArtifact } from '../../shared/artifacts'
import { artifactMessageParts } from '../lib/artifactMessage'
import styles from './ThreadConversation.module.css'

export function ThreadMessageText({
  text,
  artifacts,
  cwd,
  onOpenArtifact,
}: {
  text: string
  artifacts: ThreadArtifact[]
  cwd: string
  onOpenArtifact?: (id: string) => void
}) {
  const parts = useMemo(() => artifactMessageParts(text, artifacts, cwd), [text, artifacts, cwd])
  return parts.map((part, index) =>
    part.type === 'text' ? (
      part.text
    ) : (
      <button
        key={index}
        type="button"
        role="link"
        className={styles.artifactLink}
        disabled={!part.id || !onOpenArtifact}
        title={part.id ? `Open ${part.label} in Artifacts` : 'Preview is not available yet.'}
        onClick={() => part.id && onOpenArtifact?.(part.id)}
      >
        {part.label}
      </button>
    ),
  )
}
