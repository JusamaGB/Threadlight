import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ThreadDiffLedger } from '../src/main/sessions/threadDiff'
import { UncommittedThreads } from '../src/main/sessions/threadUncommitted'

async function fixture(run: (root: string, git: (...args: string[]) => void) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-uncommitted-'))
  const git = (...args: string[]) => {
    execFileSync('git', ['-C', root, ...args], { windowsHide: true, stdio: 'pipe' })
  }
  try {
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await writeFile(join(root, 'shared name.ts'), 'old\nkeep\nlast\n')
    git('add', '.')
    git('commit', '-m', 'baseline')
    await run(root, git)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('uncommitted changes attributed to a thread', () => {
  it('keeps only pending lines after a partial commit and clears after the final commit', async () =>
    fixture(async (root, git) => {
      const ledger = new ThreadDiffLedger(),
        view = new UncommittedThreads()
      const path = join(root, 'shared name.ts')
      ledger.record({
        path,
        kind: 'update',
        before: 'old\nkeep\nlast\n',
        after: 'own\nkeep\nnext\n',
      })
      await writeFile(path, 'own\nkeep\nlast\n')
      git('add', '.')
      await writeFile(path, 'own\nkeep\nnext\n')
      expect((await view.project(ledger, root, 0))?.summary).toMatchObject({
        files: 1,
        added: 2,
        removed: 2,
      })
      git('commit', '-m', 'first part')
      expect((await view.project(ledger, root, 6000))?.summary).toMatchObject({
        files: 1,
        added: 1,
        removed: 1,
      })
      git('add', '.')
      git('commit', '-m', 'remaining part')
      ledger.complete = false
      expect((await view.project(ledger, root, 12000))?.summary).toMatchObject({
        files: 0,
        added: 0,
        removed: 0,
        complete: true,
      })
    }))

  it('retains staged edits after a working file reversal, even when recorded net edits are zero', async () =>
    fixture(async (root, git) => {
      const ledger = new ThreadDiffLedger(),
        view = new UncommittedThreads()
      const path = join(root, 'shared name.ts'),
        before = 'old\nkeep\nlast\n',
        after = 'own\nkeep\nlast\n'
      ledger.record({ path, kind: 'update', before, after })
      await writeFile(path, after)
      git('add', '.')
      ledger.record({ path, kind: 'update', before: after, after: before })
      await writeFile(path, before)
      expect(ledger.data().summary.files).toBe(0)
      expect((await view.project(ledger, root, 0))?.summary).toMatchObject({
        files: 1,
        added: 1,
        removed: 1,
      })
    }))

  it('excludes other writers including an overwritten replacement in the same file', async () =>
    fixture(async (root) => {
      const ledger = new ThreadDiffLedger(),
        view = new UncommittedThreads()
      const path = join(root, 'shared name.ts')
      ledger.record({
        path,
        kind: 'update',
        before: 'old\nkeep\nlast\n',
        after: 'own\nkeep\nlast\n',
      })
      await writeFile(path, 'someone else\nkeep\nother writer\n')
      await writeFile(join(root, 'unrelated.ts'), 'other\n')
      expect((await view.project(ledger, root, 0))?.summary.files).toBe(0)
      await writeFile(path, 'own\nkeep\nother writer\n')
      expect((await view.project(ledger, root, 6000))?.summary).toMatchObject({
        files: 1,
        added: 1,
        removed: 1,
      })
    }))

  it('includes recorded untracked creates and deletions, and clears them on commit', async () =>
    fixture(async (root, git) => {
      const ledger = new ThreadDiffLedger(),
        view = new UncommittedThreads()
      const path = join(root, 'new file.ts'),
        deleted = join(root, 'shared name.ts')
      ledger.record({ path, kind: 'add', after: 'mine\n' })
      ledger.record({ path: deleted, kind: 'delete', before: 'old\nkeep\nlast\n' })
      await writeFile(path, 'mine\n')
      await rm(deleted)
      expect((await view.project(ledger, root, 0))?.summary).toMatchObject({
        files: 2,
        added: 1,
        removed: 3,
      })
      git('add', '.')
      git('commit', '-m', 'create and delete')
      expect((await view.project(ledger, root, 6000))?.summary.files).toBe(0)
    }))

  it('does not report Git failures or missing roots as clean', async () => {
    const ledger = new ThreadDiffLedger(),
      view = new UncommittedThreads()
    expect(await view.project(ledger, null, 0)).toBeNull()
    const root = await mkdtemp(join(tmpdir(), 'threadlight-not-git-'))
    try {
      expect(await view.project(ledger, root, 0)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not claim a neighbouring removal when another writer overwrites half a replacement', async () =>
    fixture(async (root) => {
      const ledger = new ThreadDiffLedger(),
        view = new UncommittedThreads()
      const path = join(root, 'shared name.ts')
      ledger.record({
        path,
        kind: 'update',
        before: 'old\nkeep\nlast\n',
        after: 'mine\nown\nlast\n',
      })
      await writeFile(path, 'mine\nother writer\nlast\n')
      expect((await view.project(ledger, root, 0))?.summary).toMatchObject({
        files: 1,
        added: 1,
        removed: 1,
      })
    }))
})
