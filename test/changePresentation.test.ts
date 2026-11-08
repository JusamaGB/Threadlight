import { describe, expect, it } from 'vitest'
import {
  comparisonEmpty,
  comparisonHeading,
  comparisonReasons,
} from '../src/shared/changePresentation'
import type { Changes } from '../src/shared/types'

describe('comparison presentation', () => {
  it('labels the actual comparison and never presents a partial zero as clean', () => {
    const changes: Changes = { branch: null, files: [], complete: false }
    expect(comparisonHeading('thread', 'git-current', changes)).toBe(
      'Thread diff · 0 files shown · partial',
    )
    expect(comparisonEmpty('thread', 'git-current', true)).toContain(
      'Other changes may still exist',
    )
    expect(comparisonHeading('worktree', 'git-staged', { ...changes, complete: true })).toBe(
      'Staged diff · 0 files',
    )
    expect(comparisonEmpty('worktree', 'git-staged', false)).toBe('No staged changes.')
    expect(comparisonEmpty('worktree', 'folder-baseline', false)).toContain('saved folder baseline')
  })
  it('explains metric coverage separately from chat attribution, without duplicate reasons', () => {
    const partial = { state: 'partial' as const, reasons: ['content-limit' as const], stale: false }
    expect(
      comparisonReasons({
        branch: null,
        files: [],
        coverage: { files: partial, added: partial, removed: partial },
        attributionCoverage: { ...partial, reasons: ['history-gap'] },
      }),
    ).toEqual(['Some files exceed the content limit.', 'Some edit history is unavailable.'])
  })
})
