import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { temporaryDirectory } from './helpers'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ThreadDiffLedger } from '../src/main/sessions/threadDiff'
import { ThreadReconciliation } from '../src/main/sessions/threadReconciliation'
import { ThreadChanges } from '../src/main/sessions/threadChanges'
import type { Session } from '../src/shared/types'

async function fixture(work: (root: string, git: (...args: string[]) => string) => Promise<void>) {
  const root = await temporaryDirectory('threadlight-reconcile-')
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim()
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'core.autocrlf', 'false')
    await writeFile(join(root, 'file.txt'), 'before\n')
    git('add', '.')
    git('commit', '-m', 'base')
    await work(root, git)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('automatic evidence reconciliation', { timeout: 60_000 }, () => {
  it('separates a matching branch commit, then recognizes integration without creating pending changes', async () =>
    fixture(async (root, git) => {
      const ledger = new ThreadDiffLedger()
      ledger.record({
        path: join(root, 'file.txt'),
        kind: 'update',
        before: 'before\n',
        after: 'after\n',
      })
      git('checkout', '-b', 'related')
      await writeFile(join(root, 'file.txt'), 'after\n')
      git('commit', '-am', 'recorded edit')
      const commit = git('rev-parse', 'HEAD')
      git('checkout', 'main')
      const recovery = new ThreadReconciliation()
      expect(await recovery.read(ledger, root, true, 0)).toMatchObject([
        { state: 'separate-branch', commit, branches: ['related'] },
      ])
      git('merge', '--ff-only', 'related')
      recovery.invalidate()
      expect(await recovery.read(ledger, root, true, 1)).toMatchObject([
        { state: 'committed', commit },
      ])
      // A later reversal does not erase the historical receipt or claim the patch is still present.
      await writeFile(join(root, 'file.txt'), 'before\n')
      git('commit', '-am', 'revert')
      recovery.invalidate()
      expect((await recovery.read(ledger, root, true, 2))[0]?.explanation).toContain('Later edits')
      expect(git('status', '--porcelain')).toBe('')
    }))

  it('recovers a removed checkout only through its previously verified common directory', async () =>
    fixture(async (root, git) => {
      const checkout = join(root, 'checkout')
      git('worktree', 'add', '-b', 'work', checkout)
      const ledger = new ThreadDiffLedger()
      ledger.record({
        path: join(checkout, 'file.txt'),
        kind: 'update',
        before: 'before\n',
        after: 'integrated\n',
      })
      await writeFile(join(checkout, 'file.txt'), 'integrated\n')
      execFileSync('git', ['-C', checkout, 'commit', '-am', 'recorded'], {
        windowsHide: true,
        stdio: 'pipe',
      })
      const service = new ThreadChanges({
        history: '',
        transcript: () => null,
        changed: () => {},
        recordedEvidence: async () => ledger,
      })
      const session = { id: 'test', cwd: root, git: { root, branch: 'main' } } as Session
      expect(
        (await service.changes(session))?.groups?.find((group) => group.root === checkout)
          ?.recorded?.[0]?.state,
      ).toBe('committed')
      git('merge', '--ff-only', 'work')
      git('worktree', 'remove', checkout)
      service.invalidate()
      const recovered = (await service.changes(session))?.groups?.find(
        (group) => group.root === checkout,
      )
      expect(recovered).toMatchObject({
        recoveredFrom: root,
        available: false,
        complete: false,
        recorded: [{ state: 'committed' }],
      })
      const removedPrimary = await service.changes({
        ...session,
        id: 'removed-primary',
        cwd: checkout,
        git: { ...session.git!, root: checkout },
      })
      expect(removedPrimary?.groups).toMatchObject([
        {
          root: checkout,
          recoveredFrom: root,
          available: false,
          recorded: [{ state: 'committed' }],
        },
      ])
    }))

  it('does not infer ownership or repository identity from a similar filename or different patch', async () =>
    fixture(async (root, git) => {
      const ledger = new ThreadDiffLedger()
      ledger.record({
        path: join(root, 'file.txt'),
        kind: 'update',
        before: 'before\n',
        after: 'mine\n',
      })
      await writeFile(join(root, 'file.txt'), 'other writer\n')
      git('commit', '-am', 'other edit')
      expect(await new ThreadReconciliation().read(ledger, root, true, 0)).toMatchObject([
        { state: 'unresolved' },
      ])
      const missing = join(root, 'missing')
      const absent = new ThreadDiffLedger()
      absent.record({ path: join(missing, 'file.txt'), kind: 'add', after: 'mine\n' })
      expect(await new ThreadReconciliation().read(absent, missing, false, 0)).toMatchObject([
        {
          state: 'unresolved',
          explanation: expect.stringContaining('no verified repository binding'),
        },
      ])
    }))

  it('retains non-Git provider evidence and reports a missing baseline without inventing current counts', async () =>
    fixture(async (root) => {
      const folder = await temporaryDirectory('threadlight-recorded-')
      try {
        await mkdir(join(folder, 'outputs'))
        const ledger = new ThreadDiffLedger()
        ledger.record({
          path: join(folder, 'outputs', 'record.md'),
          kind: 'add',
          after: 'record\n',
        })
        await writeFile(join(folder, 'outputs', 'record.md'), 'record\n')
        const service = new ThreadChanges({
          history: '',
          transcript: () => null,
          changed: () => {},
          folderComparison: async () => null,
          recordedEvidence: async () => ledger,
        })
        const result = await service.changes({ id: 'test', cwd: folder, git: null } as Session)
        expect(result).toMatchObject({
          files: [],
          complete: false,
          groups: [
            {
              root: folder,
              reasons: ['baseline-incomplete'],
              recorded: [{ path: 'outputs/record.md', state: 'recorded' }],
            },
          ],
        })
        expect(result?.groups).toHaveLength(1)
        expect(root).toBeTruthy()
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    }))
})
