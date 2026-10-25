// A plan step's files: the ones the thread planned (PlanItem.files) matched up with the ones it
// actually changed (StepActivity.files), for the step view.

import type { StepActivity } from './types'

/** One row of the step's files: planned, changed, or both. */
export interface FileRow {
  path: string
  planned: boolean
  changed: { added: number; removed: number } | null
}

/** Planned files first, in the plan's order, then any changed file the plan did not name. */
export function fileRows(
  planned: string[],
  changed: StepActivity['files'],
  cwd: string | null,
): FileRow[] {
  const key = (path: string) => absolute(path, cwd).replaceAll('\\', '/').toLowerCase()
  const byKey = new Map(changed.map((file) => [key(file.path), file]))
  const rows: FileRow[] = []
  const seen = new Set<string>()
  for (const path of planned) {
    const k = key(path)
    if (seen.has(k)) continue
    seen.add(k)
    const file = byKey.get(k)
    rows.push({
      path: file?.path ?? absolute(path, cwd),
      planned: true,
      changed: file ? { added: file.added, removed: file.removed } : null,
    })
  }
  for (const file of changed) {
    if (seen.has(key(file.path))) continue
    rows.push({
      path: file.path,
      planned: false,
      changed: { added: file.added, removed: file.removed },
    })
  }
  return rows
}

/** A planned path as the thread wrote it, made absolute against its folder when relative. */
function absolute(path: string, cwd: string | null): string {
  const norm = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (/^([a-z]:|\/)/i.test(norm) || !cwd) return norm
  return `${cwd.replaceAll('\\', '/').replace(/\/+$/, '')}/${norm}`
}
