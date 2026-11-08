import { relative } from 'node:path'
import { stat } from 'node:fs/promises'
import type { ReconciledEdit } from '../../shared/changes'
import type { DiffLine } from '../../shared/types'
import { parseUnifiedDiff } from '../../shared/unifiedDiff'
import { captureText, digest, within } from '../changes/git'
import { runGit, WorkQueue } from './gitProcess'
import type { ThreadDiffLedger } from './threadDiff'

const signature = (lines: DiffLine[]) =>
  JSON.stringify(
    lines
      .filter((line) => line.type === 'add' || line.type === 'remove')
      .map(({ type, text }) => [type, text]),
  )

/** Read-only, bounded recovery. Matching content never transfers chat ownership. */
export class ThreadReconciliation {
  private cache = new Map<string, { at: number; result: Promise<ReconciledEdit[]> }>()
  private queue = new WorkQueue(2)

  async read(
    ledger: ThreadDiffLedger,
    root: string,
    git: boolean,
    now: number,
    historyRoot = root,
  ): Promise<ReconciledEdit[]> {
    const evidence = ledger.evidence().filter((file) => within(root, file.absolute))
    const key = digest(JSON.stringify([root, historyRoot, git, evidence]))
    const previous = this.cache.get(key)
    if (previous && now - previous.at < 30_000) return previous.result
    const result = this.queue.run(async () => {
      const records: ReconciledEdit[] = []
      const available = !!(await stat(root).catch(() => null))
      for (const file of evidence.slice(0, 24)) {
        const path = relative(root, file.absolute).replace(/\\/g, '/')
        const net = file.events.at(-1) ?? []
        const record: ReconciledEdit = {
          path,
          state: available ? 'recorded' : 'unresolved',
          explanation: available
            ? 'Provider-recorded edits; current file coverage requires a saved comparison baseline.'
            : 'Source folder unavailable; no verified repository binding is available for recovery.',
          added: net.filter((line) => line.type === 'add').length,
          removed: net.filter((line) => line.type === 'remove').length,
        }
        records.push(record)
        if (!git) {
          const last = ledger.mutations.findLast(
            (mutation) =>
              mutation.change.path.replace(/\\/g, '/') === file.absolute.replace(/\\/g, '/'),
          )?.change
          const after = last?.after ?? (last?.kind === 'add' ? last.diff : undefined)
          if (available && after !== undefined) {
            const current = await captureText(root, path)
            if (current.text === after)
              record.explanation =
                'Current file matches the complete content recorded by the provider. These recorded edits are separate from folder-baseline totals.'
          }
          continue
        }
        record.state = 'unresolved'
        record.explanation =
          'Recorded edits have no exact patch match in the latest 64 local commits for this path; current changes are shown separately.'
        const signatures = new Set(file.events.map(signature).filter((value) => value !== '[]'))
        try {
          const history = await runGit(historyRoot, [
            'log',
            '--all',
            '-64',
            '--format=THREADLIGHT_COMMIT:%H',
            '-p',
            '--no-ext-diff',
            '--no-textconv',
            '--no-renames',
            '--',
            path,
          ])
          for (const entry of history.split('THREADLIGHT_COMMIT:').slice(1)) {
            const commit = entry.slice(0, 40)
            if (!/^[a-f0-9]{40}$/.test(commit)) continue
            const patch = entry.slice(40)
            if (!signatures.has(signature(parseUnifiedDiff(patch)))) continue
            const branches = (
              await runGit(historyRoot, [
                'for-each-ref',
                `--contains=${commit}`,
                '--format=%(refname:short)',
                'refs/heads/',
              ])
            )
              .trim()
              .split('\n')
              .filter(Boolean)
            const integrated = await runGit(historyRoot, [
              'merge-base',
              '--is-ancestor',
              commit,
              'HEAD',
            ]).then(
              () => true,
              () => false,
            )
            record.state = integrated ? 'committed' : 'separate-branch'
            record.commit = commit
            record.branches = branches
            record.explanation = integrated
              ? 'A recorded patch matches this commit in the current checkout history. Later edits and pending changes remain separate.'
              : 'A recorded patch matches this commit outside the current checkout history.'
            break
          }
        } catch {
          record.explanation =
            'Local Git history could not be read; recorded edits are retained and recovery will retry automatically.'
        }
      }
      if (evidence.length > 24)
        records.push({
          path: '',
          state: 'unresolved',
          added: 0,
          removed: 0,
          explanation:
            'History reconciliation reached its 24-file limit; remaining provider edits are not yet reconciled.',
        })
      return records
    })
    this.cache.set(key, { at: now, result })
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
    return result
  }

  invalidate(): void {
    this.cache.clear()
  }
}
