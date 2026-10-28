import type { TimelineFileChange } from '../../shared/threadTimeline'
import { isObject, str } from '../sessions/json'
import { parseUnifiedDiff } from '../sessions/gitChanges'

/** Per-native-event evidence only. Never substitute the current worktree or a later edit. */
export function projectFileChanges(raw: unknown): { files: TimelineFileChange[]; count: number } {
  const changes = (Array.isArray(raw) ? raw : []).filter(isObject)
  const files: TimelineFileChange[] = []
  let previewBudget = 64_000
  for (const change of changes.slice(0, 100)) {
    const path = str(change.path)?.slice(0, 4096)
    if (!path) continue
    const kind = isObject(change.kind) ? change.kind : {}
    const diff = typeof change.diff === 'string' ? change.diff : null
    let added: number | null = null,
      removed: number | null = null
    if (diff !== null && diff.length <= 2_000_000 && !diff.includes('\0')) {
      if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(diff)) {
        const lines = parseUnifiedDiff(diff)
        added = lines.filter((line) => line.type === 'add').length
        removed = lines.filter((line) => line.type === 'remove').length
      } else if (kind.type === 'add' || kind.type === 'delete') {
        const count =
          diff === ''
            ? 0
            : diff.replace(/\r\n/g, '\n').split('\n').length - (diff.endsWith('\n') ? 1 : 0)
        added = kind.type === 'add' ? count : 0
        removed = kind.type === 'delete' ? count : 0
      } else if (diff === '') {
        added = 0
        removed = 0
      }
    }
    const readable = diff !== null && !diff.includes('\0')
    const previewLength = readable ? Math.min(diff.length, 16_000, previewBudget) : 0
    files.push({
      path,
      added,
      removed,
      diff:
        readable && (previewLength > 0 || diff === '') ? diff.slice(0, previewLength) : undefined,
      previewTruncated: readable && previewLength < diff.length,
    })
    previewBudget -= previewLength
  }
  return { files, count: changes.length }
}
