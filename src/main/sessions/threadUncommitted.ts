import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import type { ThreadDiffData, ThreadDiffLedger } from './threadDiff'
import { inside } from './gitChanges'
import { captureGit, coverage, invalidateGitComparison, type LocalComparison } from '../changes/git'
import { supportedLines } from '../changes/mapping'
import type { CoverageReason } from '../../shared/changes'

/** Provider evidence projected onto the explicit HEAD → working-files comparison. */
export class UncommittedThreads {
  invalidate(root?: string) {
    invalidateGitComparison(root)
  }
  async project(
    ledger: ThreadDiffLedger,
    root: string | null,
    now: number,
    captured?: LocalComparison,
  ): Promise<ThreadDiffData | null> {
    if (!root) return null
    try {
      // Fresh endpoint demand is shared across concurrent callers by captureGit.
      const comparison = captured ?? (await captureGit(root, 'git-current', now))
      const files: ThreadDiffData['files'] = []
      const reasons: CoverageReason[] = ['evidence-scope']
      if (!ledger.complete) reasons.push('history-gap')
      for (const metric of Object.values(comparison.coverage ?? {})) reasons.push(...metric.reasons)
      for (const evidence of ledger.evidence()) {
        if (!evidence.complete) reasons.push('history-gap')
        for (const absolute of new Set(evidence.paths)) {
          const path = relative(comparison.root, absolute).replace(/\\/g, '/')
          if (!inside(comparison.root, path)) continue
          const current = comparison.evidence.get(path)
          const item = comparison.files.find((file) => file.path === path)
          if (!item) continue
          if (!current) {
            reasons.push('content-limit')
            continue
          }
          const selected = supportedLines(
            current.lines,
            evidence.events,
            current.before,
            current.after,
          )
          if (!selected.length) continue
          files.push({
            root: comparison.root,
            absolute,
            file: {
              ...item,
              added: selected.filter((l) => l.type === 'add').length,
              removed: selected.filter((l) => l.type === 'remove').length,
            },
            diff:
              selected.length > 1500
                ? { kind: 'too-big', lines: selected.length }
                : {
                    kind: 'text',
                    lines: [
                      { type: 'hunk', text: 'Supported current changes · attribution partial' },
                      ...selected,
                    ],
                  },
          })
        }
      }
      files.sort((a, b) => a.file.path.localeCompare(b.file.path))
      // Endpoint correspondence cannot establish that shell/manual writes were fully
      // observed. Only a complete empty current comparison establishes an exact zero.
      const complete = comparison.complete === true && comparison.files.length === 0
      const attributionCoverage = coverage(complete ? [] : reasons, comparison.stale)
      const revision = createHash('sha256')
        .update(JSON.stringify([comparison.revision, complete, files, attributionCoverage]))
        .digest('hex')
      return {
        files,
        summary: {
          files: files.length,
          added: files.reduce((n, f) => n + f.file.added, 0),
          removed: files.reduce((n, f) => n + f.file.removed, 0),
          complete,
          revision,
          lens: comparison.lens,
          stale: comparison.stale,
          hasOtherLensChanges: comparison.hasOtherLensChanges,
          evidenceScope: 'available-recorded-operations',
          coverage: attributionCoverage,
        },
      }
    } catch {
      return null
    }
  }
}
