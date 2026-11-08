import { type ReactNode } from 'react'
import { markdownCode, ReplyWithCode } from './ReplyCode'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatLink } from '../../shared/accountChats'
import styles from './AgentThread.module.css'

const components: Components = {
  a: ({ href, children }) => {
    const url = href && chatLink(href)
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {children} ↗
      </a>
    ) : (
      <span>{children}</span>
    )
  },
  img: ({ alt }) => <span>{alt ? `Image: ${alt}` : 'Image'}</span>,
  pre: markdownCode,
  table: ({ children }) => (
    <div className={styles.table} tabIndex={0} role="region" aria-label="Table">
      <table>{children}</table>
    </div>
  ),
}
const plugins = [remarkGfm]

export function AgentMessageContent({
  text,
  format,
}: {
  text: string
  format?: (text: string) => ReactNode
}) {
  return format ? (
    <div className={styles.plain}>
      <ReplyWithCode text={text} prose={format} />
    </div>
  ) : (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={plugins}
        components={components}
        skipHtml
        urlTransform={(url) => chatLink(url) ?? ''}
      >
        {text}
      </Markdown>
    </div>
  )
}
