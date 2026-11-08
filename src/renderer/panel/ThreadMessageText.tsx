import { useMemo } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { AgentMessageContent } from './AgentMessageContent'
import { ReplyWithCode } from './ReplyCode'
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
  const prose = (value: string) => <ThreadProse text={value} />
  if (!parts.some((part) => part.type === 'artifact')) return prose(text)
  return (
    <ReplyWithCode
      text={text}
      prose={(value) => {
        const spans = artifactMessageParts(value, artifacts, cwd)
        if (!spans.some((part) => part.type === 'artifact')) return prose(value)
        return (
          <p>
            {spans.map((part, index) =>
              part.type === 'text' ? (
                part.text
              ) : (
                <button
                  key={index}
                  type="button"
                  role="link"
                  className={styles.artifactLink}
                  disabled={!part.id || !onOpenArtifact}
                  title={
                    part.id ? `Open ${part.label} in Artifacts` : 'Preview is not available yet.'
                  }
                  onClick={() => part.id && onOpenArtifact?.(part.id)}
                >
                  {part.label}
                </button>
              ),
            )}
          </p>
        )
      }}
    />
  )
}

function ThreadProse({ text }: { text: string }) {
  // Keep literal whitespace selectable in plain transcripts, including unfenced snippets.
  const formatted = useMemo(
    () =>
      /\||~~/.test(text) ||
      fromMarkdown(text).children.some(
        (block) =>
          block.type !== 'paragraph' || block.children.some((child) => child.type !== 'text'),
      ),
    [text],
  )
  return formatted ? <AgentMessageContent text={text} /> : <p>{text}</p>
}
