import { fromMarkdown } from 'mdast-util-from-markdown'
import type { RootContent, PhrasingContent } from 'mdast'

function prose(node: RootContent | PhrasingContent): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value
    case 'break':
      return ' '
    case 'code':
    case 'html':
    case 'image':
    case 'imageReference':
    case 'definition':
      return ''
    default:
      return 'children' in node
        ? node.children
            .map(prose)
            .join(
              node.type === 'list' || node.type === 'listItem' || node.type === 'blockquote'
                ? ' '
                : '',
            )
        : ''
  }
}

/** Markdown formatting and fenced examples are visual; inline names and operators retain their spelling. */
export function spokenProse(text: string): string {
  return fromMarkdown(text).children.map(prose).filter(Boolean).join('\n\n').trim()
}
