import { memo } from 'react'
import { markdownCode } from './ReplyCode'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatLink, type ChatMessage } from '../../shared/accountChats'
import styles from './AccountChats.module.css'

const plugins = [remarkGfm]
const components: Components = {
  a: ({ href, children }) => {
    const url = href && chatLink(href)
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    )
  },
  // Account chat images need an authenticated retrieval path, not background network requests.
  img: ({ alt }) => <span>{alt ? `Image: ${alt}` : 'Image'}</span>,
  pre: markdownCode,
  table: ({ children }) => (
    <div className={styles.table} tabIndex={0} role="region" aria-label="Table">
      <table>{children}</table>
    </div>
  ),
}

const FormattedAnswer = memo(function FormattedAnswer({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={plugins}
        components={components}
        urlTransform={(url) => chatLink(url) ?? ''}
      >
        {text}
      </Markdown>
    </div>
  )
})

export function ChatMessageContent({
  message,
  onFollowUp,
  followUpDisabled,
}: {
  message: ChatMessage
  onFollowUp: (text: string) => void
  followUpDisabled: boolean
}) {
  if (message.role === 'user') return <p>{message.text || 'No text content.'}</p>
  return (
    <>
      {message.text && <FormattedAnswer text={message.text} />}
      {!!message.sources?.length && (
        <details className={styles.detail}>
          <summary>Sources · {message.sources.length}</summary>
          <ul>
            {message.sources.map((source) => (
              <li key={source.url}>
                {chatLink(source.url) ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!message.steps?.length && (
        <details className={styles.detail}>
          <summary>Steps · {message.steps.length}</summary>
          <ol>
            {message.steps.map((step) => (
              <li key={step.id}>
                {step.title}
                {step.status && <small> · {step.status}</small>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {!!message.followUps?.length && (
        <details className={styles.detail}>
          <summary>Follow-ups · {message.followUps.length}</summary>
          <div className={styles.followUps}>
            {message.followUps.map((text) => (
              <button
                key={text}
                disabled={followUpDisabled}
                title={
                  followUpDisabled
                    ? 'Finish your current draft before choosing a follow-up.'
                    : 'Add to composer to review before sending'
                }
                onClick={() => onFollowUp(text)}
              >
                {text}
              </button>
            ))}
          </div>
        </details>
      )}
      {!message.text &&
        !message.sources?.length &&
        !message.steps?.length &&
        !message.followUps?.length && <p>No text content.</p>}
    </>
  )
}
