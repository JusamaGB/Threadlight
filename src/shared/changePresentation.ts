import type { Changes } from './types'
import type { ChangeLens } from './changes'

export type ComparisonScope = 'thread' | 'worktree'
export function comparisonTitle(scope: ComparisonScope, lens: ChangeLens): string {
  if (scope === 'thread') return 'Thread diff'
  return {
    'git-current': 'Worktree diff',
    'git-staged': 'Staged diff',
    'git-unstaged': 'Unstaged diff',
    'folder-baseline': 'Folder diff',
  }[lens]
}
export function comparisonHeading(
  scope: ComparisonScope,
  lens: ChangeLens,
  changes?: Changes | null,
): string {
  const title = comparisonTitle(scope, lens)
  if (!changes) return title
  const recorded =
    changes.groups?.reduce((count, group) => count + (group.recorded?.length ?? 0), 0) ?? 0
  if (scope === 'thread' && recorded)
    return `${title} · ${changes.files.length} current files · ${recorded} recorded files${changes.complete === false ? ' · current coverage partial' : ''}`
  if (
    changes.groups?.length &&
    changes.groups.some((group) => group.lens !== changes.groups![0]!.lens)
  )
    return `${title} · ${changes.groups.length} roots · different baselines`
  const count = changes.files.length
  return `${title} · ${count} ${count === 1 ? 'file' : 'files'}${changes.complete === false ? ' shown · partial' : ''}`
}
export function comparisonEmpty(
  scope: ComparisonScope,
  lens: ChangeLens,
  partial: boolean,
): string {
  if (scope === 'thread')
    return partial
      ? 'No current changes could be matched to this chat’s available edit records. Other changes may still exist; inspect the worktree or folder comparison.'
      : 'No current changes match this chat’s recorded edits.'
  if (partial)
    return 'No changed files could be listed from the available evidence. This does not establish that the folder is unchanged.'
  return {
    'git-current': 'No changes between the last commit and current files.',
    'git-staged': 'No staged changes.',
    'git-unstaged': 'No unstaged changes.',
    'folder-baseline': 'No changes since the saved folder baseline.',
  }[lens]
}
export const reasonLabels: Record<string, string> = {
  'mixed-lenses': 'Root groups use different comparison baselines; inspect each group separately.',
  'evidence-scope':
    'Only available recorded edit operations can be matched; writes outside those records may be absent.',
  'history-gap': 'Some edit history is unavailable.',
  'ambiguous-mapping': 'Some recorded edits cannot be uniquely matched to current files.',
  'unattributed-write': 'Some writes have no recorded chat association.',
  'concurrent-write': 'Files changed while the comparison was being read.',
  'root-unavailable': 'The source folder is unavailable.',
  'git-read-failed': 'Git could not read the comparison.',
  'unsupported-conversion': 'A file requires an unsupported Git conversion.',
  'unsupported-encoding': 'Some binary files or text encodings have no line counts.',
  'content-limit': 'Some files exceed the content limit.',
  'inventory-limit': 'The file listing reached its limit.',
  'storage-limit': 'Local history reached its storage limit.',
  'content-evicted': 'Some saved file content is no longer available.',
  'baseline-incomplete': 'The saved baseline is incomplete.',
  'recording-disabled': 'Local file recording is off.',
  excluded: 'Some paths are excluded from recording.',
  unreadable: 'Some files could not be read.',
}
export function comparisonReasons(changes: Changes): string[] {
  const reasons = [
    ...Object.values(changes.coverage ?? {}).flatMap((value) => value.reasons),
    ...(changes.attributionCoverage?.reasons ?? []),
  ]
  return [...new Set(reasons)].map((reason) => reasonLabels[reason] ?? reason)
}
