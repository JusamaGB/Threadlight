import type { DiffLine } from '../../shared/types'

export interface DiffGroup {
  type: 'context' | 'add' | 'remove'
  lines: DiffLine[]
}

export interface DiffHunk {
  heading: string
  indent: string
  groups: DiffGroup[]
}

/** Group only adjacent lines, retaining every source line and each hunk boundary. */
export function stackedDiffHunks(lines: readonly DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let hunk: DiffHunk = { heading: '', indent: '', groups: [] }
  const finish = () => {
    if (!hunk.groups.length) return
    let prefix: string | undefined
    for (const group of hunk.groups) {
      for (const line of group.lines) {
        if (!line.text.trim()) continue
        const whitespace = /^[\t ]*/.exec(line.text)![0]
        prefix ??= whitespace
        while (!whitespace.startsWith(prefix)) prefix = prefix.slice(0, -1)
      }
    }
    hunk.indent = prefix ?? ''
    hunks.push(hunk)
  }
  for (const line of lines) {
    if (line.type === 'hunk') {
      finish()
      hunk = { heading: line.text, indent: '', groups: [] }
      continue
    }
    let group = hunk.groups.at(-1)
    if (group?.type !== line.type) {
      group = { type: line.type, lines: [] }
      hunk.groups.push(group)
    }
    group.lines.push(line)
  }
  finish()
  return hunks
}

/** Strip shared indentation for display only; wrapping off renders the original source. */
export function compactDiffText(text: string, indent: string): string {
  return text.startsWith(indent) ? text.slice(indent.length) : text
}
