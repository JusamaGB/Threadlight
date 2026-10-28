import type { TimelineFileChange } from './threadTimeline'
import type { DiffLine } from './types'
import { parseUnifiedDiff } from './unifiedDiff'

/** Only this event's captured patch. Never replace missing evidence with a current-file diff. */
export function cardDiffLines(file: TimelineFileChange): DiffLine[] | null {
  if (file.diff === undefined || file.diff.includes('\0')) return null
  if (!file.diff) return []
  const parsed = parseUnifiedDiff(file.diff)
  if (parsed.length) return parsed
  // Native add/delete events can store whole-file text instead of unified hunks.
  const type =
    file.removed === 0 && file.added !== null
      ? 'add'
      : file.added === 0 && file.removed !== null
        ? 'remove'
        : null
  if (!type) return null
  const text = file.diff.replace(/\r\n/g, '\n').split('\n')
  if (text.at(-1) === '') text.pop()
  return text.map((line, index) =>
    type === 'add'
      ? { type, text: line, newLine: index + 1 }
      : { type, text: line, oldLine: index + 1 },
  )
}
