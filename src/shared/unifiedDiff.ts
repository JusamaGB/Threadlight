import type { DiffLine } from './types'

/** Draw a recorded unified patch without reading or comparing current files. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of diff.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      inHunk = true
      out.push({ type: 'hunk', text: hunk[3]?.trim() ?? '' })
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) out.push({ type: 'add', text: line.slice(1), newLine: newNo++ })
    else if (line.startsWith('-'))
      out.push({ type: 'remove', text: line.slice(1), oldLine: oldNo++ })
    else if (line.startsWith(' ') || line === '') {
      out.push({ type: 'context', text: line.slice(1), oldLine: oldNo++, newLine: newNo++ })
    }
  }
  if (out.at(-1)?.type === 'context' && out.at(-1)?.text === '') out.pop()
  return out
}
