import type { DiffLine } from '../../shared/types'

/** Unique, contiguous evidence context in one file. No global matching of isolated words. */
function locate(text: string[], snippet: string[]): number | null {
  if (!snippet.length || snippet.length > text.length) return null
  let found: number | null = null
  for (let i = 0; i <= text.length - snippet.length; i++) {
    if (snippet.every((line, offset) => text[i + offset] === line)) {
      if (found !== null) return -1
      found = i
    }
  }
  return found
}
const key = (line: DiffLine) =>
  `${line.type}\0${line.type === 'add' ? line.newLine : line.oldLine}\0${line.text}`

/**
 * This is an endpoint correspondence, not a claim of continuous authorship.
 * Callers retain Partial unless a complete observation/evidence chain is available.
 * Both sides of a replacement are linked; overwritten additions cannot orphan ownership.
 */
export function supportedLines(
  current: DiffLine[],
  events: DiffLine[][],
  before?: string,
  after?: string,
): DiffLine[] {
  const textLines = (text: string) => {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    return lines
  }
  const oldText = before === undefined ? undefined : textLines(before)
  const newText = after === undefined ? undefined : textLines(after)
  const available = new Set(current.filter((l) => l.type === 'add' || l.type === 'remove').map(key))
  const selected = new Set<string>()
  for (const event of events) {
    const hunks: DiffLine[][] = []
    let hunk: DiffLine[] = []
    for (const line of event) {
      if (line.type === 'hunk') {
        if (hunk.length) hunks.push(hunk)
        hunk = []
      } else hunk.push(line)
    }
    if (hunk.length) hunks.push(hunk)
    for (const lines of hunks) {
      const old = lines.filter((l) => l.type !== 'add'),
        next = lines.filter((l) => l.type !== 'remove')
      const oldAt =
        oldText &&
        locate(
          oldText,
          old.map((l) => l.text),
        )
      const newAt =
        newText &&
        locate(
          newText,
          next.map((l) => l.text),
        )
      // Context or a full-file pre/postimage is required to move coordinates.
      const context = lines.some((l) => l.type === 'context')
      let oldIndex = 0,
        newIndex = 0
      const mapped = lines.map((line) => {
        const oldLine =
          oldAt !== null &&
          oldAt !== undefined &&
          oldAt >= 0 &&
          (context || old.length === oldText?.length)
            ? oldAt + oldIndex + 1
            : line.oldLine
        const newLine =
          newAt !== null &&
          newAt !== undefined &&
          newAt >= 0 &&
          (context || next.length === newText?.length)
            ? newAt + newIndex + 1
            : line.newLine
        if (line.type !== 'add') oldIndex++
        if (line.type !== 'remove') newIndex++
        return { ...line, oldLine, newLine }
      })
      let block: DiffLine[] = []
      const flush = () => {
        const adds = block.filter((l) => l.type === 'add'),
          removes = block.filter((l) => l.type === 'remove')
        const allAddsRemain = newAt !== -1 && adds.every((l) => available.has(key(l)))
        for (const line of block) {
          if (!available.has(key(line))) continue
          // Ambiguous full endpoint contexts cannot fall back to positional guesses.
          if (line.type === 'add' && newAt === -1) continue
          if (line.type === 'remove' && oldAt === -1) continue
          if (
            line.type === 'add' ||
            allAddsRemain ||
            (newAt !== -1 &&
              adds.length === removes.length &&
              available.has(key(adds[removes.indexOf(line)]!)))
          )
            selected.add(key(line))
        }
        block = []
      }
      for (const line of mapped) {
        if (line.type === 'context') flush()
        else block.push(line)
      }
      flush()
    }
  }
  return current.filter((line) => selected.has(key(line)))
}
